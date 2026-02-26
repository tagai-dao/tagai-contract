// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

contract MockPumpForHook {
    address public feeReceiver;
    address public ipshare;
    uint256[2] private feeRatio;
    mapping(address => bool) public createdTokens;

    constructor(address _feeReceiver, address _ipshare, uint256 _tiptagFee, uint256 _deployerFee) {
        feeReceiver = _feeReceiver;
        ipshare = _ipshare;
        feeRatio = [_tiptagFee, _deployerFee];
    }

    function setCreatedToken(address token, bool created) external {
        createdTokens[token] = created;
    }

    function setFeeRatio(uint256 tiptagFee, uint256 deployerFee) external {
        feeRatio = [tiptagFee, deployerFee];
    }

    function getFeeReceiver() external view returns (address) {
        return feeReceiver;
    }

    function getIPShare() external view returns (address) {
        return ipshare;
    }

    function getFeeRatio() external view returns (uint256[2] memory) {
        return feeRatio;
    }
}
