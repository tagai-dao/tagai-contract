// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

interface IUniswapV2Pair {
    function sync() external;
    function mint(address to) external;
    function burn(address to) external returns (uint amount0, uint amount1);
    function getReserves() external view returns (uint112 _reserve0, uint112 _reserve1, uint32 _blockTimestampLast);
}