// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

interface TagAIErrors {
    error ExceedsPerLimit();
    error ExceedsDailyLimit();
    error InvalidSignature();
    error InvalidToXId();
    error AlreadyWithdraw();
    error TransferFailed();
    error TransferFromFailed();
    error BuyTokenFailed();
    error InvalidPath();
    error CostFeeFailed();
    error InvalidAddress();
    error InsufficientFee();
    error MulticallFailed();
    error TipIdUsed();
    error SwapIdUsed();
    error ERC20InsufficientAllowance(address spender, uint256 currentAllowance, uint256 value);
    error ERC20InsufficientBalance(address from, uint256 fromBalance, uint256 value);
    error InsufficientBalance();
    error InsufficientAllowance();
}