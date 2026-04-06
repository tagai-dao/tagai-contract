// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interface/IPump.sol";
import "./Token.sol";
import "./interface/IIPShare.sol";
import "./interface/IBondingCurve.sol";

import "./solady/src/utils/FixedPointMathLib.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interface/INutbox.sol";

contract Pump is Ownable2Step, IPump, ReentrancyGuard, IBondingCurve {
    address private ipshare;
    address public tokenImplementation;
    uint256 public createFee = 0.005 ether;
    uint256 private divisor = 10000;
    address private feeReceiver = 0x06Deb72b2e156Ddd383651aC3d2dAb5892d9c048;
    address private tradeSigner = 0x78C2aF38330C5b41Ae7946A313e43cDCEEaf8611;
    uint256[2] private feeRatio = [30, 30]; // 0: to tiptag; 1: to salesman

    // BSC Nutbox stack — nutbox-contract ignition/deployments/chain-56/deployed_addresses.json
    address public nutboxCommunityFactory = 0x5597e814399906095ecaA5769A40394F58E5E0Cf;
    address public linearTimeCalculator = 0xc76e00e150e13EC95514E9a52Ab0314c7faE8207; // LinearTimeCalculator
    address public socialCurationFactory = 0xc4674D3fBbD201Ea401a8B7e7285F956178593D8;
    address public nutboxCommittee = 0xe10F967DD356504EDB731612789D0D0f0ba2929f;

    // PancakeSwap V4 (Infinity)
    address private poolManager = 0xa0FfB9c1CE1Fe56963B0321B32E7A0302114058b; // BSC CLPoolManager
    address private vault = 0x238a358808379702088667322f80aC48bAd5e6c4; // BSC Vault
    address private hookAddress; // TipTagSwapHook address

    mapping(address => bool) public createdTokens;
    mapping(string => bool) public createdTicks;
    mapping(address => uint256) private createdSaltsIndex;

    uint256 public totalTokens;

    /**
     * @param _ipshare IPShare contract address
     * @param _tokenImplementation Token implementation address (used for clone)
     * @param _feeReceiver Fee receiver address, pass address(0) to use default
     */
    constructor(address _ipshare, address _tokenImplementation, address _feeReceiver) Ownable(msg.sender) {
        ipshare = _ipshare;
        tokenImplementation = _tokenImplementation;
        if (_feeReceiver != address(0)) feeReceiver = _feeReceiver;
    }

    function adminSetPoolManager(address _poolManager) public onlyOwner {
        poolManager = _poolManager;
    }

    function adminSetVault(address _vault) public onlyOwner {
        vault = _vault;
    }

    function adminSetHookAddress(address _hookAddress) public onlyOwner {
        hookAddress = _hookAddress;
    }

    /// @notice Wire Nutbox stack (CommunityFactory, LinearTimeCalculator, SocialCurationFactory, Committee).
    function adminSetNutbox(
        address communityFactory_,
        address linearCalculator_,
        address socialCurationFactory_,
        address committee_
    ) external onlyOwner {
        nutboxCommunityFactory = communityFactory_;
        linearTimeCalculator = linearCalculator_;
        socialCurationFactory = socialCurationFactory_;
        nutboxCommittee = committee_;
    }

    receive() external payable {}

    // admin function
    function adminChangeIPShare(address _ipshare) public onlyOwner {
        emit IPShareChanged(ipshare, _ipshare);
        ipshare = _ipshare;
    }

    function adminChangeCreateFee(uint256 _createFee) public onlyOwner {
        if (_createFee > 1 ether) {
            revert TooMuchFee();
        }
        emit CreateFeeChanged(createFee, _createFee);
        createFee = _createFee;
    }

    function adminChangeFeeRatio(uint256[2] calldata ratios) public onlyOwner {
        if (ratios[0] > 1000 || ratios[1] > 1000) {
            revert TooMuchFee();
        }
        feeRatio = ratios;
        emit FeeRatiosChanged(ratios[0], ratios[1]);
    }

    function adminChangeTokenImplementation(address _tokenImplementation) public onlyOwner {
        emit TokenImplementationChanged(tokenImplementation, _tokenImplementation);
        tokenImplementation = _tokenImplementation;
    }

    function adminChangeFeeAddress(address _feeReceiver) public onlyOwner {
        emit FeeAddressChanged(feeReceiver, _feeReceiver);
        feeReceiver = _feeReceiver;
    }

    function adminSetTradeSigner(address _tradeSigner) public onlyOwner {
        tradeSigner = _tradeSigner;
    }

    function getIPShare() public view override returns (address) {
        return ipshare;
    }

    function getFeeReceiver() public view override returns (address) {
        return feeReceiver;
    }

    function getFeeRatio() public view override returns (uint256[2] memory) {
        return feeRatio;
    }

    function getTradeSigner() public view override returns (address) {
        return tradeSigner;
    }

    function getPoolManager() public view override returns (address) {
        return poolManager;
    }

    function getVault() public view override returns (address) {
        return vault;
    }

    function getHookAddress() public view override returns (address) {
        return hookAddress;
    }

    function getLastSaltIndex(address user) public view returns (uint256) {
        return createdSaltsIndex[user];
    }

    /// @dev LinearTimeCalculator policy: 3 eras, per-second amounts (wei), fixed calendar lengths.
    function _nutboxDistributionPolicy(uint256 t0) internal pure returns (bytes memory) {
        uint256 rate1 = 12_857_000_000_000_000_000; // 12.857 ether / sec
        uint256 rate2 = 6_423_500_000_000_000_000; // 6.4235 ether / sec
        uint256 rate3 = 3_211_700_000_000_000_000; // 3.2117 ether / sec
        uint256 len1 = 30 days;
        uint256 len2 = 90 days;
        uint256 len3 = 240 days;
        uint256 s1 = t0;
        uint256 e1 = s1 + len1 - 1;
        uint256 s2 = e1 + 1;
        uint256 e2 = s2 + len2 - 1;
        uint256 s3 = e2 + 1;
        uint256 e3 = s3 + len3 - 1;
        return abi.encodePacked(uint8(3), s1, e1, rate1, s2, e2, rate2, s3, e3, rate3);
    }

    function createToken(string calldata tick, bytes32 salt) public payable override nonReentrant returns (address) {
        require(msg.sender == tx.origin, "Only EOA");

        if (
            nutboxCommunityFactory == address(0) || linearTimeCalculator == address(0)
                || socialCurationFactory == address(0) || nutboxCommittee == address(0)
        ) {
            revert NutboxNotConfigured();
        }

        if (createdTicks[tick]) {
            revert TickHasBeenCreated();
        }
        if (uint256(salt) <= createdSaltsIndex[msg.sender]) {
            revert SaltNotAvailable();
        }
        createdTicks[tick] = true;

        address creator = msg.sender;
        bool needCreateIPShare = !IIPShare(ipshare).ipshareCreated(creator);
        uint256 ipshareCreateFee = 0;
        if (needCreateIPShare) {
            ipshareCreateFee = IIPShare(ipshare).createFee();
        }

        uint256 nutboxFees = ICommittee(nutboxCommittee).getCreateCommunityFee()
            + ICommittee(nutboxCommittee).getCommunitySettingsFee();
        uint256 totalFixedFee = createFee + ipshareCreateFee + nutboxFees;

        if (msg.value < totalFixedFee) {
            revert InsufficientCreateFee();
        }

        if (needCreateIPShare) {
            IIPShare(ipshare).createShare{value: ipshareCreateFee}(creator);
        }

        if (createFee > 0) {
            (bool success, ) = feeReceiver.call{value: createFee}("");
            if (!success) {
                revert InsufficientCreateFee();
            }
        }

        bytes32 cloneSalt = keccak256(abi.encode(msg.sender, salt));
        address instance = Clones.cloneDeterministic(tokenImplementation, cloneSalt);
        createdSaltsIndex[msg.sender] = uint256(salt);

        emit NewToken(tick, instance, creator);

        Token(payable(instance)).initialize(address(this), creator, tick);

        if (msg.value > totalFixedFee) {
            (bool success1, bytes memory receiveAmount) = instance.call{value: msg.value - totalFixedFee}(
                abi.encodeWithSignature("buyToken(uint256,address,uint16)", 0, creator, 0)
            );
            if (!success1) {
                revert PreMineTokenFail();
            }
            uint256 receiveAmountUint = abi.decode(receiveAmount, (uint256));

            IERC20(instance).transfer(msg.sender, receiveAmountUint);
            uint256 leftValue = address(this).balance;
            if (leftValue > 0) {
                (bool success2, ) = msg.sender.call{value: leftValue}("");
                if (!success2) {
                    revert RefundFail();
                }
            }
        }

        uint256 t0 = block.timestamp + 1;
        bytes memory policy = _nutboxDistributionPolicy(t0);

        uint256 createCommFee = ICommittee(nutboxCommittee).getCreateCommunityFee();
        uint256 settingsFee = ICommittee(nutboxCommittee).getCommunitySettingsFee();

        address community = ICommunityFactory(nutboxCommunityFactory).createCommunity{value: createCommFee}(
            false,
            instance,
            address(0),
            bytes(""),
            linearTimeCalculator,
            policy
        );

        uint256 allocation = Token(payable(instance)).NUTBOX_ALLOCATION();
        IERC20(instance).transfer(community, allocation);

        ICommunity(community).adminAddPool{value: settingsFee}(
            "Social Curation", _singlePoolRatios(), socialCurationFactory, bytes("")
        );

        address pool = ICommunity(community).activedPools(0);
        Token(payable(instance)).setNutboxAddresses(community, pool);

        emit NutboxLinked(instance, community, pool);

        ICommunity(community).transferOwnership(creator);

        createdTokens[instance] = true;
        totalTokens += 1;
        return instance;
    }

    function _singlePoolRatios() private pure returns (uint16[] memory ratios) {
        ratios = new uint16[](1);
        ratios[0] = 10_000;
    }

    /**
     * Predict the cloned token address from deployer and salt.
     */
    function predictTokenAddress(address deployer, bytes32 salt) public view returns (address) {
        bytes32 cloneSalt = keccak256(abi.encode(deployer, salt));
        return Clones.predictDeterministicAddress(tokenImplementation, cloneSalt, address(this));
    }

    /********************************** bonding curve ********************************/

    /**
     * calculate the eth price when user buy amount tokens
     */
    function getPrice(uint256 supply, uint256 amount) public pure override returns (uint256) {
        require(supply <= 1000000000 ether && amount <= 1000000000 ether, "supply or amount too large");
        uint256 a = 6_500_000_000;
        uint256 b = 2.5175516438e26;
        uint256 x = FixedPointMathLib.mulWad(a, b);
        uint256 e1 = uint256(FixedPointMathLib.expWad(int256(((supply + amount) * 1e18) / b)));
        uint256 e2 = uint256(FixedPointMathLib.expWad(int256(((supply) * 1e18) / b)));
        return FixedPointMathLib.mulWad(e1 - e2, x);
    }

    function getSellPrice(uint256 supply, uint256 amount) public pure override returns (uint256) {
        return getPrice(supply - amount, amount);
    }

    function getBuyPriceAfterFee(uint256 supply, uint256 amount) public view override returns (uint256) {
        uint256 price = getPrice(supply, amount);
        return ((price * divisor) / (divisor - feeRatio[0] - feeRatio[1]));
    }

    function getSellPriceAfterFee(uint256 supply, uint256 amount) public view override returns (uint256) {
        uint256 price = getSellPrice(supply, amount);
        return (price * (divisor - feeRatio[0] - feeRatio[1])) / divisor;
    }

    function getBuyAmountByValue(uint256 bondingCurveSupply, uint256 ethAmount) public pure override returns (uint256) {
        require(bondingCurveSupply <= 1000000000 ether && ethAmount <= 1000000000 ether, "supply or amount too large");
        uint256 a = 6_500_000_000;
        uint256 b = 2.5175516438e26;
        uint256 ab = FixedPointMathLib.mulWad(a, b);
        uint256 sab = FixedPointMathLib.divWad(ethAmount, ab);
        uint256 e = uint256(FixedPointMathLib.expWad(int256((bondingCurveSupply * 1e18) / b)));
        uint256 ln = uint256(FixedPointMathLib.lnWad(int256(sab + e)));
        return FixedPointMathLib.mulWad(b, ln) - bondingCurveSupply;
    }
}
