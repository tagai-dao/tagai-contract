// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

interface IPumpCreateToken {
    function createToken(string calldata tick, bytes32 salt) external payable returns (address);
}

contract PumpCaller {
    function callCreateToken(address pump, string calldata tick, bytes32 salt) external payable returns (address) {
        return IPumpCreateToken(pump).createToken{value: msg.value}(tick, salt);
    }
}
