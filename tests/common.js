const { ethers } = require("hardhat");
const { parseAmount } = require("./helper");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { UniswapV3Deployer } = require("./vendor/UniswapV3Deployer");

async function deployPumpFactory() {
    const [
        owner, 
        alice, 
        bob, 
        carol, 
        donut, 
        buyer, 
        donutFeeDestination, 
        dexFeeDestination,
        subject
    ] = await ethers.getSigners();

     
       // deploy weth
    const wethFactory = await ethers.getContractFactory("WETH9");
    const weth = await wethFactory.deploy();

        // deploy dex
    const UniswapV2Factory = await ethers.getContractFactory("UniswapV2Factory");
    const uniswapV2Factory = await UniswapV2Factory.deploy(dexFeeDestination);
    await uniswapV2Factory.connect(dexFeeDestination).setFeeTo(dexFeeDestination);
    
    let initCode = await uniswapV2Factory.pairCodeHash();
    // need set this code to pairFor(function) of UniswapV2Library
    initCode = initCode.replace('0x', '');
    console.log('init code:', initCode);

    // deploy router
    let routerFactory = await ethers.getContractFactory("UniswapV2Router02");
    let uniswapV2Router02 = await routerFactory.deploy(uniswapV2Factory, weth);

    const Factory = await ethers.getContractFactory('Pump');
    
    const pump1 = await Factory.deploy();
    const pump2 = await Factory.deploy();
    const pump3 = await Factory.deploy();

    const SocialDistribution = await ethers.getContractFactory('SocialDistribution');   
    const socialDistribution = await SocialDistribution.deploy([pump1.target, pump2.target, pump3.target], owner, donutFeeDestination);

    const WrappedUniV2ForTagAI = await ethers.getContractFactory('WrappedUniV2ForTagAI');
    const wrappedUniV2 = await WrappedUniV2ForTagAI.deploy(
        socialDistribution.target,
        uniswapV2Router02.target,
        weth.target,
        donutFeeDestination
    )

    const TestERC20Factory = await ethers.getContractFactory('TestERC20');
    const testERC20 = await TestERC20Factory.deploy('TestERC20', 'TEST');
    const testERC202 = await TestERC20Factory.deploy('TestERC202', 'TEST2');

    return {
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
        uniswapV2Factory,
        uniswapV2Router02,
        socialDistribution,
        testERC20, 
        testERC202,
        wrappedUniV2
    }
}

module.exports = {
    deployPumpFactory
}