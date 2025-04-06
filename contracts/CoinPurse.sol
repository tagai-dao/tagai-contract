// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

interface IWBNB {
    function withdraw(uint wad) external;
}

contract CoinPurse is Ownable, Pausable, ReentrancyGuard {
    event Tip(address indexed from, address indexed to, address indexed token, uint toXId, uint amount);

    event LimitSet(address indexed user, address indexed token, uint256 maxPerTx, uint256 maxPerDay);

    event Withdraw(uint indexed xId, address indexed user, address[] tokens, uint[] amounts);

    struct Limit {
        uint256 maxPerTx;
        uint256 maxPerDay;
        uint256 spentToday;
        uint256 lastUpdatedDay;
    }

    IUniswapV2Router02 public router = IUniswapV2Router02(0x10ED43C718714eb63d5aA57B78B54704E256024E);
    address public WBNB = 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c;
    address public feeAddress = 0x06Deb72b2e156Ddd383651aC3d2dAb5892d9c048;
    address public operator;

    // user => token => limit
    mapping(address => mapping(address => Limit)) public userLimits;

    // Number of Hosting
    // X id => token => amount
    mapping(uint => mapping(address => uint)) public hostingAmount;

    // X id => address
    mapping(uint => address) public alreadyWithdraw;

    uint public feeRate = 500;
    uint public minFee = 0.001 ether;
    uint denominator = 10000;

    constructor() Ownable(msg.sender) {
        operator = msg.sender;
    }

    modifier onlyOperator() {
        require(msg.sender == operator, "Invalid operator");
        _;
    }

    function pause() public onlyOwner {
        _pause();
    }

    function unpause() public onlyOwner {
        _unpause();
    }

    function _getToday() internal view returns (uint256) {
        return block.timestamp / 1 days;
    }

    function _getFee(uint amountIn) internal view returns (uint256) {
        uint fee = (amountIn * feeRate) / denominator;
        if (fee < minFee) return minFee;
        return fee;
    }

    function _checkAndUpdateLimit(address user, address token, uint256 amount) internal {
        Limit storage limit = userLimits[user][token];
        require(amount <= limit.maxPerTx, "Exceeds per-tx limit");

        uint256 today = _getToday();
        if (limit.lastUpdatedDay < today) {
            limit.spentToday = 0;
            limit.lastUpdatedDay = today;
        }

        require(limit.spentToday + amount <= limit.maxPerDay, "Exceeds daily limit");
        limit.spentToday += amount;
    }

    function setLimit(address token, uint256 maxPerTx, uint256 maxPerDay) external {
        address user = msg.sender;
        Limit storage limit = userLimits[user][token];
        limit.maxPerTx = maxPerTx;
        limit.maxPerDay = maxPerDay;
        emit LimitSet(user, token, maxPerTx, maxPerDay);
    }

    function withdraw(uint xId, address[] calldata tokens, bytes calldata signature) external whenNotPaused nonReentrant {
        bytes32 data = keccak256(abi.encodePacked(block.chainid, xId, tokens, msg.sender));
        require(_check(data, signature), "Invalid signature");

        uint[] memory amounts;
        for (uint i = 0; i < tokens.length; i++) {
            IERC20(tokens[i]).transfer(msg.sender, hostingAmount[xId][tokens[i]]);
            amounts[i] = hostingAmount[xId][tokens[i]];
            hostingAmount[xId][tokens[i]] = 0;
        }
        alreadyWithdraw[xId] = msg.sender;
        emit Withdraw(xId, msg.sender, tokens, amounts);
    }

    function tip(address user, address token, address to, uint256 toXId, uint256 amount) external onlyOperator nonReentrant whenNotPaused {
        _checkAndUpdateLimit(user, token, amount);
        if (to != address(0)) {
            require(IERC20(token).transferFrom(user, to, amount), "Transfer failed");
        } else {
            require(toXId != uint(0), "Invalid toXId");
            require(alreadyWithdraw[toXId] == address(0), "Already withdraw");
            require(IERC20(token).transferFrom(user, address(this), amount), "Transfer failed");
            hostingAmount[toXId][token] += amount;
        }

        emit Tip(user, to, token, toXId, amount);
    }

    function internalSwap(
        address user,
        uint256 amountIn,
        address tokenOut,
        address sellsman,
        uint16 slippage
    ) external onlyOperator nonReentrant whenNotPaused {
        _checkAndUpdateLimit(user, WBNB, amountIn);

        // Step 1: Transfer from user
        require(IERC20(WBNB).transferFrom(user, address(this), amountIn), "TransferFrom failed");

        // Step 2: Extract to bnb
        IWBNB(WBNB).withdraw(amountIn);

        // Step 3: Call swap
        (bool success, bytes memory receiveAmount) = tokenOut.call{value: amountIn}(
            abi.encodeWithSignature("buyToken(uint256,address,uint16)", 0, sellsman, slippage)
        );
        require(success, "buyToken failed");

        // Step 4: send to user
        IERC20(tokenOut).transfer(user, abi.decode(receiveAmount, (uint256)));
    }

    function externalSwap(
        address user,
        uint256 amountIn,   // Note should include the cost
        uint256 amountOutMin,
        address[] calldata path,
        uint256 deadline
    ) external onlyOperator nonReentrant whenNotPaused {
        require(path.length >= 2, "Invalid path");
        address tokenIn = path[0];
        require(tokenIn == WBNB, "Invalid path[0]");
        _checkAndUpdateLimit(user, tokenIn, amountIn);

        // Step 1: Transfer from user
        require(IERC20(tokenIn).transferFrom(user, address(this), amountIn), "TransferFrom failed");

        uint fee = _getFee(amountIn);
        IWBNB(WBNB).withdraw(fee);
        (bool success, ) = feeAddress.call{value: fee}("");
        require(success, "Fee failed");

        // Step 2: Approve to router
        require(IERC20(tokenIn).approve(address(router), amountIn - fee), "Approve failed");

        // Step 3: Call Uniswap
        router.swapExactTokensForTokens(
            amountIn - fee,
            amountOutMin,
            path,
            user, // Send output back to user
            deadline
        );
    }

    function setFee(uint _feeRate, uint _minFee) external onlyOwner {
        feeRate = _feeRate;
        minFee = _minFee;
    }

    function setFeeAddress(address _feeAddress) external onlyOwner {
        require(_feeAddress != address(0), "Invalid address");
        feeAddress = _feeAddress;
    }

    function setOperator(address _operator) external onlyOwner {
        require(_operator != address(0), "Invalid address");
        operator = _operator;
    }

    function _check(bytes32 data, bytes calldata sign) internal view returns (bool) {
        bytes32 r = abi.decode(sign[:32], (bytes32));
        bytes32 s = abi.decode(sign[32:64], (bytes32));
        uint8 v = uint8(sign[64]);
        if (v < 27) {
            if (v == 0 || v == 1) v += 27;
        }
        bytes memory profix = "\x19Ethereum Signed Message:\n32";
        bytes32 info = keccak256(abi.encodePacked(profix, data));
        address addr = ECDSA.recover(info, v, r, s);
        return addr == operator;
    }
}
