// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

contract MockIPShareForHook {
    address public lastSubject;
    uint256 public totalCaptured;
    mapping(address => bool) private _ipshareCreated;

    event ValueCaptured(address indexed subject, uint256 amount);

    function setIPShareCreated(address subject, bool created) external {
        _ipshareCreated[subject] = created;
    }

    function ipshareCreated(address subject) external view returns (bool) {
        return _ipshareCreated[subject];
    }

    function valueCapture(address subject) external payable {
        lastSubject = subject;
        totalCaptured += msg.value;
        emit ValueCaptured(subject, msg.value);
    }
}
