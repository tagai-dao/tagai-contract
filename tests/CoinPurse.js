const { expect } = require("chai");
const { ethers } = require("hardhat");
const { waffle } = require("hardhat");
const { loadFixture, mine } = require('@nomicfoundation/hardhat-toolbox/network-helpers');
const { deployUniswapV2 } = require('./common')
const { sleep } = require('./helper');


const getOperatorWallet = (u) => {
    return new ethers.Wallet(process.env.KEY, u.provider)
}

const initContract = async () => {
    const {
        weth,
        uniswapV2Factory,
        uniswapV2Router02,
        pump,
        ipshare,
        owner, addr1, addr2, operator,
        donutFeeDestination,
        dexFeeDestination
    } = await deployUniswapV2()

    // Deploy mock ERC20 token
    const ERC20Mock = await ethers.getContractFactory("TestERC20");
    const EM1 = await ERC20Mock.deploy("ERC20Mock", "EM1");

    // Deploy mock tokenOut contract
    const MockTokenOut = await ethers.getContractFactory("TestERC20");
    const EM2 = await MockTokenOut.deploy("ERC20Mock2", "EM2");

    // Deploy the CoinPurse contract
    const CoinPurse = await ethers.getContractFactory("CoinPurse");
    const cp = await CoinPurse.deploy();
    await cp.setIpShare(ipshare)

    return {
        weth,
        uniswapV2Factory,
        uniswapV2Router02,
        pump,
        ipshare,
        owner, addr1, addr2, operator,
        donutFeeDestination,
        dexFeeDestination,
        EM1,
        EM2,
        cp
    }
}

describe("CoinPurse", function () {
    let coinPurse;
    let owner;
    let addr1;
    let addr2;
    let operator;
    let token;
    let WBNB;
    let router;
    let tokenOut;
    let pump;
    let pumpToken;

    beforeEach(async () => {
        ({
            weth: WBNB,
            uniswapV2Factory,
            uniswapV2Router02: router,
            pump,
            ipshare,
            owner, addr1, addr2, operator,
            donutFeeDestination,
            dexFeeDestination,
            EM1: token,
            EM2: tokenOut,
            cp: coinPurse
        } = await loadFixture(initContract));

        operator = getOperatorWallet(operator)

        await owner.sendTransaction({ to: operator, value: ethers.parseUnits("10", "ether") })

        await WBNB.connect(owner).deposit({ value: ethers.parseUnits("10", "ether") })
        await WBNB.connect(addr1).deposit({ value: ethers.parseUnits("10", "ether") })
        await WBNB.connect(addr2).deposit({ value: ethers.parseUnits("10", "ether") })



        // Set the operator address and router as defined in the constructor
        await coinPurse.connect(owner).setOperator(operator.address);
        await coinPurse.connect(owner).setWBNB(WBNB.target);

        // approve to CoinPurse
        await token.connect(owner).approve(coinPurse.target, ethers.parseUnits("100000000", "ether"));
        // await WBNB.connect(owner).approve(coinPurse.target, ethers.parseUnits("100000000", "ether"));

        await token.connect(addr1).approve(coinPurse.target, ethers.parseUnits("100000000", "ether"));
        await WBNB.connect(addr1).approve(coinPurse.target, ethers.parseUnits("100000000", "ether"));

        await token.connect(addr2).approve(coinPurse.target, ethers.parseUnits("100000000", "ether"));
        await WBNB.connect(addr2).approve(coinPurse.target, ethers.parseUnits("100000000", "ether"));
    });

    function randomUint256() {
        return Math.floor(Math.random() * 100000);
    }

    async function createToken(deployer, tick, createValue) {
        return new Promise(async (resolve, reject) => {
            try {
                pump.on('NewToken', (tick, token) => {
                    resolve({ token, tick })
                })
                await sleep(0.1)
                const trans = await pump.connect(deployer ?? owner).createToken(tick, {
                    value: createValue
                });
                await pump.adminChangeClaimSigner(owner)
            } catch (error) {
                reject(error)
            }
        })
    }

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
            const fee = ethers.parseUnits("0.0005", "ether");
            const xId = 1;
            const tokens = [token.target];
            const signer = operator;
            const chainId = (await ethers.provider.getNetwork()).chainId;
            const data = ethers.solidityPackedKeccak256(
                ["uint256", "uint256", "address[]", "address"],
                [chainId, xId, tokens, addr1.address]
            );
            const signature = await signer.signMessage(ethers.getBytes(data));

            await coinPurse.connect(owner).setLimit(token.target, ethers.parseUnits("100", "ether"), ethers.parseUnits("10000", "ether"))
            await coinPurse.connect(owner).setLimit(WBNB.target, ethers.parseUnits("100", "ether"), ethers.parseUnits("10000", "ether"))

            const tokenBalance = await token.balanceOf(owner.address)
            const wbnbBalance = await WBNB.balanceOf(owner.address)
            expect(tokenBalance).to.gte(ethers.parseUnits("50", "ether"))
            expect(wbnbBalance).to.gte(fee)
            // Host some tokens for xId
            await coinPurse.connect(operator).tip(randomUint256(), owner.address, token.target, ethers.ZeroAddress, xId, ethers.parseUnits("50", "ether"));

            const host = await coinPurse.hostingAmount(xId, token.target)

            // Withdraw tokens
            await coinPurse.connect(addr1).withdraw(xId, tokens, signature, { value: fee });

            // Verify that the tokens have been transferred to addr1
            const balance = await token.balanceOf(addr1.address);
            expect(balance).to.equal(ethers.parseUnits("50", "ether"));
        });
    });

    describe("tip", function () {
        it("should transfer tokens to a given address when to is not zero", async function () {
            const amount = ethers.parseUnits("50", "ether");
            await token.mint(addr1.address, amount);
            await coinPurse.connect(addr1).setLimit(token.target, ethers.parseUnits("100", "ether"), ethers.parseUnits("10000", "ether"))
            await coinPurse.connect(addr1).setLimit(WBNB.target, ethers.parseUnits("100", "ether"), ethers.parseUnits("10000", "ether"))

            await coinPurse.connect(operator).tip(randomUint256(), addr1.address, token.target, addr2.address, 0, amount);
            const balance = await token.balanceOf(addr2.address);
            expect(balance).to.equal(amount);
        });

        it("should host tokens for a given xId when to is zero and toXId is not zero", async function () {
            const amount = ethers.parseUnits("50", "ether");
            const xId = 1;
            await token.mint(addr1.address, amount);
            await token.connect(addr1).approve(coinPurse.target, amount);
            await coinPurse.connect(addr1).setLimit(token.target, ethers.parseUnits("100", "ether"), ethers.parseUnits("10000", "ether"))

            await coinPurse.connect(operator).tip(randomUint256(), addr1.address, token.target, ethers.ZeroAddress, xId, amount);
            const hostedAmount = await coinPurse.hostingAmount(xId, token.target);
            expect(hostedAmount).to.equal(amount);
        });

        it("should revert if tipId is used", async function () {
            const amount = ethers.parseUnits("50", "ether");
            const xId = 1;
            await token.mint(addr1.address, amount);
            await token.connect(addr1).approve(coinPurse.target, amount);
            await coinPurse.connect(addr1).setLimit(token.target, ethers.parseUnits("100", "ether"), ethers.parseUnits("10000", "ether"))
            const tipId = randomUint256();
            await coinPurse.connect(operator).tip(tipId, addr1.address, token.target, ethers.ZeroAddress, xId, amount);
            await expect(coinPurse.connect(operator).tip(tipId, addr1.address, token.target, ethers.ZeroAddress, xId, amount))
                .to.be.revertedWithCustomError(coinPurse, "OrderIdUsed()");
        });
    });

    describe("tryAggregate", function () {
        it("All tryAggregate calls succeeded", async () => {
            const amount = ethers.parseUnits("100", "ether")

            await token.mint(owner.address, amount)
            await token.connect(owner).approve(coinPurse.target, amount);
            await coinPurse.connect(owner).setLimit(token.target, ethers.parseUnits("100", "ether"), ethers.parseUnits("10000", "ether"))

            const tipIds = [randomUint256(), randomUint256()]
            const toUsers = [addr1.address, addr2.address]
            const calls = []
            for (let i = 0; i < tipIds.length; i++) {
                const call = coinPurse.interface.encodeFunctionData("tip", [tipIds[i], owner.address, token.target, toUsers[i], 0, amount / BigInt(tipIds.length)])
                calls.push(call)
            }
            await expect(coinPurse.connect(operator).tryAggregate(false, tipIds, calls))
                .to.changeTokenBalances(token, [addr1.address, addr2.address], 
                    [amount / BigInt(tipIds.length), amount / BigInt(tipIds.length)])
        })

        it("One of the tryAggregate will fail", async () => {
            const amount = ethers.parseUnits("100", "ether")

            await token.mint(owner.address, amount)
            await token.connect(owner).approve(coinPurse.target, amount);
            await coinPurse.connect(owner).setLimit(token.target, ethers.parseUnits("50", "ether"), ethers.parseUnits("99", "ether"))

            const tipIds = [randomUint256(), randomUint256()]
            const toUsers = [addr1.address, addr2.address]
            const calls = []
            for (let i = 0; i < tipIds.length; i++) {
                const call = coinPurse.interface.encodeFunctionData("tip", [tipIds[i], owner.address, token.target, toUsers[i], 0, amount / BigInt(tipIds.length)])
                calls.push(call)
            }

            // const result = await coinPurse.connect(operator).tryAggregate(true, tipIds, calls)
            // const receipt = await result.wait()

            // receipt.logs.forEach((v)=>{
            //     console.log(coinPurse.interface.parseLog(v))
            // })
            // coinPurse.interface.fragments.forEach((v) => {
            //     if (v.type === "error") {
            //         console.log(v.name, ethers.id(`${v.name}()`).slice(0, 10))
            //     }
            // })

            let proceds = 0
            // coinPurse.on("MultiCallResult", async (success, id, result, event) => {
            //     proceds += 1
            //     if (!success) {
            //         const err = coinPurse.interface.parseError(result)
            //         console.log(success, id, result, err?.name, event.log.transactionHash)
            //     }

            // })
            // await sleep(0.1)
            // await coinPurse.connect(operator).tryAggregate(false, tipIds, calls)

            await coinPurse.connect(operator).tryAggregate(false, tipIds, calls)

            expect(await coinPurse.orderIdUsed(tipIds[0])).to.equal(true)
            expect(await coinPurse.orderIdError(tipIds[0])).to.equal(ethers.zeroPadBytes('0x', 0))
            expect(await coinPurse.orderIdUsed(tipIds[1])).to.equal(true)
            expect(await coinPurse.orderIdError(tipIds[1])).to.equal(ethers.id("ExceedsDailyLimit()").slice(0, 10))

            const [b1, b2] = await Promise.all([
                token.balanceOf(addr1.address),
                token.balanceOf(addr2.address)
            ])
            expect(b1).to.equal(amount / BigInt(tipIds.length))
            expect(b2).to.equal(0)
        })

        it('only operator can call tryAggregate', async () => {
            await expect(coinPurse.connect(addr1).tryAggregate(false, 
                [randomUint256()], 
                [coinPurse.interface.encodeFunctionData("tip", [randomUint256(), owner.address, token.target, addr1.address, 0, ethers.parseUnits("100", "ether")])]))
                .to.be.revertedWith("Invalid operator");
        })
    })

    describe("internalSwap", function () {
        beforeEach(async function () {
            await coinPurse.connect(owner).setFeeAddress(donutFeeDestination.address)
            await pump.connect(owner).adminChangeFeeAddress(donutFeeDestination.address)
            pumpToken = await createToken(owner, 'T1', ethers.parseUnits("0.01", "ether"))
            pumpToken = await ethers.getContractAt('Token', pumpToken.token);
        });

        it("should swap WBNB for another token successfully", async function () {

            const amountIn = ethers.parseUnits("10", "ether");
            const slippage = 0;
            await WBNB.connect(addr1).deposit({ value: ethers.parseUnits("100", "ether") });
            await WBNB.connect(addr1).approve(coinPurse.target, ethers.parseUnits("100000", "ether"));
            await coinPurse.connect(addr1).setLimit(WBNB.target, ethers.parseUnits("100", "ether"), ethers.parseUnits("10000", "ether"))

            // Call internalSwap
            await expect(coinPurse.connect(operator).internalSwap(randomUint256(), addr1.address, amountIn, pumpToken.target, ethers.ZeroAddress, slippage, 2))
                .to.changeTokenBalance(WBNB, addr1, -amountIn)

            await expect(coinPurse.connect(operator).internalSwap(randomUint256(), addr1.address, amountIn, pumpToken.target, ethers.ZeroAddress, slippage, 2))
                .to.changeEtherBalance(donutFeeDestination, amountIn * 100n / 10000n + amountIn * 100n * 250n / 100000000n)

        });

        it("should revert if swapId is used", async function () {

            const amountIn = ethers.parseUnits("10", "ether");
            const slippage = 0;
            await WBNB.connect(addr1).deposit({ value: ethers.parseUnits("100", "ether") });
            await WBNB.connect(addr1).approve(coinPurse.target, ethers.parseUnits("100000", "ether"));
            await coinPurse.connect(addr1).setLimit(WBNB.target, ethers.parseUnits("100", "ether"), ethers.parseUnits("10000", "ether"))

            // Call internalSwap
            const swapId = randomUint256();
            await coinPurse.connect(operator).internalSwap(swapId, addr1.address, amountIn, pumpToken.target, ethers.ZeroAddress, slippage, 2);
            await expect(coinPurse.connect(operator).internalSwap(swapId, addr1.address, amountIn, pumpToken.target, ethers.ZeroAddress, slippage, 2))
                .to.be.revertedWithCustomError(coinPurse, "OrderIdUsed()");
        });
    });

    describe("externalSwap", function () {
        beforeEach(async function () {
            await coinPurse.connect(owner).setFeeAddress(donutFeeDestination.address)
            await pump.connect(owner).adminChangeFeeAddress(donutFeeDestination.address)
            pumpToken = await createToken(owner, 'T1', ethers.parseUnits("0.01", "ether"))
            pumpToken = await ethers.getContractAt('Token', pumpToken.token);
        });

        it("should execute a swap through UniswapV2 router", async function () {
            // Launch to external disk
            let buyAmount = ethers.parseEther("650000001")
            let bondingCurveSupply = await pumpToken.bondingCurveSupply()
            let needAmount = await pump.getBuyPriceAfterFee(bondingCurveSupply, buyAmount)
            await pumpToken.connect(owner).buyToken(0, ethers.ZeroAddress, 0, { value: needAmount })

            expect(await pumpToken.listed()).to.equal(true)


            const path = [WBNB.target, pumpToken.target];
            const amountIn = ethers.parseUnits("1", "ether");
            const [_, amountOutMin] = await router.getAmountsOut(amountIn * 9800n / 10000n, path)
            const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;

            await WBNB.connect(addr1).deposit({ value: ethers.parseUnits("10", "ether") });
            await WBNB.connect(addr1).approve(coinPurse.target, ethers.parseUnits("10", "ether"));
            await coinPurse.connect(addr1).setLimit(WBNB.target, ethers.parseUnits("100", "ether"), ethers.parseUnits("10000", "ether"))

            // Call externalSwap
            await expect(coinPurse.connect(operator).externalSwap(randomUint256(), addr1.address, amountIn, amountOutMin, path, deadline, router.target, ethers.ZeroAddress))
                .to.changeEtherBalance(donutFeeDestination, amountIn * 200n / 10000n)
        });
    });
});
