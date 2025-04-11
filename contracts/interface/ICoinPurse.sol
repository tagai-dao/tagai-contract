// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

interface ICoinPurse {
    event Tip(address indexed from, address indexed to, address indexed token, uint toXId, uint amount);

    event LimitSet(address indexed user, address indexed token, uint256 maxPerTx, uint256 maxPerDay);

    event Withdraw(uint indexed xId, address indexed user, address[] tokens, uint[] amounts);

    event MultiCallResult(bool success, uint256 indexed index, bytes result);
}