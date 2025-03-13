const { loadFixture, mine } = require('@nomicfoundation/hardhat-toolbox/network-helpers');
const { expect } = require('chai');
const { deployPumpFactory, deployIPShare } = require('./common')
const { ethers } = require('hardhat')
const { parseAmount, getEthBalance, sleep } = require('./helper');


describe("swap with wrapped uni v2", function () {
    let owner;
    let alice;
    let bob;
    let socialContract;
    let ipshare;
    let pump;
    let weth;
    let uniswapV2Factory;
    let uniswapV2Router02;

    let token;
    let pair;
    let createFee;


    async function getFeeRatio() {
        const r = await pump.getFeeRatio()
        return r
    }

    async function getCreateFee() {
        return await pump.createFee()
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
            pump,
            weth,
            uniswapV2Factory,
            uniswapV2Router02,
            wrappedUniV2
        } = await loadFixture(deployPumpFactory));
        createFee = await getCreateFee()
        token = await createToken(alice, 'T1', createFee);
        token = await ethers.getContractAt('Token', token.token);
        await token.connect(alice).buyToken(parseAmount(650000000), ethers.ZeroAddress, 0, {
            value: parseAmount(21)
        })
        pair = await token.pair();
        expect(await token.listed()).to.be.true
    })
    
    it('buy token', async () => {
        let buyValue = parseAmount(1);
        console.log('buyValue', buyValue)
        const expectBuyAmount = await uniswapV2Router02.getAmountsOut(buyValue * 9800n / 10000n, [weth, token])
        console.log('expectBuyAmount', expectBuyAmount[1])
        await expect(wrappedUniV2.connect(bob).buyToken(ethers.ZeroAddress, expectBuyAmount[1], [weth, token], alice, Date.now() + 300, ipshare.target, {
            value: buyValue
        })).to.changeEtherBalances(
            [bob, alice, donutFeeDestination, ipshare], 
            [-buyValue, 
            buyValue * 100n * 450n / 100000000n, 
            buyValue * 100n / 10000n + buyValue * 100n * 250n / 100000000n,
            buyValue * 100n / 10000n * 9300n / 10000n
        ])
    })

    it('buy token fail with slippage', async () => {
        let buyValue = parseAmount(1);
        console.log('buyValue', buyValue)
        const expectBuyAmount = await uniswapV2Router02.getAmountsOut(buyValue * 9801n / 10000n, [weth, token])
        console.log('expectBuyAmount', expectBuyAmount[1])
        await expect(wrappedUniV2.buyToken(ethers.ZeroAddress, expectBuyAmount[1], [weth, token], alice, Date.now() + 300, ipshare.target, {
            value: buyValue
        })).to.be.revertedWith('UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT')
    })

    it('sell token', async () => {
        await token.connect(alice).transfer(bob, parseAmount(100000000));
        await token.connect(bob).approve(wrappedUniV2.target, parseAmount(100000000));

        let sellAmount = parseAmount(50000000);
        console.log('sellAmount', sellAmount)
        const expectSellValue = await uniswapV2Router02.getAmountsOut(sellAmount, [token, weth])
        console.log('expectSellValue', expectSellValue[1])

        await expect(wrappedUniV2.connect(bob).sellToken(sellAmount, expectSellValue[1] * 9700n / 10000n, [token, weth], bob, Date.now() + 300, ethers.ZeroAddress, ipshare.target))
        .to.changeEtherBalances([
            bob,
            donutFeeDestination,
            alice,
            ipshare
        ], [
            expectSellValue[1] * 9800n / 10000n + 1n,
            expectSellValue[1] * 100n / 10000n + expectSellValue[1] * 100n * 250n / 100000000n,
            expectSellValue[1] * 100n / 10000n * 450n / 10000n,
            expectSellValue[1] * 100n * 9300n / 100000000n + 1n
        ])
    })
    
    it('sell token fail with slippage', async () => {
        await token.connect(alice).transfer(bob, parseAmount(100000000));
        await token.connect(bob).approve(wrappedUniV2.target, parseAmount(100000000));

        let sellAmount = parseAmount(50000000);
        console.log('sellAmount', sellAmount)
        const expectSellValue = await uniswapV2Router02.getAmountsOut(sellAmount, [token, weth])
        console.log('expectSellValue', expectSellValue[1])

        await expect(wrappedUniV2.connect(bob).sellToken(sellAmount, expectSellValue[1] + 1n, [token, weth], bob, Date.now() + 300, ethers.ZeroAddress, ipshare.target))
        .to.be.revertedWith('UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT')
    })

})