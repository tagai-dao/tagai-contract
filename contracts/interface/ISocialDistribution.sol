// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

interface ISocialDistribution {
    error InvalidPolicy();
    error StartTimeNotZero();
    error PolicyMustBeContinuous();
    error EndTimeMustBeGreaterThanStartTime();
    error TokenAlreadyExists();
    error InvalidToken();
    error TokenNotCreated();
    error TooMuchFee();
    error CostFeeFail();
    error InvalidClaimAmount();
    error InvalidSignature();
    error ClaimOrderExist();

    event AdminSetDefaultDistribution();
    event AdminAddNewToken(address indexed token, address indexed dev, string indexed tick);
    event AdminUpdateTokenDev(address indexed token, address indexed dev);
    event AdminUpdateSigner(address indexed signer);
    event AdminUpdateClaimFee(uint256 indexed claimFee);
    event ClaimDistributedReward(address indexed token, uint128 indexed timestamp, uint256 indexed amount);
    event UserClaimReward(address indexed token, uint256 orderId, address indexed user, uint256 indexed amount);

    function getTokenDev(address token) external view returns (address);
}