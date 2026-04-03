// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

interface ICommunityFactory {
    function createCommunity(bool isMintable, address commmunityToken, address communityTokenFactory, bytes calldata tokenMeta, address rewardCalculator, bytes calldata distributionPolicy) external payable returns (address);
}

interface ICommunity {
    function adminAddPool(string memory poolName,uint16[] memory ratios, address poolFacotry, bytes calldata meta) external payable;
}

interface ICommittee {
    function getCreateCommunityFee() external view returns (uint256);
    function getCommunitySettingsFee() external view returns (uint256);
}