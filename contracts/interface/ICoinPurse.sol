// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

interface ICoinPurse {
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
}