// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

interface ICommunityFactory {
    function createCommunity(
        bool isMintable,
        address communityToken,
        address communityTokenFactory,
        bytes calldata tokenMeta,
        address rewardCalculator,
        bytes calldata distributionPolicy
    ) external payable returns (address community);
}

interface ICommunity {
    function adminAddPool(
        string memory poolName,
        uint16[] memory ratios,
        address poolFactory,
        bytes calldata meta
    ) external payable;

    function activedPools(uint256 index) external view returns (address);

    function transferOwnership(address newOwner) external;
}

interface ICommittee {
    function getCreateCommunityFee() external view returns (uint256);

    function getCommunitySettingsFee() external view returns (uint256);
}
