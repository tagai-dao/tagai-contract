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
import "./interface/ITagAIErrors.sol";
interface IWBNB {
    function withdraw(uint wad) external;
}

contract CoinPurse is Ownable, Pausable, ReentrancyGuard, ICoinPurse, TagAIErrors {
    struct Limit {
        uint256 maxPerTx;
        uint256 maxPerDay;
        uint256 spentToday;
        uint256 lastUpdatedDay;
    }

    struct MulticallResult {
        bool success;
        uint256 orderId;
        bytes returnData;
    }

    address private WBNB = 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c;
    address public feeAddress = 0x06Deb72b2e156Ddd383651aC3d2dAb5892d9c048;
    address public operator = 0x78C2aF38330C5b41Ae7946A313e43cDCEEaf8611;
    address public ipShare = 0x24328DccA1bA54EeE82e2993F021802e64290486;

    // user => token => limit
    mapping(address => mapping(address => Limit)) public userLimits;

    // Number of Hosting
    // X id => token => amount
    mapping(uint => mapping(address => uint)) public hostingAmount;

    // X id => address
    mapping(uint => address) public alreadyWithdraw;

    mapping(uint256 => bool) public orderIdUsed;
    mapping(uint256 => bytes) public orderIdError;
    mapping(address => uint256) public userBalances;

    // platform fee, ipshare fee
    uint[2] public feeRates = [100, 100];
    uint public minFee = 0.0005 ether;
    uint private denominator = 10000;

    constructor() Ownable(msg.sender) {}

    receive() external payable {}

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
            revert CostFeeFailed();
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

    function checkLimit(address user, address token, uint256 amount) public view returns (uint256) {
        Limit storage limit = userLimits[user][token];
        if (amount > limit.maxPerTx) {
            return 1;
        }
        if (limit.spentToday + amount > limit.maxPerDay) {
            return 2;
        }
        return 0;
    }

    function setLimit(address token, uint256 maxPerTx, uint256 maxPerDay) external payable {
        address user = msg.sender;
        Limit storage limit = userLimits[user][token];
        limit.maxPerTx = maxPerTx;
        limit.maxPerDay = maxPerDay;
        if (token == address(0)) {
            userBalances[user] += msg.value;
        }
        emit LimitSet(user, token, maxPerTx, maxPerDay);
    }

    function withdrawBNB(uint256 amount) external whenNotPaused {
        if (userBalances[msg.sender] < amount) revert InsufficientBalance();
        userBalances[msg.sender] -= amount;
        (bool success, ) = msg.sender.call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    function withdraw(uint xId, address[] calldata tokens, bytes calldata signature) external payable whenNotPaused nonReentrant {
        bytes32 data = keccak256(abi.encodePacked(block.chainid, xId, tokens, msg.sender));
        if (!_check(data, signature)) revert InvalidSignature();

        if (msg.value < minFee) revert InsufficientFee();

        (bool success, ) = feeAddress.call{value: msg.value}("");
        if (!success) revert CostFeeFailed();

        uint[] memory amounts = new uint[](tokens.length);
        for (uint i = 0; i < tokens.length; i++) {
            IERC20(tokens[i]).transfer(msg.sender, hostingAmount[xId][tokens[i]]);
            amounts[i] = hostingAmount[xId][tokens[i]];
            hostingAmount[xId][tokens[i]] = 0;
        }
        alreadyWithdraw[xId] = msg.sender;
        emit Withdraw(xId, msg.sender, tokens, amounts);
    }

    function tryAggregate(bool requireSuccess, uint256[] calldata orderIds, bytes[] calldata calls) public returns (MulticallResult[] memory returnData) {
        returnData = new MulticallResult[](calls.length);
        for (uint256 i = 0; i < calls.length; i++) {
            (bool success, bytes memory ret) = address(this).delegatecall(calls[i]);
            if (requireSuccess && !success) {
                revert MulticallFailed();
            }
            returnData[i] = MulticallResult(success, orderIds[i], ret);
            if (!success) {
                orderIdUsed[orderIds[i]] = true;
                if (keccak256(ret) != keccak256(abi.encodeWithSelector(OrderIdUsed.selector))) {
                    // if reused id, keep the original error
                    orderIdError[orderIds[i]] = ret.length == 0 ? bytes("0x01") : ret;
                }
            }
        }
        return returnData;
    }

    function tip(uint256 orderId, address user, address token, address to, uint256 toXId, uint256 amount) public onlyOperator nonReentrant whenNotPaused {
        if (orderIdUsed[orderId]) revert OrderIdUsed();
        orderIdUsed[orderId] = true;
        if (userBalances[user] < minFee) revert InsufficientBalance();
        _checkAndUpdateLimit(user, token, amount);
        _checkAndUpdateLimit(user, address(0), minFee);
        if (to != address(0)) {
            if (!IERC20(token).transferFrom(user, to, amount)) revert TransferFailed();
        } else {
            if (toXId == uint(0)) revert InvalidToXId();
            if (alreadyWithdraw[toXId] != address(0)) revert AlreadyWithdraw();
            if (!IERC20(token).transferFrom(user, address(this), amount)) revert TransferFromFailed();
            hostingAmount[toXId][token] += amount;
        }
        userBalances[user] -= minFee;
        (bool success, ) = feeAddress.call{value: minFee}("");
        if (!success) revert CostFeeFailed();

        emit Tip(user, to, token, toXId, amount);
    }

    function internalSwap(
        uint256 orderId,
        address user,
        uint256 amountIn,
        address tokenOut,
        address sellsman,
        uint16 slippage,
        uint16 version
    ) public onlyOperator nonReentrant whenNotPaused {
        if (orderIdUsed[orderId]) revert OrderIdUsed();
        orderIdUsed[orderId] = true;
        // Step 1: check balance
        if (userBalances[user] < amountIn) revert InsufficientBalance();

        // Step 2: update balance
        userBalances[user] -= amountIn;

        _checkAndUpdateLimit(user, address(0), amountIn);

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
        uint256 orderId,
        address user,
        uint256 amountIn, // Note should include the cost
        uint256 amountOutMin,
        address[] calldata path,
        uint256 deadline,
        address router, // for uni or pancakeswap or other v2 dex router
        address sellsman
    ) public onlyOperator nonReentrant whenNotPaused {
        if (orderIdUsed[orderId]) revert OrderIdUsed();
        orderIdUsed[orderId] = true;
        if (path.length < 2) revert InvalidPath();
        if (path[0] != WBNB) revert InvalidPath(); // tokenIn

        // Step 1: check balance
        if (userBalances[user] < amountIn) revert InsufficientBalance();

        // Step 2: update balance
        userBalances[user] -= amountIn;

        _checkAndUpdateLimit(user, address(0), amountIn);

        (uint flatformFee, uint ipshareFee) = _getFee(amountIn);

        // Step 1: Transfer from user

        // cost platform fee
        // IWBNB(WBNB).withdraw(flatformFee + ipshareFee);
        (bool success, ) = feeAddress.call{value: flatformFee}("");
        if (!success) revert CostFeeFailed();

        // cost ipshare fee
        if (!IIPShare(ipShare).ipshareCreated(sellsman)) {
            (success, ) = feeAddress.call{value: ipshareFee}("");
            if (!success) revert CostFeeFailed();
        } else {
            IIPShare(ipShare).valueCapture{value: ipshareFee}(sellsman);
        }
        uint amount = amountIn - flatformFee - ipshareFee;

        IUniswapV2Router02(router).swapExactETHForTokens{value: amount}(amountOutMin, path, user, deadline);
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

    function setIpShare(address addr) external onlyOwner {
        if (addr == address(0)) revert InvalidAddress();
        ipShare = addr;
    }
}
