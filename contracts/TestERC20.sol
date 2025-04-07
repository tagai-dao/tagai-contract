// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestERC20 is ERC20 {
    constructor(string memory name,string memory symbol) ERC20(name, symbol) {
        _mint(msg.sender, 1000000000000000000000000);
    }

    function mint(address to,uint amount) external {
        _mint(to, amount);
    }
}
