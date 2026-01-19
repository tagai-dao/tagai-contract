// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * Tagai prediction market oracle reward distribution
 */
contract OracleDistribution is Ownable2Step, ReentrancyGuard {

    error TooMuchFee();
    error CostFeeFail();
    error InvalidSignature();
    error InsufficientBalance();
    error ClaimOrderExist();

    event AdminUpdateSigner(address indexed signer);
    event AdminUpdateClaimFee(uint256 indexed claimFee);
    event AdminUpdateFeeReceiver(address indexed feeReceiver);
    event UserClaimReward(address indexed token, uint256 orderId, address indexed user, uint256 indexed amount);

    address private claimSigner = 0x78C2aF38330C5b41Ae7946A313e43cDCEEaf8611;
    address private feeReceiver = 0x06Deb72b2e156Ddd383651aC3d2dAb5892d9c048;
    uint256 private claimFee = 0.0005 ether;

    struct Market {
        address token;
        address market;
        uint256 amount;
    }

    mapping(address => Market) public marketReward;
    mapping(address => mapping(uint256 => bool)) public claimedOrder;



    constructor() Ownable(msg.sender) {
    }

    function adminUpdateSigner(address _claimSigner) external onlyOwner {
        claimSigner = _claimSigner;
        emit AdminUpdateSigner(_claimSigner);
    }

    function adminUpdateFeeReceiver(address _feeReceiver) external onlyOwner {
        feeReceiver = _feeReceiver;
        emit AdminUpdateFeeReceiver(_feeReceiver);
    }
    
    function adminUpdateClaimFee(uint256 _claimFee) external onlyOwner {
        if (_claimFee > 0.05 ether) {
            revert TooMuchFee();
        }
        claimFee = _claimFee;
        emit AdminUpdateClaimFee(_claimFee);
    }

    function newFee(address market, address token, uint256 amount) external {
        IERC20(token).transferFrom(msg.sender, address(this), amount);
        if (marketReward[market].token == address(0)) {
            marketReward[market] = Market(token, market, amount);
        }else {
            marketReward[market].amount += amount;
        }
    }


    function userClaim(address token, uint256 orderId, uint256 amount, bytes calldata signature) public payable {

        if (claimedOrder[token][orderId]) {
            revert ClaimOrderExist();
        }
        if (signature.length != 65) {
            revert InvalidSignature();
        }
        if (ERC20(token).balanceOf(address(this)) < amount) {
            revert InsufficientBalance();
        }
        if (msg.value < claimFee) {
            revert CostFeeFail();
        } else {
            (bool success, ) = feeReceiver.call{value: claimFee}("");
            if (!success) {
                revert CostFeeFail();
            }
        }
        
        bytes32 data = keccak256(abi.encodePacked(block.chainid, token, orderId, msg.sender, amount));

        if (!_check(data, signature)) {
            revert InvalidSignature();
        }

        claimedOrder[token][orderId] = true;
        
        ERC20(token).transfer(msg.sender, amount);

        emit UserClaimReward(token, orderId, msg.sender, amount);
    }

    function _check(bytes32 data, bytes memory signature) internal view returns (bool) {
        bytes32 messageHash = MessageHashUtils.toEthSignedMessageHash(data);
        return ECDSA.recover(messageHash, signature) == claimSigner;
    }
}