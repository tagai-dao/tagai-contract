// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {ICLHooks} from "infinity-core/src/pool-cl/interfaces/ICLHooks.sol";
import {ICLPoolManager} from "infinity-core/src/pool-cl/interfaces/ICLPoolManager.sol";
import {IHooks} from "infinity-core/src/interfaces/IHooks.sol";
import {IVault} from "infinity-core/src/interfaces/IVault.sol";
import {PoolKey} from "infinity-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "infinity-core/src/types/PoolId.sol";
import {BalanceDelta, toBalanceDelta} from "infinity-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary, toBeforeSwapDelta} from "infinity-core/src/types/BeforeSwapDelta.sol";
import {Currency, CurrencyLibrary} from "infinity-core/src/types/Currency.sol";
import {SafeCast} from "infinity-core/src/libraries/SafeCast.sol";
import "./interface/IPump.sol";
import "./interface/IIPShare.sol";
import "./interface/IToken.sol";

/// @title TipTagSwapHook
/// @notice PancakeSwap V4 (Infinity) CL Hook that collects trading fees on every swap:
///   - feeRatio[0] → platform feeReceiver
///   - feeRatio[1] → deployer's IPShare.valueCapture()
/// Fees are always collected from the ETH side for immediate distribution.
contract TipTagSwapHook is ICLHooks {
    using PoolIdLibrary for PoolKey;
    using SafeCast for uint256;
    using CurrencyLibrary for Currency;

    // ================================ Errors ================================
    error NotPoolManager();
    error Unauthorized();
    error PoolNotRegistered();
    error OnlyPump();

    // ================================ Events ================================
    event PoolRegistered(PoolId indexed poolId, address indexed token);
    event SwapFeeCollected(PoolId indexed poolId, address indexed token, uint256 platformFee, uint256 deployerFee);

    // ================================ State ================================
    ICLPoolManager public immutable clPoolManager;
    IVault public immutable vault;
    IPump public immutable pump;

    uint256 private constant DIVISOR = 10000;

    // poolId → token address (registered when token lists to DEX)
    mapping(PoolId => address) public poolToken;

    // ================================ Modifiers ================================
    modifier onlyPoolManager() {
        if (msg.sender != address(clPoolManager)) revert NotPoolManager();
        _;
    }

    modifier onlyPump() {
        if (msg.sender != address(pump)) revert OnlyPump();
        _;
    }

    // ================================ Constructor ================================
    constructor(ICLPoolManager _clPoolManager, IVault _vault, address _pump) {
        clPoolManager = _clPoolManager;
        vault = _vault;
        pump = IPump(_pump);
    }

    /// @notice Returns the hook registration bitmap indicating which callbacks are active.
    /// Bits: beforeInitialize(0), beforeSwap(6), afterSwap(7),
    ///       beforeSwapReturnsDelta(10), afterSwapReturnsDelta(11)
    function getHooksRegistrationBitmap() external pure override returns (uint16) {
        return
            uint16(
                (1 << 0) | // HOOKS_BEFORE_INITIALIZE_OFFSET
                    (1 << 6) | // HOOKS_BEFORE_SWAP_OFFSET
                    (1 << 7) | // HOOKS_AFTER_SWAP_OFFSET
                    (1 << 10) | // HOOKS_BEFORE_SWAP_RETURNS_DELTA_OFFSET
                    (1 << 11) // HOOKS_AFTER_SWAP_RETURNS_DELTA_OFFSET
            );
    }

    // ================================ Pool Registration ================================
    /// @notice Register a pool → token mapping. Called by Token contract during listing.
    function registerPool(PoolId poolId, address token) external {
        if (!pump.createdTokens(token)) revert Unauthorized();
        if (msg.sender != token) revert Unauthorized();
        poolToken[poolId] = token;
        emit PoolRegistered(poolId, token);
    }

    // ================================ Hook Callbacks ================================

    /// @notice Guard: only registered Token contracts can create pools with this Hook
    function beforeInitialize(
        address sender,
        PoolKey calldata /* key */,
        uint160 /* sqrtPriceX96 */
    ) external virtual override onlyPoolManager returns (bytes4) {
        if (!pump.createdTokens(sender)) revert Unauthorized();
        return ICLHooks.beforeInitialize.selector;
    }

    /// @notice Collect fees from the unspecified token if it is ETH (afterSwap path).
    function afterSwap(
        address,
        PoolKey calldata key,
        ICLPoolManager.SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata
    ) external virtual override onlyPoolManager returns (bytes4, int128) {
        if (poolToken[key.toId()] == address(0)) return (ICLHooks.afterSwap.selector, 0);

        // If ETH is specified (exactInput ETH or exactOutput ETH), fee was taken in beforeSwap
        if (params.amountSpecified < 0 == params.zeroForOne) return (ICLHooks.afterSwap.selector, 0);

        uint256[2] memory feeRatio = pump.getFeeRatio();
        uint256 totalFeeRatio = feeRatio[0] + feeRatio[1];
        if (totalFeeRatio == 0) return (ICLHooks.afterSwap.selector, 0);

        uint256 unspecifiedAmount;
        {
            int128 ethDelta = delta.amount0();
            unspecifiedAmount = ethDelta < 0 ? uint256(uint128(-ethDelta)) : uint256(uint128(ethDelta));
        }

        if (unspecifiedAmount == 0) return (ICLHooks.afterSwap.selector, 0);

        uint256 totalFee = (unspecifiedAmount * totalFeeRatio) / DIVISOR;
        if (totalFee == 0) return (ICLHooks.afterSwap.selector, 0);

        // In PCS V4, take() is on the Vault
        vault.take(key.currency0, address(this), totalFee);

        uint256 platformFee = (unspecifiedAmount * feeRatio[0]) / DIVISOR;
        uint256 deployerFee = totalFee - platformFee;
        address token = poolToken[key.toId()];

        _distributeFees(token, platformFee, deployerFee);
        emit SwapFeeCollected(key.toId(), token, platformFee, deployerFee);

        return (ICLHooks.afterSwap.selector, totalFee.toInt128());
    }

    function _distributeFees(address token, uint256 platformFee, uint256 deployerFee) internal {
        address feeReceiver = pump.getFeeReceiver();
        address ipshare = pump.getIPShare();
        address subject = IToken(token).getIPShare(); // ipshareSubject

        if (platformFee > 0) {
            (bool success, ) = feeReceiver.call{value: platformFee}("");
            require(success, "Platform fee transfer failed");
        }
        if (deployerFee > 0) {
            IIPShare(ipshare).valueCapture{value: deployerFee}(subject);
        }
    }

    // ================================ beforeSwap ================================
    function beforeSwap(
        address,
        PoolKey calldata key,
        ICLPoolManager.SwapParams calldata params,
        bytes calldata
    ) external virtual override onlyPoolManager returns (bytes4, BeforeSwapDelta, uint24) {
        if (poolToken[key.toId()] == address(0))
            return (ICLHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);

        // We only take fee in beforeSwap if ETH is the specified token
        if (!(params.amountSpecified < 0 == params.zeroForOne))
            return (ICLHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);

        uint256[2] memory feeRatio = pump.getFeeRatio();
        uint256 totalFeeRatio = feeRatio[0] + feeRatio[1];
        if (totalFeeRatio == 0) return (ICLHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);

        uint256 specifiedAmount = params.amountSpecified < 0
            ? uint256(-params.amountSpecified)
            : uint256(params.amountSpecified);

        uint256 totalFee = (specifiedAmount * totalFeeRatio) / DIVISOR;
        if (totalFee == 0) return (ICLHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);

        // In PCS V4, take() is on the Vault
        vault.take(key.currency0, address(this), totalFee);

        uint256 platformFee = (specifiedAmount * feeRatio[0]) / DIVISOR;
        uint256 deployerFee = totalFee - platformFee;
        address token = poolToken[key.toId()];

        _distributeFees(token, platformFee, deployerFee);
        emit SwapFeeCollected(key.toId(), token, platformFee, deployerFee);

        return (ICLHooks.beforeSwap.selector, toBeforeSwapDelta(totalFee.toInt128(), 0), 0);
    }

    // ================================ Unimplemented hooks ================================

    function afterInitialize(address, PoolKey calldata, uint160, int24) external virtual override returns (bytes4) {
        return ICLHooks.afterInitialize.selector;
    }

    function beforeAddLiquidity(
        address,
        PoolKey calldata,
        ICLPoolManager.ModifyLiquidityParams calldata,
        bytes calldata
    ) external virtual override returns (bytes4) {
        return ICLHooks.beforeAddLiquidity.selector;
    }

    function afterAddLiquidity(
        address,
        PoolKey calldata,
        ICLPoolManager.ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external virtual override returns (bytes4, BalanceDelta) {
        return (ICLHooks.afterAddLiquidity.selector, toBalanceDelta(0, 0));
    }

    function beforeRemoveLiquidity(
        address,
        PoolKey calldata,
        ICLPoolManager.ModifyLiquidityParams calldata,
        bytes calldata
    ) external virtual override returns (bytes4) {
        return ICLHooks.beforeRemoveLiquidity.selector;
    }

    function afterRemoveLiquidity(
        address,
        PoolKey calldata,
        ICLPoolManager.ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external virtual override returns (bytes4, BalanceDelta) {
        return (ICLHooks.afterRemoveLiquidity.selector, toBalanceDelta(0, 0));
    }

    function beforeDonate(
        address,
        PoolKey calldata,
        uint256,
        uint256,
        bytes calldata
    ) external virtual override returns (bytes4) {
        return ICLHooks.beforeDonate.selector;
    }

    function afterDonate(
        address,
        PoolKey calldata,
        uint256,
        uint256,
        bytes calldata
    ) external virtual override returns (bytes4) {
        return ICLHooks.afterDonate.selector;
    }

    // ================================ Receive ETH ================================
    receive() external payable {}
}
