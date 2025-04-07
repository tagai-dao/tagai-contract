const { expect } = require("chai");
const { ethers } = require("hardhat");
const { waffle } = require("hardhat");
const { loadFixture, mine } = require('@nomicfoundation/hardhat-toolbox/network-helpers');
const { deployUniswapV2 } = require('./common')

describe("CoinPurse", function () {
    let CoinPurse;
    let coinPurse;
    let owner;
    let addr1;
    let addr2;
    let operator;
    let token;
    let WBNB;
    let router;
    let tokenOut;

    beforeEach(async () => {
        [owner, addr1, addr2, operator, dexFeeDestination] = await ethers.getSigners();

        // Deploy mock ERC20 token
        const ERC20Mock = await ethers.getContractFactory("TestERC20");
        token = await ERC20Mock.deploy();

        token.mint(addr1.address, ethers.parseUnits("1000000", "ether"));
        token.mint(addr2.address, ethers.parseUnits("1000000", "ether"));

        // Deploy mock WBNB token
        // Deploy mock UniswapV2Router02
        const { weth, uniswapV2Router02 } = await loadFixture(deployUniswapV2);

        WBNB = weth;
        router = uniswapV2Router02;

        await WBNB.connect(owner).deposit({ value: ethers.parseUnits("10", "ether") })

        // Deploy mock tokenOut contract
        const MockTokenOut = await ethers.getContractFactory("TestERC20");
        tokenOut = await MockTokenOut.deploy();

        // Deploy the CoinPurse contract
        CoinPurse = await ethers.getContractFactory("CoinPurse");
        coinPurse = await CoinPurse.deploy();

        // Set the operator address and router as defined in the constructor
        await coinPurse.connect(owner).setOperator(operator.address);
        await coinPurse.connect(owner).setWBNB(WBNB.target);
    });

    describe("Contract Status", () => {
        it("addresses", async () => {
            let ownerAddr = await coinPurse.owner();
            let operatorAddr = await coinPurse.operator();
            expect(ownerAddr).to.equal(owner.address);
            expect(operatorAddr).to.equal(operator.address);
        })
    });

    describe("setLimit", function () {
        it("should set limits correctly", async function () {
            const maxPerTx = ethers.parseUnits("100", "ether");
            const maxPerDay = ethers.parseUnits("1000", "ether");
            await coinPurse.connect(addr1).setLimit(token.target, maxPerTx, maxPerDay);
            const limit = await coinPurse.userLimits(addr1.address, token.target);
            expect(limit.maxPerTx).to.equal(maxPerTx);
            expect(limit.maxPerDay).to.equal(maxPerDay);
            expect(limit.spentToday).to.equal(0);
            expect(limit.lastUpdatedDay).to.equal(0);
        });
    });

    describe("withdraw", () => {
        it("should allow withdrawal when signature is valid", async () => {
            console.log("owner.address:", owner.address)
            const tokenBalance = await token.balanceOf(owner.address)
            console.log("tokenBalance:", tokenBalance)
            // const xId = 1;
            // const tokens = [token.target];
            // const signer = operator;
            // const chainId = 56;
            // const data = ethers.solidityPackedKeccak256(
            //     ["uint256", "uint256", "address[]", "address"],
            //     [chainId, xId, tokens, addr1.address]
            // );
            // const signature = await signer.signMessage(ethers.getBytes(data));

            // // Host some tokens for xId
            // await token.connect(owner).approve(coinPurse.target, ethers.parseUnits("100000000", "ether"));
            // await WBNB.connect(owner).approve(coinPurse.target, ethers.parseUnits("100000000", "ether"));

            // await coinPurse.connect(owner).setLimit(token.target, ethers.parseUnits("100", "ether"), ethers.parseUnits("10000", "ether"))
            // await coinPurse.connect(owner).setLimit(WBNB.target, ethers.parseUnits("100", "ether"), ethers.parseUnits("10000", "ether"))

            // const tokenBalance = await token.balanceOf(owner.address)
            // const wbnbBalance = await WBNB.balanceOf(owner.address)
            // expect(tokenBalance).to.gte(ethers.parseUnits("50", "ether"))
            // expect(wbnbBalance).to.gte(ethers.parseUnits("0.0005", "ether"))

            // await coinPurse.connect(operator).tip(owner.address, token.target, ethers.ZeroAddress, xId, ethers.parseUnits("50", "ether"));

            // const host = await coinPurse.hostingAmount(xId, token.target)

            // // Withdraw tokens
            // await coinPurse.connect(addr1).withdraw(xId, tokens, signature);

            // // Verify that the tokens have been transferred to addr1
            // const balance = await token.balanceOf(addr1.address);
            // expect(balance).to.equal(ethers.parseUnits("100", "ether"));
        });
    });

    // describe("tip", function () {
    //     it("should transfer tokens to a given address when to is not zero", async function () {
    //         const amount = ethers.parseUnits("50", "ether");
    //         await token.mint(addr1.address, amount);
    //         await token.connect(addr1).approve(coinPurse.target, amount);

    //         await coinPurse.connect(operator).tip(addr1.address, token.target, addr2.address, 0, amount);
    //         const balance = await token.balanceOf(addr2.address);
    //         expect(balance).to.equal(amount);
    //     });

    //     it("should host tokens for a given xId when to is zero and toXId is not zero", async function () {
    //         const amount = ethers.parseUnits("50", "ether");
    //         const xId = 1;
    //         await token.mint(addr1.address, amount);
    //         await token.connect(addr1).approve(coinPurse.target, amount);

    //         await coinPurse.connect(operator).tip(addr1.address, token.target, ethers.ZeroAddress, xId, amount);
    //         const hostedAmount = await coinPurse.hostingAmount(xId, token.target);
    //         expect(hostedAmount).to.equal(amount);
    //     });
    // });

    // describe("internalSwap", function () {
    //     it("should swap WBNB for another token successfully", async function () {
    //         const amountIn = ethers.parseUnits("10", "ether");
    //         const slippage = 100;
    //         await WBNB.mint(addr1.address, amountIn);
    //         await WBNB.connect(addr1).approve(coinPurse.address, amountIn);

    //         // Call internalSwap
    //         await coinPurse.connect(operator).internalSwap(addr1.address, amountIn, tokenOut.address, addr2.address, slippage);
    //     });
    // });

    // describe("externalSwap", function () {
    //     it("should execute a swap through UniswapV2 router", async function () {
    //         const amountIn = ethers.parseUnits("10", "ether");
    //         const amountOutMin = ethers.parseUnits("9", "ether");
    //         const path = [WBNB.address, token.target];
    //         const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;

    //         await WBNB.mint(addr1.address, amountIn);
    //         await WBNB.connect(addr1).approve(coinPurse.address, amountIn);

    //         // Call externalSwap
    //         await coinPurse.connect(operator).externalSwap(addr1.address, amountIn, amountOutMin, path, deadline);
    //     });
    // });
});
