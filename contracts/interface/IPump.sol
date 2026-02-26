// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

interface IPump {
    // errors
    error TickHasBeenCreated();
    error SaltNotAvailable();
    error CantBeZeroAddress();
    error CantSetSocialDistributionMoreThanTotalSupply();
    error TooMuchFee();
    error InsufficientCreateFee();
    error TokenNotCreated();
    error PreMineTokenFail();
    error RefundFail();
    error TokenNotListed();
    error ClaimOrderExist();
    error InvalidSignature();
    error CostFeeFail();
    error InvalidClaimAmount();

    // events
    event NewToken(string tick, address indexed token, address indexed creator);
    event SocialDistributionContractChanged(address indexed oldContract, address indexed newContract);
    event IPShareChanged(address indexed oldIPShare, address indexed newIPShare);
    event CreateFeeChanged(uint256 indexed oldFee, uint256 indexed newFee);
    event FeeAddressChanged(address indexed oldAddress, address indexed newAddress);
    event FeeRatiosChanged(uint256 indexed donutFee, uint256 indexed sellsmanFee);
    event ClaimSignerChanged(address indexed oldSigner, address indexed newSigner);
    event ClaimFeeChanged(uint256 indexed oldFee, uint256 indexed newFee);
    event TokenImplementationChanged(address indexed oldImpl, address indexed newImpl);

    function getIPShare() external view returns (address);
    function getFeeReceiver() external view returns (address);
    function getFeeRatio() external view returns (uint256[2] memory);
    function getClaimFee() external view returns (uint256);
    function createToken(string calldata tick, bytes32 salt) external payable returns (address);
    function getClaimSigner() external view returns (address);

    // PancakeSwap V4 (Infinity)
    function getPoolManager() external view returns (address);
    function getVault() external view returns (address);
    function getHookAddress() external view returns (address);
    function createdTokens(address token) external view returns (bool);

    event ClaimDistributedReward(address indexed token, uint256 indexed timestamp, uint256 indexed amount);
    event UserClaimReward(address indexed token, uint256 orderId, address indexed user, uint256 indexed amount);
}
