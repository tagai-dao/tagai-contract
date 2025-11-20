// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract PopUp is Ownable2Step, ReentrancyGuard {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    uint256 public claimFee = 0.0005 ether;
   
    address public feeReceiver = 0x06Deb72b2e156Ddd383651aC3d2dAb5892d9c048;
    address public claimSigner = 0x78C2aF38330C5b41Ae7946A313e43cDCEEaf8611;
    // social distribution
    mapping(address => mapping(uint256 => bool)) public claimedOrder;

    event ClaimSignerChanged(address indexed oldSigner, address indexed newSigner);
    event ClaimFeeChanged(uint256 indexed oldFee, uint256 indexed newFee);
    event FeeAddressChanged(address indexed oldAddress, address indexed newAddress);
    event UserClaimReward(address indexed token, uint256 orderId, address indexed user, uint256 indexed amount);
    event EmergencyWithdrawETH(address indexed to, uint256 amount);
    event EmergencyWithdrawToken(address indexed token, address indexed to, uint256 amount);

    error TokenNotListed();
    error ClaimOrderExist();
    error InvalidSignature();
    error CostFeeFail();
    error InvalidClaimAmount();
    error TransferFailed();

    receive() external payable {}

    constructor() Ownable(msg.sender) {}

    // admin function
    function adminChangeClaimSigner(address signer) public onlyOwner {
        emit ClaimSignerChanged(claimSigner, signer);
        claimSigner = signer;
    }

    function adminSetClaimFee(uint256 _claimFee) public onlyOwner {
        emit ClaimFeeChanged(claimFee, _claimFee);
        claimFee = _claimFee;
    }

    function adminChangeFeeAddress(address _feeReceiver) public onlyOwner {
        emit FeeAddressChanged(feeReceiver, _feeReceiver);
        feeReceiver = _feeReceiver;
    }

    /// @notice Withdraw ETH from the contract
    function withdrawETH(address to, uint256 amount) external onlyOwner {
        if (amount > address(this).balance) {
            amount = address(this).balance;
        }
        (bool success, ) = to.call{value: amount}("");
        if (!success) revert TransferFailed();
        emit EmergencyWithdrawETH(to, amount);
    }

    /// @notice Withdraw ERC20 tokens from the contract
    function withdrawToken(address token, address to, uint256 amount) external onlyOwner {
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (amount > balance) {
            amount = balance;
        }
        IERC20(token).transfer(to, amount);
        emit EmergencyWithdrawToken(token, to, amount);
    }

    function userClaim(address token, uint256 orderId, uint256 amount, bytes calldata signature) public payable nonReentrant {
        if (claimedOrder[token][orderId]) {
            revert ClaimOrderExist();
        }
        
        // Fee processing with refund logic
        if (msg.value < claimFee) {
            revert CostFeeFail();
        }
        
        (bool success, ) = feeReceiver.call{value: claimFee}("");
        if (!success) {
            revert CostFeeFail();
        }

        // Refund excess ETH
        uint256 refund = msg.value - claimFee;
        if (refund > 0) {
            (bool refundSuccess, ) = msg.sender.call{value: refund}("");
            if (!refundSuccess) revert TransferFailed();
        }
        
        // Verify signature using OpenZeppelin libraries
        bytes32 data = keccak256(abi.encodePacked(block.chainid, token, orderId, msg.sender, amount));
        bytes32 ethSignedMessageHash = data.toEthSignedMessageHash();
        
        if (ethSignedMessageHash.recover(signature) != claimSigner) {
            revert InvalidSignature();
        }

        claimedOrder[token][orderId] = true;

        IERC20(token).transfer(msg.sender, amount);

        emit UserClaimReward(token, orderId, msg.sender, amount);
    }
}
