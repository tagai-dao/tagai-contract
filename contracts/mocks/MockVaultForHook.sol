// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {Currency} from "infinity-core/src/types/Currency.sol";

contract MockVaultForHook {
    receive() external payable {}

    function take(Currency, address to, uint256 amount) external {
        (bool success, ) = to.call{value: amount}("");
        require(success, "take transfer failed");
    }
}
