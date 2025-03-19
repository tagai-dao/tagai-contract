// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";

contract Pump is Ownable {

    mapping(string => bool) public createdTicks;
    
    constructor() Ownable(msg.sender) {
    }

    function adminCreateTick(string memory symbol) external onlyOwner {
        createdTicks[symbol] = true;
    }

}