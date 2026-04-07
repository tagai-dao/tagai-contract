// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {IVault} from "infinity-core/src/interfaces/IVault.sol";
import {ILockCallback} from "infinity-core/src/interfaces/ILockCallback.sol";
import {ICLPoolManager} from "infinity-core/src/pool-cl/interfaces/ICLPoolManager.sol";
import {PoolKey} from "infinity-core/src/types/PoolKey.sol";
import {BalanceDelta} from "infinity-core/src/types/BalanceDelta.sol";
import {Currency} from "infinity-core/src/types/Currency.sol";

interface IERC20Like {
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @notice Fork-only diagnostic helper for isolating Vault lock failures.
contract ForkVaultLockProbe is ILockCallback {
    error ProbeDelta(int128 amount0, int128 amount1);

    IVault public immutable vault;
    ICLPoolManager public immutable poolManager;

    enum Mode {
        Noop,
        ModifyOnly,
        ModifyAndSettle
    }

    struct LockContext {
        Mode mode;
        PoolKey key;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidityDelta;
    }

    int128 public lastAmount0;
    int128 public lastAmount1;

    constructor(address vault_, address poolManager_) {
        vault = IVault(vault_);
        poolManager = ICLPoolManager(poolManager_);
    }

    receive() external payable {}

    function lockNoop() external {
        vault.lock("");
    }

    function lockModifyOnly(PoolKey calldata key, int24 tickLower, int24 tickUpper, uint128 liquidityDelta) external {
        vault.lock(abi.encode(LockContext(Mode.ModifyOnly, key, tickLower, tickUpper, liquidityDelta)));
    }

    function lockModifyAndSettle(PoolKey calldata key, int24 tickLower, int24 tickUpper, uint128 liquidityDelta)
        external
    {
        vault.lock(abi.encode(LockContext(Mode.ModifyAndSettle, key, tickLower, tickUpper, liquidityDelta)));
    }

    function lockAcquired(bytes calldata data) external override returns (bytes memory) {
        return _onLock(data);
    }

    /// @dev Compatibility path: some deployed Vault versions call lockCallback(bytes).
    function lockCallback(bytes calldata data) external returns (bytes memory) {
        return _onLock(data);
    }

    function _onLock(bytes calldata data) private returns (bytes memory) {
        require(msg.sender == address(vault), "only vault");
        if (data.length == 0) return "";

        LockContext memory ctx = abi.decode(data, (LockContext));
        if (ctx.mode == Mode.Noop) {
            return "";
        }

        ICLPoolManager.ModifyLiquidityParams memory params = ICLPoolManager.ModifyLiquidityParams({
            tickLower: ctx.tickLower,
            tickUpper: ctx.tickUpper,
            liquidityDelta: int256(uint256(ctx.liquidityDelta)),
            salt: bytes32(0)
        });
        (BalanceDelta delta,) = poolManager.modifyLiquidity(ctx.key, params, "");

        int128 amount0 = delta.amount0();
        int128 amount1 = delta.amount1();
        lastAmount0 = amount0;
        lastAmount1 = amount1;

        if (ctx.mode == Mode.ModifyOnly) {
            revert ProbeDelta(amount0, amount1);
        }

        if (amount0 < 0) {
            vault.settle{value: uint256(uint128(-amount0))}();
        }

        if (amount1 < 0) {
            uint256 tokenOwed = uint256(uint128(-amount1));
            vault.sync(ctx.key.currency1);
            bool ok = IERC20Like(Currency.unwrap(ctx.key.currency1)).transfer(address(vault), tokenOwed);
            require(ok, "token transfer failed");
            vault.settle();
        }

        if (amount0 > 0) {
            vault.take(ctx.key.currency0, address(this), uint256(uint128(amount0)));
        }
        if (amount1 > 0) {
            vault.take(ctx.key.currency1, address(this), uint256(uint128(amount1)));
        }

        return "";
    }
}
