// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./interface/IUniswapV2Router02.sol";
import "./interface/ISocialDistribution.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interface/IUniswapV3Router.sol";
import "./interface/IWETH.sol";

contract WrappedUniV2ForTagAI is Ownable, ReentrancyGuard {
    // address public uniswapRouter02 = 0x10ED43C718714eb63d5aA57B78B54704E256024E;
    address public WETH = 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c;
    address public feeAddress = 0x06Deb72b2e156Ddd383651aC3d2dAb5892d9c048;
    address public socialDistribution;

    uint16 public sellsmanRatio = 100;
    uint16 public tagaiRatio = 100;

    constructor(
        address _socialDistribution
    ) Ownable(msg.sender) {
        socialDistribution = _socialDistribution;
    }

    receive() external payable {}

    function adminSetFeeRatio(
        uint16 _sellsmanRatio,
        uint16 _tagaiRatio,
        address _WETH,
        address _feeAddress
    ) public onlyOwner {
        require(
            _sellsmanRatio < 1000 && _tagaiRatio < 1000,
            "fee ratio too high"
        );
        sellsmanRatio = _sellsmanRatio;
        tagaiRatio = _tagaiRatio;
        WETH = _WETH;
        feeAddress = _feeAddress;
    }

    function adminSetFeeAddress(address addr) public onlyOwner {
        feeAddress = addr;
    }

    function buyToken(
        address sellsman,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline,
        address uniswapRouter02
    ) public payable nonReentrant {
        require(path[0] == WETH, "wrong path");
        address _token = path[1];
        if (sellsman == address(0)) {
            sellsman = ISocialDistribution(socialDistribution).getTokenDev(_token);
            if (sellsman == address(0)) {
                sellsman = feeAddress;
            }
        }

        uint256 buyFund = msg.value;

        if (sellsmanRatio > 0) {
            uint256 sellsmanFee = (msg.value * sellsmanRatio) / 10000;
            buyFund = buyFund - sellsmanFee;

            (bool success, ) = sellsman.call{value: sellsmanFee}("");
            require(success, "Pay sellsman fee fail");
        }
        if (tagaiRatio > 0) {
            uint256 tagaiFee = (msg.value * tagaiRatio) / 10000;
            buyFund = buyFund - tagaiFee;
            (bool success, ) = feeAddress.call{value: tagaiFee}("");
            require(success, "Pay fee fail");
        }

        IUniswapV2Router02(uniswapRouter02).swapExactETHForTokens{
            value: buyFund
        }(amountOutMin, path, to, deadline);
    }

    function sellToken(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline,
        address sellsman,
        address uniswapRouter02
    ) public nonReentrant {
        require(path[1] == WETH, "wrong path");
        address _token = path[0];
        ERC20 token = ERC20(_token);
        if (sellsman == address(0)) {
            sellsman = ISocialDistribution(socialDistribution).getTokenDev(_token);
            if (sellsman == address(0)) {
                sellsman = feeAddress;
            }
        }

        IUniswapV2Router02 univ2 = IUniswapV2Router02(uniswapRouter02);
        uint[] memory amountOuts = univ2.getAmountsOut(amountIn, path);
        require(amountOuts.length > 0, "Failed to get amountOuts");
        require(
            token.approve(uniswapRouter02, amountOuts[0]),
            "Falied approve"
        );

        bool result = token.transferFrom(
            msg.sender,
            address(this),
            amountOuts[0]
        );
        require(result, "Transfer failed");

        uint[] memory amounts = univ2.swapExactTokensForETH(
            amountOuts[0],
            amountOutMin,
            path,
            address(this),
            deadline
        );
        uint amount = amounts[amounts.length - 1];
        if (sellsmanRatio > 0) {
            uint sellsmanFee = (amounts[amounts.length - 1] * sellsmanRatio) /
                10000;
            amount -= sellsmanFee;
            (bool success, ) = sellsman.call{value: sellsmanFee}("");
            require(success, "Pay sellsman fee fail");
        }
        if (tagaiRatio > 0) {
            uint256 tagaiFee = (amounts[amounts.length - 1] * tagaiRatio) /
                10000;
            amount -= tagaiFee;
            (bool res, ) = feeAddress.call{value: tagaiFee}("");
            require(res, "Pay fee fail");
        }
        {
            (bool success, ) = to.call{value: amount}("");
            require(success, "Transfer to failed");
        }
    }

    function buyTokenV3(
        address sellsman,
        uint256 amountOutMin,
        address token,
        address to,
        uint256 deadline,
        address uniswapRouterv3,
        uint24 poolFee
    ) public payable nonReentrant {
        // cost platform fee 
        if (sellsman == address(0)) {
            sellsman = ISocialDistribution(socialDistribution).getTokenDev(token);
            if (sellsman == address(0)) {
                sellsman = feeAddress;
            }
        }

        // cost ipshare fee
        uint256 buyFund = msg.value;

        if (sellsmanRatio > 0) {
            uint256 sellsmanFee = (msg.value * sellsmanRatio) / 10000;
            buyFund = buyFund - sellsmanFee;

            (bool success, ) = sellsman.call{value: sellsmanFee}("");
            require(success, "Pay sellsman fee fail");
        }
        if (tagaiRatio > 0) {
            uint256 tagaiFee = (msg.value * tagaiRatio) / 10000;
            buyFund = buyFund - tagaiFee;
            (bool success, ) = feeAddress.call{value: tagaiFee}("");
            require(success, "Pay fee fail");
        }

        // Call exactInputSingle
        IUniswapV3Router.ExactInputSingleParams memory params = IUniswapV3Router.ExactInputSingleParams({
            tokenIn: WETH,
            tokenOut: token,
            fee: poolFee,
            recipient: to,
            deadline: deadline,
            amountIn: buyFund,
            amountOutMinimum: amountOutMin,
            sqrtPriceLimitX96: 0
        });
        IUniswapV3Router(uniswapRouterv3).exactInputSingle{
            value: buyFund
        }(params);
        IUniswapV3Router(uniswapRouterv3).refundETH();
        if (address(this).balance > 0) {
            (bool success, ) = to.call{value: address(this).balance}("");
            require(success, "Transfer to failed");
        }
    }

    function sellTokenV3(
        uint256 amountIn,
        uint256 amountOutMin,
        address token,
        address to,
        uint256 deadline,
        address sellsman,
        address uniswapRouterv3,
        uint24 poolFee
    ) public nonReentrant {
        // 获取代币开发者地址
        if (sellsman == address(0)) {
            sellsman = ISocialDistribution(socialDistribution).getTokenDev(token);
            if (sellsman == address(0)) {
                sellsman = feeAddress;
            }
        }

        // 转移代币到合约
        ERC20(token).transferFrom(msg.sender, address(this), amountIn);

        // 授权 Uniswap V3 Router 使用代币
        require(ERC20(token).approve(uniswapRouterv3, amountIn), "Approve failed");

        // 调用 exactInputSingle 进行代币交换，将代币换成 WETH
        IUniswapV3Router.ExactInputSingleParams memory params = IUniswapV3Router.ExactInputSingleParams({
            tokenIn: token,
            tokenOut: WETH,
            fee: poolFee,
            recipient: address(this),
            deadline: deadline,
            amountIn: amountIn,
            amountOutMinimum: amountOutMin,
            sqrtPriceLimitX96: 0
        });

        IUniswapV3Router(uniswapRouterv3).exactInputSingle(params);

        // 将 WETH 换成 ETH
        uint256 wethBalance = IERC20(WETH).balanceOf(address(this));
        if (wethBalance > 0) {
            IWETH(WETH).withdraw(wethBalance);
        }

        // 处理手续费
        uint256 amount = address(this).balance;
        if (sellsmanRatio > 0) {
            uint256 sellsmanFee = (amount * sellsmanRatio) / 10000;
            amount -= sellsmanFee;
            (bool success, ) = sellsman.call{value: sellsmanFee}("");
            require(success, "Pay sellsman fee fail");
        }
        if (tagaiRatio > 0) {
            uint256 tagaiFee = (amount * tagaiRatio) / 10000;
            amount -= tagaiFee;
            (bool success, ) = feeAddress.call{value: tagaiFee}("");
            require(success, "Pay fee fail");
        }

        // 将剩余的 ETH 转给用户
        (bool success, ) = to.call{value: amount}("");
        require(success, "Transfer to failed");
    }

}
