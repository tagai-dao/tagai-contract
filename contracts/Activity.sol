// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract ActivityRewardPool is Ownable2Step, ReentrancyGuard {

    struct Activity {
        uint256 id;
        address token;
        uint256 amount;
        uint64 startTime;
        uint256 endTime;
    }

    error ClaimOrderExist();
    error InvalidSignature();
    error TokenNotCreated();
    error CostFeeFail();
    error InvalidClaimAmount();

    mapping(uint256 => Activity) public activities;
    address claimSigner = 0x78C2aF38330C5b41Ae7946A313e43cDCEEaf8611;
    address feeReceiver = 0x06Deb72b2e156Ddd383651aC3d2dAb5892d9c048;
    uint256 claimFee = 0.001 ether;
    mapping(address => mapping(uint256 => bool)) public orderClaimed;

    event ActivityCreated(uint256 id, address token, uint256 amount, uint64 startTime, uint256 endTime);
    event UserClaimReward(address token, uint256 orderId, address user, uint256 amount);

    constructor() Ownable(msg.sender) {}

    function createActivity(
        uint256 id, 
        address token, 
        uint256 amount, 
        uint64 startTime, 
        uint256 endTime) 
        public onlyOwner 
    {
        activities[id] = Activity(id, token, amount, startTime, endTime);
        bool success = IERC20(token).transferFrom(msg.sender, address(this), amount);
        require(success, "Transfer failed");
        emit ActivityCreated(id, token, amount, startTime, endTime);
    }

    function getActivity(uint256 id) public view returns (Activity memory) {
        return activities[id];
    }

    function userClaim(
        address token, 
        uint256 orderId, 
        uint256 amount, 
        bytes calldata signature
    ) public nonReentrant payable
    {
        if (orderClaimed[token][orderId]) {
            revert ClaimOrderExist();
        }
        if (signature.length != 65) {
            revert InvalidSignature();
        }

        if (msg.value < claimFee) {
            revert CostFeeFail();
        } else {
            (bool success, ) = feeReceiver.call{value: msg.value}("");
            if (!success) {
                revert CostFeeFail();
            }
        }
        
        bytes32 data = keccak256(abi.encodePacked(block.chainid, token, orderId, msg.sender, amount));

        if (!_check(data, signature)) {
            revert InvalidSignature();
        }

        orderClaimed[token][orderId] = true;

        IERC20(token).transfer(msg.sender, amount);

        emit UserClaimReward(token, orderId, msg.sender, amount);
    }

    function _check(bytes32 data, bytes calldata sign) internal view returns (bool) {
        bytes32 r = abi.decode(sign[:32], (bytes32));
        bytes32 s = abi.decode(sign[32:64], (bytes32));
        uint8 v = uint8(sign[64]);
        if (v < 27) {
            if (v == 0 || v == 1) v += 27;
        }
        bytes memory profix = "\x19Ethereum Signed Message:\n32";
        bytes32 info = keccak256(abi.encodePacked(profix, data));
        address addr = ECDSA.recover(info, v, r, s);
        return addr == claimSigner;
    }
}