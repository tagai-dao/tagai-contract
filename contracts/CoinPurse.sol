// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./interface/ICoinPurse.sol";
import "./interface/IIPShare.sol";
interface IWBNB {
    function withdraw(uint wad) external;
}

contract CoinPurse is Ownable, Pausable, ReentrancyGuard, ICoinPurse {
    event Tip(address indexed from, address indexed to, address indexed token, uint toXId, uint amount);

    event LimitSet(address indexed user, address indexed token, uint256 maxPerTx, uint256 maxPerDay);

    event Withdraw(uint indexed xId, address indexed user, address[] tokens, uint[] amounts);

    struct Limit {
        uint256 maxPerTx;
        uint256 maxPerDay;
        uint256 spentToday;
        uint256 lastUpdatedDay;
    }

    address private WBNB = 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c;
    address public feeAddress = 0x06Deb72b2e156Ddd383651aC3d2dAb5892d9c048;
    address public operator;
    address public ipShare = 0x24328DccA1bA54EeE82e2993F021802e64290486;

    // user => token => limit
    mapping(address => mapping(address => Limit)) public userLimits;

    // Number of Hosting
    // X id => token => amount
    mapping(uint => mapping(address => uint)) public hostingAmount;

    // X id => address
    mapping(uint => address) public alreadyWithdraw;

    // platform fee, ipshare fee
    uint[2] public feeRates = [100, 100];
    uint public minFee = 0.0005 ether;
    uint private denominator = 10000;

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

    function _getFee(uint amountIn) internal view returns (uint256 platformFee, uint256 ipshareFee) {
        platformFee = (amountIn * feeRates[0]) / denominator;
        if (platformFee < minFee) platformFee = minFee;
        ipshareFee = (amountIn * feeRates[1]) / denominator;
        if (ipshareFee + platformFee > amountIn) {
            revert InsufficientFee();
        }
    }

    function _checkAndUpdateLimit(address user, address token, uint256 amount) internal {
        Limit storage limit = userLimits[user][token];
        if (amount > limit.maxPerTx) revert ExceedsPerLimit();

        uint256 today = _getToday();
        if (limit.lastUpdatedDay < today) {
            limit.spentToday = 0;
            limit.lastUpdatedDay = today;
        }

        if (limit.spentToday + amount > limit.maxPerDay) revert ExceedsDailyLimit();
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
        if (!_check(data, signature)) revert InvalidSignature();

        uint[] memory amounts;
        for (uint i = 0; i < tokens.length; i++) {
            IERC20(tokens[i]).transfer(msg.sender, hostingAmount[xId][tokens[i]]);
            amounts[i] = hostingAmount[xId][tokens[i]];
            hostingAmount[xId][tokens[i]] = 0;
        }
        alreadyWithdraw[xId] = msg.sender;
        if (!IERC20(WBNB).transferFrom(msg.sender, feeAddress, minFee)) revert TransferFromFailed();
        emit Withdraw(xId, msg.sender, tokens, amounts);
    }

    function tip(address user, address token, address to, uint256 toXId, uint256 amount) external onlyOperator nonReentrant whenNotPaused {
        _checkAndUpdateLimit(user, token, amount);
        if (to != address(0)) {
            if (!IERC20(token).transferFrom(user, to, amount)) revert TransferFailed();
        } else {
            if (toXId == uint(0)) revert InvalidToXId();
            if (alreadyWithdraw[toXId] != address(0)) revert AlreadyWithdraw();
            if (!IERC20(token).transferFrom(user, address(this), amount)) revert TransferFromFailed();
            hostingAmount[toXId][token] += amount;
        }

        if (!IERC20(WBNB).transferFrom(user, feeAddress, minFee)) revert TransferFromFailed();

        emit Tip(user, to, token, toXId, amount);
    }

    function internalSwap(
        address user,
        uint256 amountIn,
        address tokenOut,
        address sellsman,
        uint16 slippage,
        uint16 version
    ) external onlyOperator nonReentrant whenNotPaused {
        _checkAndUpdateLimit(user, WBNB, amountIn);

        // Step 1: Transfer from user
        if (!IERC20(WBNB).transferFrom(user, address(this), amountIn)) revert TransferFromFailed();

        // Step 2: Extract to bnb
        IWBNB(WBNB).withdraw(amountIn);

        // Step 3: Call swap
        if (version == 1) {
            (bool success, bytes memory receiveAmount) = tokenOut.call{value: amountIn}(
                abi.encodeWithSignature("buyToken(uint256,address,uint16,address)", 0, sellsman, slippage, user)
            );
            if (!success) revert BuyTokenFailed();

            // Step 4: send to user
            IERC20(tokenOut).transfer(user, abi.decode(receiveAmount, (uint256)));
        } else {
            (bool success, bytes memory receiveAmount) = tokenOut.call{value: amountIn}(
                abi.encodeWithSignature("buyToken(uint256,address,uint16)", 0, sellsman, slippage)
            );
            if (!success) revert BuyTokenFailed();

            // Step 4: send to user
            IERC20(tokenOut).transfer(user, abi.decode(receiveAmount, (uint256)));
        }
    }

    function externalSwap(
        address user,
        uint256 amountIn, // Note should include the cost
        uint256 amountOutMin,
        address[] calldata path,
        uint256 deadline,
        address router, // for uni or pancakeswap or other v2 dex router
        address sellsman
    ) external onlyOperator nonReentrant whenNotPaused {
        if (path.length < 2) revert InvalidPath();
        address tokenIn = path[0];
        if (tokenIn != WBNB) revert InvalidPath();
        _checkAndUpdateLimit(user, tokenIn, amountIn);

        (uint flatformFee, uint ipshareFee) = _getFee(amountIn);

        // Step 1: Transfer from user
        if (!IERC20(tokenIn).transferFrom(user, address(this), amountIn)) revert TransferFromFailed();

        // cost platform fee
        IWBNB(WBNB).withdraw(flatformFee + ipshareFee);
        (bool success, ) = feeAddress.call{value: flatformFee}("");
        if (!success) revert CostFeeFailed();

        // cost ipshare fee
        if (!IIPShare(ipShare).ipshareCreated(sellsman)) {
            (success, ) = feeAddress.call{value: ipshareFee}("");
            if (!success) revert CostFeeFailed();
        } else {
            IIPShare(ipShare).valueCapture{value: ipshareFee}(sellsman);
        }

        // Step 2: Approve to router
        require(IERC20(tokenIn).approve(router, amountIn - flatformFee - ipshareFee), "Approve failed");

        // Step 3: Call Uniswap
        IUniswapV2Router02(router).swapExactTokensForTokens(
            amountIn - flatformFee - ipshareFee,
            amountOutMin,
            path,
            user, // Send output back to user
            deadline
        );
    }

    function setFee(uint[2] calldata _feeRates, uint _minFee) external onlyOwner {
        feeRates = _feeRates;
        minFee = _minFee;
    }

    function setFeeAddress(address _feeAddress) external onlyOwner {
        if (_feeAddress == address(0)) revert InvalidAddress();
        feeAddress = _feeAddress;
    }

    function setOperator(address _operator) external onlyOwner {
        if (_operator == address(0)) revert InvalidAddress();
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

    function setWBNB(address wbnb) external onlyOwner {
        if (wbnb == address(0)) revert InvalidAddress();
        WBNB = wbnb;
    }
}
