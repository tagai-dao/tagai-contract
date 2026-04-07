// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IVault} from "infinity-core/src/interfaces/IVault.sol";
import {ILockCallback} from "infinity-core/src/interfaces/ILockCallback.sol";
import {Currency} from "infinity-core/src/types/Currency.sol";
import {PoolKey} from "infinity-core/src/types/PoolKey.sol";
import {ICLPoolManager} from "infinity-core/src/pool-cl/interfaces/ICLPoolManager.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "infinity-core/src/types/BalanceDelta.sol";

contract MockCLSwapRouter is ILockCallback {
    using BalanceDeltaLibrary for BalanceDelta;

    IVault public immutable vault;
    ICLPoolManager public immutable poolManager;

    struct SwapRequest {
        address payer;
        address recipient;
        PoolKey key;
        ICLPoolManager.SwapParams params;
    }

    constructor(address _vault, address _poolManager) {
        vault = IVault(_vault);
        poolManager = ICLPoolManager(_poolManager);
    }

    receive() external payable {}

    function swapExactInputTokenForETH(
        PoolKey memory key,
        uint256 tokenIn,
        uint160 sqrtPriceLimitX96,
        address recipient
    ) external returns (int128 amount0, int128 amount1) {
        IERC20(Currency.unwrap(key.currency1)).transferFrom(msg.sender, address(this), tokenIn);

        ICLPoolManager.SwapParams memory params =
            ICLPoolManager.SwapParams({zeroForOne: false, amountSpecified: -int256(tokenIn), sqrtPriceLimitX96: sqrtPriceLimitX96});

        bytes memory result = vault.lock(abi.encode(SwapRequest(msg.sender, recipient, key, params)));
        BalanceDelta delta = abi.decode(result, (BalanceDelta));
        return (delta.amount0(), delta.amount1());
    }

    function lockAcquired(bytes calldata data) external override returns (bytes memory) {
        require(msg.sender == address(vault), "Only vault");

        SwapRequest memory req = abi.decode(data, (SwapRequest));
        BalanceDelta delta = poolManager.swap(req.key, req.params, "");

        if (delta.amount1() < 0) {
            uint256 tokenOwed = uint256(uint128(-delta.amount1()));
            vault.sync(req.key.currency1);
            IERC20(Currency.unwrap(req.key.currency1)).transfer(address(vault), tokenOwed);
            vault.settle();
        }

        if (delta.amount0() > 0) {
            uint256 ethOut = uint256(uint128(delta.amount0()));
            vault.take(req.key.currency0, req.recipient, ethOut);
        }

        return abi.encode(delta);
    }
}
