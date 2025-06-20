// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

interface ISocialDistribution {
    error InvalidPolicy();
    error MustStartFromNow();
    error PolicyMustBeContinuous();
    error EndTimeMustBeGreaterThanStartTime();
    error TokenAlreadyExists();
    error DistributionNotFinished();
    error InvalidToken();
    error TokenNotCreated();
    error TooMuchFee();
    error CostFeeFail();
    error InvalidClaimAmount();
    error InvalidSignature();
    error InsufficientBalance();
    error ClaimOrderExist();
    error OnlyDeployer();
    event AdminSetDefaultDistribution();
    event NewTokenDeployed(address indexed token, address indexed dev, string indexed tick);
    event AdminUpdateTokenDev(address indexed token, address indexed dev);
    event AdminUpdateSigner(address indexed signer);
    event AdminUpdateDeployer(address indexed deployer);
    event AdminUpdateClaimFee(uint256 indexed claimFee);
    event AdminUpdatePumps(address[] pumps);
    event ClaimDistributedReward(address indexed token, uint128 indexed timestamp, uint256 indexed amount);
    event UserClaimReward(address indexed token, uint256 orderId, address indexed user, uint256 indexed amount);

    function getTokenDev(address token) external view returns (address);
}