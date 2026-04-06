// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

/// @dev Minimal Committee for Pump integration tests (zero fees, whitelist calculators/factories).
contract MockNutboxCommittee {
    mapping(address => bool) public whitelist;
    uint256 public createCommunityFee;
    uint256 public communitySettingsFee;

    function adminWhitelist(address a) external {
        whitelist[a] = true;
    }

    function setFees(uint256 createFee_, uint256 settingsFee_) external {
        createCommunityFee = createFee_;
        communitySettingsFee = settingsFee_;
    }

    function verifyContract(address c) external view returns (bool) {
        return whitelist[c];
    }

    function getCreateCommunityFee() external view returns (uint256) {
        return createCommunityFee;
    }

    function getCommunitySettingsFee() external view returns (uint256) {
        return communitySettingsFee;
    }

    function getFeeRecipient() external view returns (address payable) {
        return payable(address(this));
    }

    receive() external payable {}
}

/// @dev Minimal calculator: records policy; rewards are zero (sufficient for createToken flow tests).
contract MockNutboxCalculator {
    function rewardHead() external view returns (uint256) {
        return block.timestamp;
    }

    function calculateReward(address, uint256, uint256) external pure returns (uint256) {
        return 0;
    }

    function setDistributionEra(address, bytes calldata) external pure returns (bool) {
        return true;
    }

    function getCurrentRewardRate(address) external pure returns (uint256) {
        return 0;
    }

    function getStartCursor(address) external pure returns (uint256) {
        return 0;
    }
}

contract MockSocialPool {}

contract MockSocialCurationFactory {
    function createPool(address, string memory, bytes calldata) external returns (address) {
        return address(new MockSocialPool());
    }
}

interface IPoolFactoryLite {
    function createPool(address community, string memory name, bytes calldata meta) external returns (address);
}

contract MockNutboxCommunity {
    address public owner;
    address public committee;
    address public communityToken;
    address public rewardCalculator;
    bool public isMintableCommunityToken;
    address[] private _pools;

    constructor(
        address admin_,
        address committee_,
        address token_,
        address calc_,
        bool mint_
    ) {
        owner = admin_;
        committee = committee_;
        communityToken = token_;
        rewardCalculator = calc_;
        isMintableCommunityToken = mint_;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Ownable: caller is not the owner");
        _;
    }

    function adminAddPool(
        string memory name_,
        uint16[] memory,
        address poolFactory,
        bytes calldata meta
    ) external payable onlyOwner {
        address pool = IPoolFactoryLite(poolFactory).createPool(address(this), name_, meta);
        _pools.push(pool);
    }

    function activedPools(uint256 index) external view returns (address) {
        return _pools[index];
    }

    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }
}

interface ICommitteeLite {
    function verifyContract(address c) external view returns (bool);
}

interface ICalculatorLite {
    function setDistributionEra(address staking, bytes calldata policy) external returns (bool);
}

/// @dev Mirrors CommunityFactory enough for Pump.createToken: new community, setDistributionEra on calculator.
contract MockNutboxCommunityFactory {
    address public immutable committee;

    constructor(address committee_) {
        committee = committee_;
    }

    function createCommunity(
        bool isMintable,
        address communityToken,
        address,
        bytes calldata,
        address rewardCalculator,
        bytes calldata distributionPolicy
    ) external payable returns (address) {
        require(ICommitteeLite(committee).verifyContract(rewardCalculator), "UC");
        MockNutboxCommunity c = new MockNutboxCommunity(
            msg.sender, committee, communityToken, rewardCalculator, isMintable
        );
        ICalculatorLite(rewardCalculator).setDistributionEra(address(c), distributionPolicy);
        return address(c);
    }
}
