// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {PoolKey} from "infinity-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "infinity-core/src/types/PoolId.sol";
import {PoolId} from "infinity-core/src/types/PoolId.sol";

interface IHookRegistrar {
    function registerPool(PoolId poolId, address token) external;
}

contract MockTokenForHook {
    using PoolIdLibrary for PoolKey;

    address public ipshareSubject;

    constructor(address _ipshareSubject) {
        ipshareSubject = _ipshareSubject;
    }

    function getIPShare() external view returns (address) {
        return ipshareSubject;
    }

    function registerByKey(address hook, PoolKey memory key) external returns (bytes32) {
        PoolId poolId = key.toId();
        IHookRegistrar(hook).registerPool(poolId, address(this));
        return PoolId.unwrap(poolId);
    }
}
