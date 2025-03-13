const { ethers } = require("hardhat");
const { parseAmount } = require("./helper");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { UniswapV3Deployer } = require("./vendor/UniswapV3Deployer");

async function deployPumpFactory() {
    const {
        ipshare,
        donut,
        owner,
        alice,
        bob,
        carol,
        buyer,
        donutFeeDestination,
        dexFeeDestination,
        subject
     } = await deployIPShare()

     
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
    
    const pump = await Factory.deploy(ipshare, donutFeeDestination, weth, uniswapV2Factory, uniswapV2Router02, owner);

    const TestERC20 = await ethers.getContractFactory('TestERC20');
    const testERC20 = await TestERC20.deploy();


    const WrappedUniV2ForTagAI = await ethers.getContractFactory('WrappedUniV2ForTagAI');
    // const wrappedUniV2 = await WrappedUniV2ForTagAI.deploy(
    //     uniswapV2Router02.target,
    //     weth.target,
    //     donutFeeDestination
    // )
    return {
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
        pump,
        weth,
        uniswapV2Factory,
        uniswapV2Router02,
        testERC20, 
        // wrappedUniV2
    }
}

async function deployIPShare() {
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

    const ipshareFactory = await ethers.getContractFactory('IPShare');
    const ipshare = await ipshareFactory.deploy();
    await ipshare.adminSetDonutFeeDestination(donutFeeDestination);
    return {
        // contracts
        ipshare,
        donut,
        // users
        owner,
        alice,
        bob,
        carol,
        buyer,
        // fee receivers
        donutFeeDestination,
        dexFeeDestination,
        subject
      };
}


module.exports = {
    deployPumpFactory,
    deployIPShare
}