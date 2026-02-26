// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {IVault} from "infinity-core/src/interfaces/IVault.sol";
import {CLPoolManager} from "infinity-core/src/pool-cl/CLPoolManager.sol";

contract TestCLPoolManager is CLPoolManager {
    constructor(address _vault) CLPoolManager(IVault(_vault)) {}
}
