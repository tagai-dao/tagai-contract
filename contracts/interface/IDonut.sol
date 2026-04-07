// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

interface IDonut {
    error OnlyHumanAllowed();
    error IllegalRatios();
    error GameIsNotStarted();
    error IPShareNotExist();
    error InvalidCurrency();
}