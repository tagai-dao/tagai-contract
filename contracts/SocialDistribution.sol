// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interface/IPump.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "./interface/ISocialDistribution.sol";

contract SocialDistribution is Ownable2Step, ReentrancyGuard, ISocialDistribution {

    address[] private pumps = [
        0xa77253Ac630502A35A6FcD210A01f613D33ba7cD,
        0x3DC52C69C3C8be568372E16d50E9F3FEc796610c,
        0xc9FaA3c05a5178C380d9C28Edffa38d90D606F22,
        0x0476571a77Cc8Fc28796935Cf173c265F2021448
    ];

    struct Distribution {
        uint128 startTime;
        uint128 endTime;
        uint256 amount;
    }

    address private claimSigner = 0x78C2aF38330C5b41Ae7946A313e43cDCEEaf8611;
    address private deployer;
    address private feeReceiver = 0x06Deb72b2e156Ddd383651aC3d2dAb5892d9c048;
    uint256 private claimFee = 0.001 ether;

    mapping(address => Distribution[]) private distributions;
    mapping(address => address) public getTokenDev;
    mapping(string => bool) public tickCreated;
    mapping(address => bool) public createdTokens;
    mapping(address => mapping(uint256 => bool)) public claimedOrder;
    mapping(address => uint256) public pendingClaimSocialRewards;
    mapping(address => uint256) public totalClaimedSocialRewards;
    mapping(address => uint128) public lastClaimTime;

    modifier onlyDeployer() {
        if (msg.sender != deployer) {
            revert OnlyDeployer();
        }
        _;
    }

    constructor() Ownable(msg.sender) {
        deployer = msg.sender;
    }

    function adminSetPumps(address[] memory _pumps) external onlyOwner {
        pumps = _pumps;
        emit AdminUpdatePumps(_pumps);
    }

    function adminSetDeployer(address _deployer) external onlyOwner {
        deployer = _deployer;
        emit AdminUpdateDeployer(_deployer);
    }

    function adminUpdateTokenDev(address token, address dev) external onlyOwner {
        if (!createdTokens[token]) {
            revert TokenNotCreated();
        }
        getTokenDev[token] = dev;
        emit AdminUpdateTokenDev(token, dev);
    }

    function adminUpdateSigner(address _claimSigner) external onlyOwner {
        claimSigner = _claimSigner;
        emit AdminUpdateSigner(_claimSigner);
    }
    
    function adminUpdateClaimFee(uint256 _claimFee) external onlyOwner {
        if (_claimFee > 0.05 ether) {
            revert TooMuchFee();
        }
        claimFee = _claimFee;
        emit AdminUpdateClaimFee(_claimFee);
    }

    function checkDistribution(Distribution[] calldata _distributions) public view {
        uint256 length = _distributions.length;
        if (length == 0) {
            revert InvalidPolicy();
        }

        uint128 timeStamp = uint128(block.timestamp);

        // clear old default distributions
        for (uint8 i = 0; i < length; i++) {
            uint128 startTime = _distributions[i].startTime;
            uint128 endTime = _distributions[i].endTime;

            if (i == 0 && startTime < timeStamp) {
                revert MustStartFromNow();
            }
            if (i > 0 && startTime != _distributions[i - 1].endTime + 1) {
                revert PolicyMustBeContinuous();
            }

            if (endTime <= startTime) {
                revert EndTimeMustBeGreaterThanStartTime();
            }
        }
    }

    /**
        @notice Deploy a new token with distributions
        @param token The address of the token
        @param dev The address of the token developer, can receive the transaction gas fee
        @param _distributions The distributions of the token distribution of this era, can set multi era if the last on is over
     */
    function deployNewToken(address token, address dev, Distribution[] calldata _distributions) external onlyDeployer {
        if (token == address(0)) {
            revert InvalidToken();
        }

        string memory symbol = ERC20(token).symbol();

        if (createdTokens[token]) {
            // check distribution finished
            Distribution[] memory socialDistribution = distributions[token];
            uint256 length = socialDistribution.length;
            if (length > 0) {
                if (socialDistribution[length - 1].endTime > uint128(block.timestamp)) {
                    revert DistributionNotFinished();
                }
            }
        }else {
            if (tickCreated[symbol]) {
                revert TokenAlreadyExists();
            }
            for (uint8 i = 0; i < pumps.length; i++) {
                if (IPump(pumps[i]).createdTicks(symbol)) {
                    revert TokenAlreadyExists();
                }
            }
        }

        checkDistribution(_distributions);
       

        tickCreated[symbol] = true;
        getTokenDev[token] = dev;
        createdTokens[token] = true;
        
        // distributions[token] = new Distribution[](_distributions.length);
    
        for (uint8 i = 0; i < _distributions.length; i++) {
            distributions[token].push(_distributions[i]);
        }
        
        emit NewTokenDeployed(token, dev, symbol);
    }

    function getDistribution(address token) external view returns (Distribution[] memory) {
        return distributions[token];
    }

    function calculateRewards(address token, uint128 startTime, uint128 endTime) public view returns (uint256) {
        Distribution[] memory tokenDistributions = distributions[token];
        uint256 rewards = 0;
        uint128 timestamp = startTime;
        if (tokenDistributions.length == 0 || uint128(block.timestamp) < tokenDistributions[0].startTime) {
            return rewards;
        }

        for (uint8 i = 0; i < tokenDistributions.length; i++) {
            if (timestamp > tokenDistributions[i].endTime) {
                continue;
            }
        
            if (timestamp < tokenDistributions[i].startTime) {
                timestamp = tokenDistributions[i].startTime - 1;
            }
            if (endTime <= tokenDistributions[i].endTime) {
                rewards += (endTime - timestamp) * tokenDistributions[i].amount;
                return rewards;
            } else {
                rewards += (tokenDistributions[i].endTime - timestamp) * tokenDistributions[i].amount;
                timestamp = tokenDistributions[i].endTime;
            }
        }
        return rewards;
    }

    function claimPendingSocialRewards(address token) public {
        // calculate rewards
        uint256 rewards = calculateRewards(token, lastClaimTime[token], uint128(block.timestamp));
        if (rewards > 0) {
            pendingClaimSocialRewards[token] += rewards;
            lastClaimTime[token] = uint128(block.timestamp);
            emit ClaimDistributedReward(token, uint128(block.timestamp), rewards);
        }
    }

    function userClaim(address token, uint256 orderId, uint256 amount, bytes calldata signature) public payable {
        if (!createdTokens[token]) {
            revert TokenNotCreated();
        }
        if (claimedOrder[token][orderId]) {
            revert ClaimOrderExist();
        }
        if (signature.length != 65) {
            revert InvalidSignature();
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

        if (pendingClaimSocialRewards[token] < amount) {
            claimPendingSocialRewards(token);
        }

        if (pendingClaimSocialRewards[token] < amount) {
            revert InvalidClaimAmount();
        }

        pendingClaimSocialRewards[token] -= amount;
        totalClaimedSocialRewards[token] += amount;
        claimedOrder[token][orderId] = true;
        
        ERC20(token).transfer(msg.sender, amount);

        emit UserClaimReward(token, orderId, msg.sender, amount);
    }

    function _check(bytes32 data, bytes memory signature) internal view returns (bool) {
        bytes32 messageHash = MessageHashUtils.toEthSignedMessageHash(data);
        return ECDSA.recover(messageHash, signature) == claimSigner;
    }
}