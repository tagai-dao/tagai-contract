const { loadFixture, mine } = require('@nomicfoundation/hardhat-toolbox/network-helpers');
const { expect } = require('chai');
const { deployPumpFactory, deployIPShare } = require('./common')
const { ethers } = require('hardhat')
const { parseAmount, getEthBalance, sleep } = require('./helper');
const { bigint } = require('hardhat/internal/core/params/argumentTypes');
const { IUniswapV2Pair } = require("@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json");


describe("Pump", function () {
    let owner;
    let alice;
    let bob;
    let socialContract;
    let ipshare;
    let pump1;
    let pump2;
    let pump3;
    let weth;
    let uniswapV2Factory;
    let uniswapV2Router02;
    let socialDistribution;
    let testERC20;
    let testERC202;
    let artifacts
    beforeEach(async () => {
        ({ 
            ipshare,
            donut,
            owner,
            alice,
            bob,
            carol,
            buyer,
            donutFeeDestination,
            dexFeeDestination,
            subject,
            pump1,
            pump2,
            pump3,
            weth,
            socialDistribution,
            uniswapV2Factory,
            uniswapV2Router02,
            testERC20,
            testERC202,
            artifacts
        } = await loadFixture(deployPumpFactory));
        // create some tokens
        await pump1.adminCreateTick('TEST1');
        await pump1.adminCreateTick('TEST2');
        await pump2.adminCreateTick('TEST2');
        await pump3.adminCreateTick('TEST3');

        // create default distributions
        await socialContract.adminSetDefaultDistribution([
            {
                startTime: 0,
                endTime: 86400,
                amount: parseAmount(100)
            },{
                startTime: 86401,
                endTime: 172800,
                amount: parseAmount(50)
            },{
                startTime: 172801,
                endTime: 259200,
                amount: parseAmount(25)
            }
        ])
    })

    it('should update new distribution', async () => {
        await expect(socialContract.adminSetDefaultDistribution([
            {
                startTime: 0,
                endTime: 864000,
                amount: parseAmount(1000)
            },
            {
                startTime: 864001,
                endTime: 1728000,
                amount: parseAmount(500)
            }
        ]))
        .to.emit(socialContract, 'AdminSetDefaultDistribution')

        await expect(socialContract.adminSetDefaultDistribution([
            {
                startTime: 0,
                endTime: 86400,
                amount: parseAmount(1000)
            },
            {
                startTime: 86401,
                endTime: 172800,
                amount: parseAmount(500)
            },
            {
                startTime: 172801,
                endTime: 259200,
                amount: parseAmount(250)
            },
            {
                startTime: 259201,
                endTime: 3456000000,
                amount: parseAmount(125)
            }
        ]))
        .to.emit(socialContract, 'AdminSetDefaultDistribution')
    })

    it('should fail if set a wrong default distribution', async () => {
        await expect(socialContract.adminSetDefaultDistribution([
            {
                startTime: 1,
                endTime: 86400,
                amount: parseAmount(100)    
            },{
                startTime: 86401,
                endTime: 172800,
                amount: parseAmount(50)
            }
        ])).to.be.revertedWith('InvalidPolicy');
    })

    it('should create a new token', async () => {
        
    })

    it('should fail if the token has been created', async () => {
        await expect(socialContract.adminAddNewToken(testERC202.target, alice.address))
            .to.be.revertedWith('TokenAlreadyExists');
    })

    it('can transfer token to the social distribution contract', async () => {
        await testERC20.transfer(socialContract.target, parseAmount(100000000));
    })

    it('can get token distribution', async () => {

    })

    it('can claim token distribution', async () => {

    })

    it('cannt claim token distribution if not enough balance', async () => {

    })

    it('cannt claim token distribution if wrong signature', async () => {

    })

    it('cannt claim token distribution if order has been claimed', async () => {

    })

    it('cannt claim token distribution if token not created', async () => {

    })
})
