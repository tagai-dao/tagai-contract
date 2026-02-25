// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

import {ERC20} from "./solady/src/tokens/ERC20.sol";
import {IWETH} from "./interface/IWETH.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./interface/IToken.sol";
import "./interface/IIPShare.sol";
import "./interface/IPump.sol";
import "./interface/IUniswapV2Router02.sol";
import "./interface/IUniswapV2Factory.sol";
import "./interface/IUniswapV2Pair.sol";
import "./interface/IBondingCurve.sol";
import "./interface/INonfungiblePositionManager.sol";

contract Token is IToken, ERC20, ReentrancyGuard {
    string private _name;
    string private _symbol;
    uint256 private constant divisor = 10000;
    address private constant BlackHole = 0x000000000000000000000000000000000000dEaD;

    // distribute token total amount
    uint256 private constant socialDistributionAmount = 150000000 ether;
    uint256 private constant bondingCurveTotalAmount = 650000000 ether;
    uint256 private constant liquidityAmount = 200000000 ether;

    uint256 public bondingCurveSupply = 0;

    // 防抢跑：创建后 15 秒内动态手续费（sellsmanFee 从 80% 二次降至 Pump 设置的 feeRatio[1]）
    uint256 public createdAt;
    uint256 private constant ANTI_SNIPE_WINDOW = 15;
    uint256 private constant ANTI_SNIPE_SELLSMAN_FEE_MAX = 8000;  // 80%
    uint256 private constant ANTI_SNIPE_DENOM = 225;  // 15^2，用于二次函数

    // state
    address private manager;        // pump contract address
    address public ipshareSubject;
    IBondingCurve public bondingCurve;
    bool public listed = false;
    bool initialized = false;

    // dex
    address public pair;

    receive() external payable {
        if (!listed) {
            buyToken(0, address(0), 0);
        }
    }

    function getIPShare() external view returns (address) {
        return ipshareSubject;
    }

    function initialize(
        address manager_, 
        address ipshareSubject_,
        string memory tick) public 
    {
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

        // create v2 pool and set price
        IUniswapV2Factory factory = IUniswapV2Factory(IPump(manager).getUniswapV2Factory());
        pair = factory.getPair(address(this), IPump(manager).getWETH());
        if (pair == address(0)) {
            pair = factory.createPair(address(this), IPump(manager).getWETH());
        }
    }

    /********************************** bonding curve ********************************/
    function buyToken(
        uint256 expectAmount,
        address sellsman,
        uint16 slippage
    ) public payable nonReentrant returns (uint256) {
        require(msg.sender != pair, "can't buy token to pair");
        sellsman = _checkBondingCurveState(sellsman);
        (uint256 tiptagFeePercent, uint256 sellsmanFeePercent) = _getBuyFeeRatiosView();
        uint256 buyFunds = msg.value;
        uint256 tiptagFee = (msg.value * tiptagFeePercent) / divisor;
        uint256 sellsmanFee = (msg.value * sellsmanFeePercent) / divisor;

        if (sellsmanFee < 100000000) {
            revert DustIssue();
        }

        uint256 tokenReceived = bondingCurve
            .getBuyAmountByValue(bondingCurveSupply, buyFunds - tiptagFee - sellsmanFee);

        address tiptapFeeAddress = IPump(manager).getFeeReceiver();

        if (tokenReceived + bondingCurveSupply >= bondingCurveTotalAmount) {
            uint256 actualAmount = bondingCurveTotalAmount - bondingCurveSupply;
            if (
                slippage > 0 &&
                (actualAmount > (expectAmount * (divisor + slippage)) / divisor ||
                    actualAmount < (expectAmount * (divisor - slippage)) / divisor)
            ) {
                revert OutOfSlippage();
            }
            return _buyTokenFillToCap(actualAmount, tiptagFeePercent, sellsmanFeePercent, sellsman);
        } else {
            // 普通买入：tiptagFee / sellsmanFee 已在函数开头按 _getBuyFeeRatiosView() 动态费率算好
            if (
                slippage > 0 &&
                (tokenReceived > (expectAmount * (divisor + slippage)) / divisor ||
                    tokenReceived < (expectAmount * (divisor - slippage)) / divisor)
            ) {
                revert OutOfSlippage();
            }

            (bool success, ) = tiptapFeeAddress.call{value: tiptagFee}("");
            if (!success) {
                revert CostFeeFail();
            }

            IIPShare(IPump(manager).getIPShare()).valueCapture{value: sellsmanFee}(sellsman);
            this.transfer(msg.sender, tokenReceived);
            bondingCurveSupply += tokenReceived;
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

        if (
            expectReceive > 0 &&
            slippage > 0 &&
            (receivedEth > ((divisor + slippage) * expectReceive) / divisor ||
                receivedEth < ((divisor - slippage) * expectReceive) / divisor)
        ) {
            revert OutOfSlippage();
        }

        transfer(address(this), sellAmount);

        {
            (bool success1, ) = tiptagFeeAddress.call{value: tiptagFee}("");
            (bool success2, ) = msg.sender.call{value: receivedEth}("");
            if (!success1 || !success2) {
                revert RefundFail();
            }
        }

        IIPShare(IPump(manager).getIPShare()).valueCapture{value: sellsmanFee}(sellsman);
        bondingCurveSupply -= sellAmount;

        emit Trade(msg.sender, sellsman, false, sellAmount, price, tiptagFee, sellsmanFee);
    }

    /**
     * 获取当前买入应使用的手续费比例（万分比，如 100 表示 1%）
     * 1. 创建时的那笔（bondingCurveSupply == 0）：使用 Pump 的 feeRatio
     * 2. 创建后 15 秒内：tiptag 固定为 feeRatio[0]，sellsman 按二次函数从 80% 降至 feeRatio[1]
     * 3. 15 秒后：使用 Pump 配置的 feeRatio
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
        sellsmanFeePercent = feeRatio[1]
            + (ANTI_SNIPE_SELLSMAN_FEE_MAX - feeRatio[1]) * remaining * remaining / ANTI_SNIPE_DENOM;
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
        (bool success1, ) = tiptapFeeAddress.call{value: tiptagFee}("");
        if (!success1) revert CostFeeFail();
        IIPShare(IPump(manager).getIPShare()).valueCapture{value: sellsmanFee}(sellsman);
        this.transfer(msg.sender, actualAmount);
        bondingCurveSupply += actualAmount;
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

    /********************************** to dex ********************************/
    function _makeLiquidityPool() private {
        address tiptagFeeAddress = IPump(manager).getFeeReceiver();
        (bool success1, ) = tiptagFeeAddress.call{value: 1 ether}("");
        require(success1, "Transfer ETH failed");

        uint256 tokenAmount = balanceOf(address(this));
        uint256 ethBalance = address(this).balance;
        
        _transfer(address(this), pair, tokenAmount);
        (bool success, ) = IPump(manager).getWETH().call{value: ethBalance}(abi.encodeWithSignature("deposit()"));
        require(success, "ETH to WETH failed");
        ERC20(IPump(manager).getWETH()).transfer(pair, ethBalance);

        IUniswapV2Pair(pair).mint(BlackHole);

        listed = true;
        emit TokenListedToDex(pair);
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
        if  (!listed && to == pair && from != address(this)) {
            revert TokenNotListed();
        }
        return super._beforeTokenTransfer(from, to, amount);
    }
}
