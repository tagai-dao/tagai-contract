// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

contract MockIPShareForHook {
    address public lastSubject;
    uint256 public totalCaptured;

    event ValueCaptured(address indexed subject, uint256 amount);

    function valueCapture(address subject) external payable {
        lastSubject = subject;
        totalCaptured += msg.value;
        emit ValueCaptured(subject, msg.value);
    }
}
