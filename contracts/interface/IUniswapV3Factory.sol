// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.20;

interface IUniswapV3Factory {
    function initialize(uint160 sqrtPriceX96) external;

    function createPool(
        address tokenA,
        address tokenB,
        uint24 fee
    ) external returns (address pool);

    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);

    function feeAmountTickSpacing(uint24 fee) external view returns (int24);
}