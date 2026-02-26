// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {ERC20} from "./solady/src/tokens/ERC20.sol";

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./interface/IToken.sol";
import "./interface/IIPShare.sol";
import "./interface/IPump.sol";
import "./interface/IBondingCurve.sol";

// PancakeSwap V4 (Infinity)
import {ICLPoolManager} from "infinity-core/src/pool-cl/interfaces/ICLPoolManager.sol";
import {IHooks} from "infinity-core/src/interfaces/IHooks.sol";
import {ILockCallback} from "infinity-core/src/interfaces/ILockCallback.sol";
import {IVault} from "infinity-core/src/interfaces/IVault.sol";
import {PoolKey} from "infinity-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "infinity-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "infinity-core/src/types/Currency.sol";
import {BalanceDelta} from "infinity-core/src/types/BalanceDelta.sol";
import {TickMath} from "infinity-core/src/pool-cl/libraries/TickMath.sol";
import {CLPoolParametersHelper} from "infinity-core/src/pool-cl/libraries/CLPoolParametersHelper.sol";
import {IPoolManager} from "infinity-core/src/interfaces/IPoolManager.sol";

interface ITipTagSwapHook {
    function registerPool(PoolId poolId, address token) external;
}

contract Token is IToken, ERC20, ReentrancyGuard, ILockCallback {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;

    string private _name;
    string private _symbol;
    uint256 private constant divisor = 10000;
    address private constant BlackHole = 0x000000000000000000000000000000000000dEaD;

    // distribute token total amount
    uint256 private constant socialDistributionAmount = 150000000 ether;
    uint256 private constant bondingCurveTotalAmount = 650000000 ether;
    uint256 private constant liquidityAmount = 200000000 ether;

    uint256 public bondingCurveSupply = 0;

    // Anti-snipe: within 15s after creation, sellsmanFee decays quadratically from 80% to Pump's feeRatio[1]
    uint256 public createdAt;
    uint256 private constant ANTI_SNIPE_WINDOW = 15;
    uint256 private constant ANTI_SNIPE_SELLSMAN_FEE_MAX = 8000; // 80%
    uint256 private constant ANTI_SNIPE_DENOM = 225; // 15^2, used for quadratic decay

    // state
    address private manager; // pump contract address
    address public ipshareSubject;
    IBondingCurve public bondingCurve;
    bool public listed = false;
    bool initialized = false;

    // PCS V4 pool info
    ICLPoolManager public clPoolManager;
    IVault public vault;
    PoolId public v4PoolId;
    // In V4, tickSpacing and fee are fully decoupled.
    // fee=0 means zero native pool fee; all fees are collected by TipTagSwapHook.
    // tickSpacing=60 controls price-tick granularity only (no 0.3% DEX fee implied).
    int24 public constant TICK_SPACING = 60;
    // Tick offset for bounded liquidity range: log(25)/log(1.0001) ≈ 32190.
    // tickLower = currentTick - 32190 ensures that when all 800M circulating
    // tokens are sold back, the price hits P/25 and all ETH is fully drained.
    int24 private constant TICK_OFFSET_25X = 32190;

    receive() external payable {
        if (!listed) {
            buyToken(0, address(0), 0);
        }
    }

    function getIPShare() external view returns (address) {
        return ipshareSubject;
    }

    function initialize(address manager_, address ipshareSubject_, string memory tick) public {
        if (initialized) {
            revert TokenInitialized();
        }
        initialized = true;
        createdAt = block.timestamp;
        manager = manager_;
        ipshareSubject = ipshareSubject_;
        bondingCurve = IBondingCurve(manager_);
        _name = tick;
        _symbol = tick;
        _mint(address(this), bondingCurveTotalAmount + liquidityAmount);
        _mint(address(manager), socialDistributionAmount);

        // Set PCS V4 references
        clPoolManager = ICLPoolManager(IPump(manager).getPoolManager());
        vault = IVault(IPump(manager).getVault());
    }

    /********************************** bonding curve ********************************/
    function buyToken(
        uint256 expectAmount,
        address sellsman,
        uint16 slippage
    ) public payable nonReentrant returns (uint256) {
        require(msg.sender != address(clPoolManager), "can't buy token from pool");
        sellsman = _checkBondingCurveState(sellsman);
        (uint256 tiptagFeePercent, uint256 sellsmanFeePercent) = _getBuyFeeRatiosView();
        uint256 buyFunds = msg.value;
        uint256 tiptagFee = (msg.value * tiptagFeePercent) / divisor;
        uint256 sellsmanFee = (msg.value * sellsmanFeePercent) / divisor;

        if (sellsmanFee < 100000000) {
            revert DustIssue();
        }

        uint256 tokenReceived = bondingCurve.getBuyAmountByValue(
            bondingCurveSupply,
            buyFunds - tiptagFee - sellsmanFee
        );

        address tiptapFeeAddress = IPump(manager).getFeeReceiver();

        if (tokenReceived + bondingCurveSupply >= bondingCurveTotalAmount) {
            uint256 actualAmount = bondingCurveTotalAmount - bondingCurveSupply;
            if (slippage > 0 && (actualAmount < (expectAmount * (divisor - slippage)) / divisor)) {
                revert OutOfSlippage();
            }
            return _buyTokenFillToCap(actualAmount, tiptagFeePercent, sellsmanFeePercent, sellsman);
        } else {
            // Normal buy: fees already computed at entry using dynamic ratios from _getBuyFeeRatiosView()
            if (slippage > 0 && (tokenReceived < (expectAmount * (divisor - slippage)) / divisor)) {
                revert OutOfSlippage();
            }

            // CEI: update state before external calls
            bondingCurveSupply += tokenReceived;
            this.transfer(msg.sender, tokenReceived);

            (bool success, ) = tiptapFeeAddress.call{value: tiptagFee}("");
            if (!success) {
                revert CostFeeFail();
            }

            IIPShare(IPump(manager).getIPShare()).valueCapture{value: sellsmanFee}(sellsman);
            emit Trade(msg.sender, sellsman, true, tokenReceived, msg.value, tiptagFee, sellsmanFee);
            return tokenReceived;
        }
    }

    function sellToken(uint256 amount, uint256 expectReceive, address sellsman, uint16 slippage) public nonReentrant {
        sellsman = _checkBondingCurveState(sellsman);

        uint256 sellAmount = amount;
        if (balanceOf(msg.sender) < sellAmount) {
            sellAmount = balanceOf(msg.sender);
        }

        if (sellAmount < 100000000) {
            revert DustIssue();
        }

        uint256 afterSupply = 0;
        afterSupply = bondingCurveSupply - sellAmount;

        uint256 price = bondingCurve.getPrice(afterSupply, sellAmount);

        uint256[2] memory feeRatio = IPump(manager).getFeeRatio();
        address tiptagFeeAddress = IPump(manager).getFeeReceiver();

        uint256 tiptagFee = (price * feeRatio[0]) / divisor;
        uint256 sellsmanFee = (price * feeRatio[1]) / divisor;
        uint256 receivedEth = price - tiptagFee - sellsmanFee;

        if (expectReceive > 0 && slippage > 0 && (receivedEth < ((divisor - slippage) * expectReceive) / divisor)) {
            revert OutOfSlippage();
        }

        // CEI: update state before external calls
        transfer(address(this), sellAmount);
        bondingCurveSupply -= sellAmount;

        {
            (bool success1, ) = tiptagFeeAddress.call{value: tiptagFee}("");
            (bool success2, ) = msg.sender.call{value: receivedEth}("");
            if (!success1 || !success2) {
                revert RefundFail();
            }
        }

        IIPShare(IPump(manager).getIPShare()).valueCapture{value: sellsmanFee}(sellsman);

        emit Trade(msg.sender, sellsman, false, sellAmount, price, tiptagFee, sellsmanFee);
    }

    /**
     * Get current buy fee ratios (basis points, e.g. 100 = 1%).
     * 1. First buy (bondingCurveSupply == 0): uses Pump's feeRatio as-is.
     * 2. Within 15s after creation: tiptag = feeRatio[0]; sellsman decays quadratically from 80% to feeRatio[1].
     * 3. After 15s: uses Pump's configured feeRatio.
     */
    function getBuyFeeRatios() external view returns (uint256 tiptagFeePercent, uint256 sellsmanFeePercent) {
        return _getBuyFeeRatiosView();
    }

    function _getBuyFeeRatiosView() private view returns (uint256 tiptagFeePercent, uint256 sellsmanFeePercent) {
        uint256[2] memory feeRatio = IPump(manager).getFeeRatio();
        if (bondingCurveSupply == 0) {
            return (feeRatio[0], feeRatio[1]);
        }
        uint256 elapsed = block.timestamp - createdAt;
        if (elapsed >= ANTI_SNIPE_WINDOW) {
            return (feeRatio[0], feeRatio[1]);
        }
        uint256 remaining = ANTI_SNIPE_WINDOW - elapsed;
        sellsmanFeePercent =
            feeRatio[1] +
            ((ANTI_SNIPE_SELLSMAN_FEE_MAX - feeRatio[1]) * remaining * remaining) /
            ANTI_SNIPE_DENOM;
        return (feeRatio[0], sellsmanFeePercent);
    }

    function _buyTokenFillToCap(
        uint256 actualAmount,
        uint256 tiptagFeePercent,
        uint256 sellsmanFeePercent,
        address sellsman
    ) private returns (uint256) {
        uint256 priceBeforeFee = bondingCurve.getPrice(bondingCurveSupply, actualAmount);
        uint256 usedEth = (priceBeforeFee * divisor) / (divisor - tiptagFeePercent - sellsmanFeePercent);
        if (usedEth > msg.value) revert InsufficientFund();
        if (usedEth < msg.value) {
            (bool ok, ) = msg.sender.call{value: msg.value - usedEth}("");
            if (!ok) revert RefundFail();
        }
        uint256 tiptagFee = (usedEth * tiptagFeePercent) / divisor;
        uint256 sellsmanFee = (usedEth * sellsmanFeePercent) / divisor;
        address tiptapFeeAddress = IPump(manager).getFeeReceiver();
        // CEI: update state before external calls
        bondingCurveSupply += actualAmount;
        this.transfer(msg.sender, actualAmount);

        (bool success1, ) = tiptapFeeAddress.call{value: tiptagFee}("");
        if (!success1) revert CostFeeFail();
        IIPShare(IPump(manager).getIPShare()).valueCapture{value: sellsmanFee}(sellsman);
        emit Trade(msg.sender, sellsman, true, actualAmount, usedEth, tiptagFee, sellsmanFee);
        _makeLiquidityPool();
        return actualAmount;
    }

    function _checkBondingCurveState(address sellsman) private returns (address) {
        if (listed) {
            revert TokenListed();
        }
        if (sellsman == address(0)) {
            sellsman = ipshareSubject;
        } else if (!IIPShare(IPump(manager).getIPShare()).ipshareCreated(sellsman)) {
            revert IPShareNotCreated();
        }
        return sellsman;
    }

    /********************************** to dex (PancakeSwap V4 Infinity) ********************************/
    function _makeLiquidityPool() private {
        // 1. Platform listing fee
        address tiptagFeeAddress = IPump(manager).getFeeReceiver();
        (bool success1, ) = tiptagFeeAddress.call{value: 1 ether}("");
        require(success1, "Transfer ETH failed");

        uint256 tokenAmount = balanceOf(address(this));
        uint256 ethBalance = address(this).balance;

        // 2. Build the PoolKey (PCS V4 format)
        //    currency0 = Native ETH (address(0)), currency1 = Token
        //    tickSpacing is encoded in bytes32 parameters (bits [16-39])
        address hookAddr = IPump(manager).getHookAddress();

        bytes32 parameters = CLPoolParametersHelper.setTickSpacing(bytes32(0), TICK_SPACING);

        PoolKey memory poolKey = PoolKey({
            currency0: CurrencyLibrary.NATIVE, // Native ETH
            currency1: Currency.wrap(address(this)), // Token
            hooks: IHooks(hookAddr),
            poolManager: IPoolManager(address(clPoolManager)),
            fee: 0, // No native LP fee, all fees via Hook
            parameters: parameters
        });

        // 3. Calculate initial sqrtPriceX96 = sqrt(ethBalance / tokenAmount) * 2^96
        uint160 sqrtPriceX96 = _calculateSqrtPriceX96(ethBalance, tokenAmount);

        // 4. Calculate bounded tick range.
        //    tickLower is set so that price P/25 drains all ETH when all 800M
        //    circulating tokens are sold back into the pool.
        //    tickUpper = maxUsableTick (unlimited upside).
        int24 tickCurrent = TickMath.getTickAtSqrtRatio(sqrtPriceX96);
        int24 tickLower = _floorTick(tickCurrent - TICK_OFFSET_25X);
        int24 minTick = TickMath.minUsableTick(TICK_SPACING);
        if (tickLower < minTick) tickLower = minTick;
        int24 tickUpper = TickMath.maxUsableTick(TICK_SPACING);

        // 5. Initialize the pool
        clPoolManager.initialize(poolKey, sqrtPriceX96);

        // 6. Register pool in Hook for fee collection
        PoolId poolId = poolKey.toId();
        v4PoolId = poolId;
        ITipTagSwapHook(hookAddr).registerPool(poolId, address(this));

        // 7. Add bounded-range liquidity via vault.lock() callback
        bytes memory callbackData = abi.encode(poolKey, sqrtPriceX96, tickLower, tickUpper);
        vault.lock(callbackData);

        listed = true;
        emit TokenListedToDex(address(clPoolManager));
    }

    /// @notice ILockCallback — called by Vault during lock() for atomic liquidity addition
    function lockAcquired(bytes calldata data) external override returns (bytes memory) {
        require(msg.sender == address(vault), "Only Vault");

        (PoolKey memory poolKey, uint160 sqrtPriceX96, int24 tickLower, int24 tickUpper) = abi.decode(
            data,
            (PoolKey, uint160, int24, int24)
        );

        uint256 ethAmount = address(this).balance;

        // Compute liquidity from ETH side for bounded range:
        // L = ethAmount * 2^96 / (sqrtPriceCurrent - sqrtPriceLower)
        uint128 liquidity = _computeLiquidity(ethAmount, sqrtPriceX96, tickLower);

        ICLPoolManager.ModifyLiquidityParams memory params = ICLPoolManager.ModifyLiquidityParams({
            tickLower: tickLower,
            tickUpper: tickUpper,
            liquidityDelta: int256(uint256(liquidity)),
            salt: bytes32(0)
        });

        (BalanceDelta callerDelta, ) = clPoolManager.modifyLiquidity(poolKey, params, "");

        // Settle amounts owed to the pool
        int128 ethOwed = callerDelta.amount0();
        int128 tokenOwed = callerDelta.amount1();

        // Settle ETH (native currency) — send ETH to Vault
        if (ethOwed < 0) {
            uint256 ethToSettle = uint256(uint128(-ethOwed));
            vault.settle{value: ethToSettle}();
        }

        // Settle Token — transfer tokens to Vault then call settle
        if (tokenOwed < 0) {
            uint256 tokenToSettle = uint256(uint128(-tokenOwed));
            _transfer(address(this), address(vault), tokenToSettle);
            vault.settle();
        }

        // Take back any excess (should be minimal)
        if (ethOwed > 0) {
            vault.take(poolKey.currency0, address(this), uint256(uint128(ethOwed)));
        }
        if (tokenOwed > 0) {
            vault.take(poolKey.currency1, address(this), uint256(uint128(tokenOwed)));
        }

        return "";
    }

    /// @dev Calculate sqrtPriceX96 = sqrt(ethAmount / tokenAmount) * 2^96
    function _calculateSqrtPriceX96(uint256 ethAmount, uint256 tokenAmount) private pure returns (uint160) {
        // price = ethAmount / tokenAmount  (currency0/currency1 = ETH per token)
        // sqrtPrice = sqrt(ethAmount / tokenAmount)
        // sqrtPriceX96 = sqrtPrice * 2^96

        // Use: sqrtPriceX96 = sqrt(ethAmount * 2^192 / tokenAmount)
        // To avoid overflow: sqrtPriceX96 = sqrt(ethAmount * 2^96 / tokenAmount) * 2^48
        // Better: sqrtPriceX96 = sqrt(ethAmount) * 2^96 / sqrt(tokenAmount)

        uint256 numerator = ethAmount * (1 << 192);
        uint256 ratio = numerator / tokenAmount;
        return uint160(_sqrt(ratio));
    }

    /// @dev Integer square root (Babylonian method)
    function _sqrt(uint256 x) private pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    /// @dev Compute liquidity for bounded range using ETH-side formula:
    /// L = ethAmount * 2^96 / (sqrtPriceCurrent - sqrtPriceLower)
    function _computeLiquidity(
        uint256 ethAmount,
        uint160 sqrtPriceCurrent,
        int24 tickLower
    ) private pure returns (uint128) {
        uint160 sqrtPriceLower = TickMath.getSqrtRatioAtTick(tickLower);
        uint256 l = (ethAmount << 96) / (uint256(sqrtPriceCurrent) - uint256(sqrtPriceLower));
        if (l > type(uint128).max) l = type(uint128).max;
        return uint128(l);
    }

    /// @dev Floor tick to nearest TICK_SPACING multiple (rounds towards negative infinity)
    function _floorTick(int24 tick) private pure returns (int24) {
        int24 compressed = tick / TICK_SPACING;
        if (tick < 0 && tick % TICK_SPACING != 0) compressed--;
        return compressed * TICK_SPACING;
    }

    /********************************** erc20 function ********************************/
    function name() public view override returns (string memory) {
        return _name;
    }

    function symbol() public view override returns (string memory) {
        return _symbol;
    }

    // only listed token can do erc20 transfer functions
    function _beforeTokenTransfer(address from, address to, uint256 amount) internal override {
        // Before listing, prevent unauthorized token transfers to Vault
        if (!listed && to == address(vault) && from != address(this)) {
            revert TokenNotListed();
        }
        return super._beforeTokenTransfer(from, to, amount);
    }
}
