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
    let pump;
    let weth;
    let uniswapV2Factory;
    let uniswapV2Router02
    let testERC20
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
            pump,
            weth,
            uniswapV2Factory,
            uniswapV2Router02,
            testERC20,
            artifacts
        } = await loadFixture(deployPumpFactory));
    })

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

    async function getClaimSignature(tokenAddress, orderId, amount, user) {
        // const message = ethers.solidityPacked(['uint256', 'address', 'uint256', 'address', 'uint256'],
        //     [97, tokenAddress, orderId, user, amount]
        // );
        // return await owner.signMessage(message)
        const dataHash = ethers.solidityPackedKeccak256(['uint256', 'address', 'uint256', 'address', 'uint256'],
            [97, tokenAddress, orderId, user, amount]
        )

        const signature = await owner.signMessage(ethers.getBytes(dataHash))

        return signature
    }

    describe("Ownerable", function () {
        it("Can change claim signer", async () => {
            await pump.adminChangeClaimSigner(alice.address)
            expect(await pump.getClaimSigner()).eq(alice.address)
        })

        it("Can transfer ownership", async () => {
            await pump.transferOwnership(bob.address)
            expect(await pump.owner()).eq(owner.address)
            expect(await pump.pendingOwner()).eq(bob.address)
            await pump.connect(bob).acceptOwnership()
            expect(await pump.owner()).eq(bob.address)
        })
    })

    describe("Create token", function () {
        let createValue;
        beforeEach(async () => {
            createValue = await getCreateFee();
        })

        it("Can not create same tick", async function () {
            await createToken(alice, 'T1', createValue); 
            await expect(pump.connect(alice).createToken('T1'))
                .to.revertedWithCustomError(pump, 'TickHasBeenCreated');
        })
    })

    describe("Before list", function () {
        let token;
        let pair;
        let createFee;
        beforeEach(async () => {
            createFee = await getCreateFee()
            token = await createToken(alice, 'T1', createFee);
            token = await ethers.getContractAt('Token', token.token);
            pair = await token.pair();
        })

        async function getBuyFeeData(buyEthAmount) {
            const feeRatio = await getFeeRatio()
            const tipTapFee = buyEthAmount * feeRatio[0] / 10000n;
            const ipshareFee = buyEthAmount * feeRatio[1] / 10000n;
            const buyFund = buyEthAmount - tipTapFee - ipshareFee;
            return {
                tipTapFee,
                ipshareFee,
                buyFund,
                feeRatio
            }
        }

        async function getSellFeeData(sellAmount) {
            const feeRatio = await getFeeRatio()
            let sellFund = await token.getSellPrice(sellAmount)
            const tipTapFee = sellFund * feeRatio[0] / 10000n;
            const ipshareFee = sellFund * feeRatio[1] / 10000n; 
            const receiveEth = sellFund - tipTapFee - ipshareFee;
            return {
                feeRatio,
                sellFund,
                tipTapFee,
                ipshareFee,
                receiveEth
            }
        }

        async function getBondingCurveSupply() {
            return await token.bondingCurveSupply()
        }

        it("Distribute social reward to pump", async () => {
            expect(await token.balanceOf(pump.target)).eq(parseAmount(150000000))
            expect(await token.balanceOf(token.target)).eq(parseAmount(850000000))
        })

        it("Can buy token when create token", async () => {
            const buyFund = parseAmount(0.1)
            const feeInfo = await getBuyFeeData(buyFund)
            
            const buyAmount = await pump.getBuyAmountByValue(0, feeInfo.buyFund);

            let testToken = await createToken(owner, 'T2', createFee + buyFund)
            testToken = await ethers.getContractAt('Token', testToken.token)
            expect(await testToken.balanceOf(owner)).eq(buyAmount);
        })

        it("Can buy token with bonding curve", async () => {
            const buyFund = parseAmount(0.2)

            const feeInfo = await getBuyFeeData(buyFund)
            const buyAmount = await pump.getBuyAmountByValue(0, feeInfo.buyFund);

            await expect(token.connect(alice).buyToken(buyAmount, ethers.ZeroAddress, 0, {
                value: buyFund
            })).to.changeTokenBalance(token, alice, buyAmount)
        })

        it("Can buy token by send ETH to token contract", async () => {
            const buyFund = parseAmount(0.2)
            const feeInfo = await getBuyFeeData(buyFund)
            const buyAmount = await pump.getBuyAmountByValue(0, feeInfo.buyFund);

            await expect(bob.sendTransaction({
                to: token.target,
                value: buyFund
            })).to.changeTokenBalance(token, bob, buyAmount)
        })

        it("Can sell token with bonding curve", async () => {
            await token.connect(alice).buyToken(parseAmount(100000000), ethers.ZeroAddress, 0, {
                value: parseAmount(0.1)
            });

            await expect(token.connect(alice).sellToken(parseAmount(10000000), 0, ethers.ZeroAddress, 0))
                .to.changeTokenBalance(token, alice, -parseAmount(10000000))
        })

        it("Can trade with otherone", async () => {
            const buyFund = parseAmount(0.2)

            const feeInfo = await getBuyFeeData(buyFund)
            const buyAmount = await pump.getBuyAmountByValue(0, feeInfo.buyFund);
            await token.connect(alice).buyToken(buyAmount, ethers.ZeroAddress, 0, {
                value: buyFund
            })

            const transferAmount = parseAmount(100000)

            await expect(token.connect(alice).transfer(bob, transferAmount))
                .to.changeTokenBalances(token, [alice, bob], [-transferAmount, transferAmount])
            
            const tranferAmount2 = parseAmount(5000)

            await expect(token.connect(bob).transfer(carol, tranferAmount2))
                .to.changeTokenBalances(token, [bob, carol], [-tranferAmount2, tranferAmount2])
        })

        it("The bonding curve price calculate need to be correct", async () => {
            const buyFund = parseAmount(0.2)
            await token.connect(alice).buyToken(parseAmount(100000000), ethers.ZeroAddress, 0, {
                value: buyFund
            })
            let supply = await getBondingCurveSupply()

            const price = await pump.getBuyPriceAfterFee(supply, parseAmount(100000000))
            expect(price).eq(911848133866902953n)

            await token.connect(alice).buyToken(parseAmount(100000000), ethers.ZeroAddress, 0, {
                value: 911848133866902953n
            })
            supply = await getBondingCurveSupply()

            const sellPrice = await pump.getSellPriceAfterFee(supply, parseAmount(100000000))
            expect(sellPrice).eq(875738947765773594n)
            expect(price * 9800n / 10000n * 9800n / 10000n).eq(sellPrice + 1n)
        })

        it("The sellsman cant purchase token if he did not created ipshare", async () => {
            const buyFund = parseAmount(0.2)

            const feeInfo = await getBuyFeeData(buyFund)
            const buyAmount = await pump.getBuyAmountByValue(0, feeInfo.buyFund);
            await expect(token.connect(alice).buyToken(buyAmount, bob, 0, {
                value: buyFund
            })).to.be.revertedWithCustomError(token, 'IPShareNotCreated')
        })

        it("Sellsman who created ipshare can purchase token", async () => {
            await ipshare.connect(bob).createShare(ethers.ZeroAddress)

            const buyFund = parseAmount(0.2)

            const feeInfo = await getBuyFeeData(buyFund)
            const buyAmount = await pump.getBuyAmountByValue(0, feeInfo.buyFund);
            await expect(token.connect(alice).buyToken(buyAmount, bob, 0, {
                value: buyFund
            })).to.changeTokenBalance(token, alice, buyAmount)
        })

        it("Cannt claim social reward", async () => {
            await mine(1000);
            const claimAmount = parseAmount(100);
            const orderId = 23059723523125626n;
            const signature = await getClaimSignature(token.target, orderId, claimAmount, alice.address)

            await expect(pump.connect(alice).userClaim(token, orderId, claimAmount, signature, {
                value: parseAmount(0.01)
            }))
                .to.revertedWithCustomError(token, 'TokenNotListed')
        })

        it("Cannt transfer banlance of v2 pool and position manager", async () => {
            const buyFund = parseAmount(0.2)

            const feeInfo = await getBuyFeeData(buyFund)
            const buyAmount = await pump.getBuyAmountByValue(0, feeInfo.buyFund);
            await token.connect(alice).buyToken(buyAmount, ethers.ZeroAddress, 0, {
                value: buyFund
            })

            const transferAmount = parseAmount(10000)
            await expect(token.connect(alice).transfer(pair, transferAmount))
                .to.be.revertedWithCustomError(token, 'TokenNotListed')
        })

        it('Cannt make lp before list', async () => {
            await token.buyToken(parseAmount(100000000), ethers.ZeroAddress, 0, {
                value: parseAmount(1)
            })
            // router.addLiquidityETH{
            //     value: address(this).balance
            // }(address(this), liquidityAmount, 0, 0, BlackHole, block.timestamp + 300);
            const router = await ethers.getContractAt('UniswapV2Router02', uniswapV2Router02);
            await token.approve(router, parseAmount(10000000000))
            await token.transfer(router, parseAmount(1000));
            await expect(router.addLiquidityETH(token, parseAmount(100000), 0, 0, '0x000000000000000000000000000000000000dEaD', Math.floor(Date.now() / 1000) +300,
                {
                    value: parseAmount(10)
                })).to.revertedWith('TransferHelper: TRANSFER_FROM_FAILED')
        })
    })

    describe("Token listed", function () {
        let token;
        let pair;
        let createFee;
        beforeEach(async () => {
            createFee = await getCreateFee()
            token = await createToken(alice, 'T1', createFee);
            token = await ethers.getContractAt('Token', token.token);
            pair = await token.pair();
        })

        async function getBuyFeeData(buyEthAmount) {
            const feeRatio = await getFeeRatio()
            const tipTapFee = buyEthAmount * feeRatio[0] / 10000n;
            const ipshareFee = buyEthAmount * feeRatio[1] / 10000n;
            const buyFund = buyEthAmount - tipTapFee - ipshareFee;
            return {
                tipTapFee,
                ipshareFee,
                buyFund,
                feeRatio
            }
        }

        async function getSellFeeData(sellAmount) {
            const feeRatio = await getFeeRatio()
            let sellFund = await token.getSellPrice(sellAmount)
            const tipTapFee = sellFund * feeRatio[0] / 10000n;
            const ipshareFee = sellFund * feeRatio[1] / 10000n; 
            const receiveEth = sellFund - tipTapFee - ipshareFee;
            return {
                feeRatio,
                sellFund,
                tipTapFee,
                ipshareFee,
                receiveEth
            }
        }

        async function getBondingCurveSupply() {
            return await token.bondingCurveSupply()
        }

        it("Will refund ETH when use buy the tail token", async () => {
            const bondingTotalAmount = parseAmount(650000000);
            const bondingCurveSupply = await getBondingCurveSupply()
            const gb = await pump.getPrice(bondingCurveSupply, bondingTotalAmount - bondingCurveSupply);
            await token.connect(alice).buyToken(parseAmount(100000000), ethers.ZeroAddress, 0, {
                value: parseAmount(1)
            })
            const bondingCurveSupply2 = await getBondingCurveSupply()
            const gb2 = await pump.getBuyPriceAfterFee(bondingCurveSupply2, bondingTotalAmount - bondingCurveSupply2);
            const buyFund = parseAmount(21)
            
            await expect(token.connect(bob).buyToken(bondingTotalAmount, ethers.ZeroAddress, 0, {
                value: buyFund
            })).to.changeEtherBalances([bob, donutFeeDestination], [-gb2, 1198933677024662579n]);
        })

        it("The last buyer will make the liquidity pool too", async () => {
            let buyAmount = parseAmount(600001000)

            let bondingCurveSupply = await getBondingCurveSupply()
            let needEth = await pump.getBuyPriceAfterFee(bondingCurveSupply, buyAmount)
            await token.connect(bob).buyToken(buyAmount, ethers.ZeroAddress, 0, {
                value: needEth 
            })

            const balanceOfBob = await token.balanceOf(bob)
            // console.log('balance of bob', balanceOfBob)

            buyAmount = parseAmount(200000000)
             bondingCurveSupply = await getBondingCurveSupply()
            needEth = await pump.getBuyPriceAfterFee(bondingCurveSupply, buyAmount)
            await expect(token.connect(alice).buyToken(buyAmount, ethers.ZeroAddress, 500, {
                value: needEth
            })).to.revertedWithCustomError(token, 'OutOfSlippage')

            await expect(token.connect(alice).buyToken(parseAmount(50000000), ethers.ZeroAddress, 500, {
                value: needEth
            })).to.changeTokenBalance(token, alice, parseAmount(650000000) - balanceOfBob)
        })

        it("Can make lp if someone transfer weth to pair", async () => {
            await token.connect(alice).buyToken(parseAmount(100000000), ethers.ZeroAddress, 0, {
                value: parseAmount(1)
            })
            await weth.deposit({ value: parseAmount(30) })
            await weth.transfer(pair, parseAmount(23))
            const pairContract = await ethers.getContractAt([{
                "inputs": [
                  {
                    "internalType": "address",
                    "name": "owner",
                    "type": "address"
                  }
                ],
                "name": "balanceOf",
                "outputs": [
                  {
                    "internalType": "uint256",
                    "name": "result",
                    "type": "uint256"
                  }
                ],
                "stateMutability": "view",
                "type": "function"
              },
                {
                    "inputs": [],
                    "name": "totalSupply",
                    "outputs": [
                      {
                        "internalType": "uint256",
                        "name": "result",
                        "type": "uint256"
                      }
                    ],
                    "stateMutability": "view",
                    "type": "function"
                  },
                {
                  "inputs": [],
                  "name": "getReserves",
                  "outputs": [
                    {
                      "internalType": "uint112",
                      "name": "_reserve0",
                      "type": "uint112"
                    },
                    {
                      "internalType": "uint112",
                      "name": "_reserve1",
                      "type": "uint112"
                    },
                    {
                      "internalType": "uint32",
                      "name": "_blockTimestampLast",
                      "type": "uint32"
                    }
                  ],
                  "stateMutability": "view",
                  "type": "function"
                },
                {
                  "inputs": [
                    {
                      "internalType": "address",
                      "name": "to",
                      "type": "address"
                    }
                  ],
                  "name": "mint",
                  "outputs": [],
                  "stateMutability": "nonpayable",
                  "type": "function"
                },
                {
                  "inputs": [],
                  "name": "sync",
                  "outputs": [],
                  "stateMutability": "nonpayable",
                  "type": "function"
                },
                {
                    "inputs": [
                      {
                        "internalType": "address",
                        "name": "to",
                        "type": "address"
                      }
                    ],
                    "name": "burn",
                    "outputs": [
                      {
                        "internalType": "uint256",
                        "name": "amount0",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "amount1",
                        "type": "uint256"
                      }
                    ],
                    "stateMutability": "nonpayable",
                    "type": "function"
                  },
                  {
                    "inputs": [
                      {
                        "internalType": "address",
                        "name": "to",
                        "type": "address"
                      },
                      {
                        "internalType": "uint256",
                        "name": "amount",
                        "type": "uint256"
                      }
                    ],
                    "name": "transfer",
                    "outputs": [
                      {
                        "internalType": "bool",
                        "name": "",
                        "type": "bool"
                      }
                    ],
                    "stateMutability": "nonpayable",
                    "type": "function"
                  }
              ], pair)
            console.log({pairContract})
            await pairContract.sync()

            await token.connect(alice).buyToken(parseAmount(600000000), ethers.ZeroAddress, 0, {
                value: parseAmount(20)
            })

            expect(await token.listed()).eq(true)

            const balances = await Promise.all([
                weth.balanceOf(pair),
                token.balanceOf(pair),
                getEthBalance(token),
                token.balanceOf(token),
                pairContract.getReserves(),
                pairContract.totalSupply()
            ])
            
            await token.connect(alice).approve(uniswapV2Router02, parseAmount(1000000000000))

            await uniswapV2Router02.connect(alice).addLiquidityETH(token, parseAmount(200000000), 0, 0, alice.address, Math.floor(Date.now() / 1000) + 300, {
                value: parseAmount(42)
            })
            const lpBalance = await pairContract.balanceOf(alice);
            console.log('reserves', balances)
            console.log('lpBalance', lpBalance)

            let [tb1, bb1] = await Promise.all([
                token.balanceOf(alice),
                weth.balanceOf(alice)
            ])

            await pairContract.connect(alice).transfer(pair, lpBalance)
            await pairContract.connect(alice).burn(alice);

            let [tb2, bb2] = await Promise.all([
                token.balanceOf(alice),
                weth.balanceOf(alice)
            ])
            console.log(tb1.toString() / 1e18, tb2.toString() / 1e18, bb1.toString() / 1e18, bb2.toString() / 1e18)

        })

        it('will emit list event with the last buy', async () => {
            let buyAmount = parseAmount(600000000)
            let bondingCurveSupply = await getBondingCurveSupply()
            let needEth = await pump.getBuyPriceAfterFee(bondingCurveSupply, buyAmount)
            await token.connect(bob).buyToken(buyAmount, ethers.ZeroAddress, 0, {
                value: needEth
            })

            const balanceOfBob = await token.balanceOf(bob)
            // console.log('balance of bob', balanceOfBob)

            buyAmount = parseAmount(50001000)
            bondingCurveSupply = await getBondingCurveSupply()
            needEth = await pump.getBuyPriceAfterFee(bondingCurveSupply, buyAmount)
            await expect(token.connect(alice).buyToken(buyAmount, ethers.ZeroAddress, 500, {
                value: needEth
            })).to.emit(token, 'TokenListedToDex').withArgs(pair)
        })

        it('List will cost most of the token in contract', async () => {
            let buyAmount = parseAmount(600000000)
            let bondingCurveSupply = await getBondingCurveSupply()
            let needEth = await pump.getBuyPriceAfterFee(bondingCurveSupply, buyAmount)
            await token.connect(bob).buyToken(buyAmount, ethers.ZeroAddress, 0, {
                value: needEth
            })

            const balanceOfBob = await token.balanceOf(bob)
            // console.log('balance of bob', balanceOfBob)

            buyAmount = parseAmount(50010000)
            bondingCurveSupply = await getBondingCurveSupply()
            needEth = await pump.getBuyPriceAfterFee(bondingCurveSupply, buyAmount)
            await expect(token.connect(alice).buyToken(buyAmount, ethers.ZeroAddress, 500, {
                value: needEth
            })).to.emit(token, 'TokenListedToDex').withArgs(pair)
            const balanceOfToken = await token.balanceOf(token);
            console.log('balance of token', balanceOfToken)
            expect(balanceOfToken).eq(0)
        })

        it('Will receive 1 bnb for list fee', async () => {
            let buyAmount = parseAmount(600000000)
            let bondingCurveSupply = await getBondingCurveSupply()
            let needEth = await pump.getBuyPriceAfterFee(bondingCurveSupply, buyAmount)
            await token.connect(bob).buyToken(buyAmount, ethers.ZeroAddress, 0, {
                value: needEth
            })

            const balanceOfBob = await token.balanceOf(bob)
            // console.log('balance of bob', balanceOfBob)

            buyAmount = parseAmount(50010000)
            bondingCurveSupply = await getBondingCurveSupply()
            needEth = await pump.getBuyPriceAfterFee(bondingCurveSupply, buyAmount)
            await expect(token.connect(alice).buyToken(buyAmount, ethers.ZeroAddress, 500, {
                value: needEth
            })).to.changeEtherBalance(donutFeeDestination, 1040762559720426312n)
        })

        it('Can buy token to dex when create token', async () => {
            let buyAmount = parseAmount(650000010)
            let bondingCurveSupply = await getBondingCurveSupply()
            let needEth = await pump.getBuyPriceAfterFee(bondingCurveSupply, buyAmount)
            await expect(token.connect(bob).buyToken(buyAmount, ethers.ZeroAddress, 0, {
                value: needEth
            })).to.changeEtherBalance(donutFeeDestination, 1209183677024662579n)
            
            expect(await token.listed()).eq(true)
        })
    })
    
    describe('After token list', function () {
        let token;
        let feeRatio;
        beforeEach(async () => {
            token = await pump.createToken('T1', { value: parseAmount(0.1) })
            token = await ethers.getContractAt('Token', '0x61c36a8d610163660e21a8b7359e1cac0c9133e1')
            // await token.setUniForTest(weth, uniswapV2Factory, uniswapV2Router02);
            feeRatio = await getFeeRatio();
            await mine(86400);
            let buyAmount = parseAmount(660000000)
            const supply = await getBondingCurveSupply()
            let needEth = await pump.getBuyPriceAfterFee(supply, buyAmount)
            await token.connect(bob).buyToken(buyAmount, ethers.ZeroAddress, 0, {
                value: needEth
            })
        })

        async function getBondingCurveSupply() {
            return await token.bondingCurveSupply()
        }

        it("Can trade token to everyone", async () => {
            await expect(token.connect(bob).transfer(alice, parseAmount(1000000)))
                .to.changeTokenBalances(token, [
                    alice, bob
                ], [
                    parseAmount(1000000), -parseAmount(1000000)
                ])

            await expect(token.connect(alice).transfer(carol, parseAmount(100000)))
                .to.changeTokenBalances(token, [
                    alice, carol
                ], [
                    -parseAmount(100000), parseAmount(100000)
                ])
        })

        it("Can transfer eth to token contract", async () => {
            await expect(alice.sendTransaction({
                to: token.target,
                value: parseAmount(1)
            })).to.changeEtherBalances(
                [token, alice],
                [parseAmount(1), -parseAmount(1)]
            )
        })

        it("Can claim curation token", async () => {
            const pendingClaimSocialRewards = await pump.pendingClaimSocialRewards(token);
            const totalClaimedSocialRewards = await pump.totalClaimedSocialRewards(token);
            console.log(1, pendingClaimSocialRewards, totalClaimedSocialRewards)

            const blockNumber = await ethers.provider.getBlockNumber();
            const block = await ethers.provider.getBlock(blockNumber);
            const timestamp = block.timestamp;
            
            let claimAmount = parseAmount(10000);
            let orderId = 23059723523125626n;
            let signature = await getClaimSignature(token.target, orderId, claimAmount, alice.address)
            await expect(pump.connect(alice).userClaim(token, orderId, claimAmount, signature, {
                value: parseAmount(0.001)
            }))
                .to.emit(pump, 'UserClaimReward')
                .withArgs(ethers.getAddress(token.target), orderId, alice.address, claimAmount);

            orderId = 23852135483n;
            signature = await getClaimSignature(token.target, orderId, claimAmount, bob.address)
            await expect(pump.connect(bob).userClaim(token, orderId, claimAmount, signature, {
                value: parseAmount(0.001)
            })).to.changeTokenBalances(token, [bob, pump], [claimAmount, -claimAmount])
        })

        it('Will revert if the signature is valid', async () => {
            const claimAmount = parseAmount(10000);
            const orderId = 23059723523125626n;
            const signature = await getClaimSignature(token.target, orderId, claimAmount, alice.address)
            await expect(pump.connect(alice).userClaim(token, orderId, claimAmount, signature.replace('3', '5'), {
                value: parseAmount(0.222)
            })).to.revertedWithCustomError(pump, 'ECDSAInvalidSignature()')
        })

        it('will revert if insufficient claim fee', async () => {
            const claimAmount = parseAmount(10000);
            const orderId = 23059723523125626n;
            const signature = await getClaimSignature(token.target, orderId, claimAmount, alice.address)
            await expect(pump.connect(alice).userClaim(token, orderId, claimAmount, signature, {
                value: 100000000n
            })).to.revertedWithCustomError(token, 'CostFeeFail')
        })

        it('will not refund the left fee back to user', async () => {
            const claimAmount = parseAmount(10000);
            const orderId = 23059723523125626n;
            const signature = await getClaimSignature(token.target, orderId, claimAmount, alice.address)
            await expect(pump.connect(alice).userClaim(token, orderId, claimAmount, signature, {
                value: parseAmount(0.1)
            })).to.changeEtherBalance(alice, parseAmount(-0.1))
        })

        it('will revert if the claim amount is greater than social pool', async () => {
            const claimAmount = parseAmount(1000000000);
            const orderId = 23059723523125626n;
            const signature = await getClaimSignature(token.target, orderId, claimAmount, alice.address)
            await expect(pump.connect(alice).userClaim(token, orderId, claimAmount, signature, {
                value: parseAmount(0.002)
            }))
                .to.revertedWithCustomError(pump, 'InvalidClaimAmount')
        })

        it('will revert if the order has been claimed', async () => {
            let claimAmount = parseAmount(10000);
            let orderId = 23059723523125626n;
            let signature = await getClaimSignature(token.target, orderId, claimAmount, alice.address)
            await expect(pump.connect(alice).userClaim(token, orderId, claimAmount, signature, {
                value: parseAmount(0.001)
            }))
                .to.emit(pump, 'UserClaimReward')
                .withArgs(ethers.getAddress(token.target), orderId, alice.address, claimAmount);

            await expect(pump.connect(alice).userClaim(token, orderId, claimAmount, signature, {
                value: parseAmount(0.001)
            }))
                .to.revertedWithCustomError(token, 'ClaimOrderExist')

            claimAmount = parseAmount(1000);
            signature = await getClaimSignature(token.target, orderId, claimAmount, alice.address)
            await expect(pump.connect(alice).userClaim(token, orderId, claimAmount, signature, {
                value: parseAmount(0.001)
            }))
                .to.revertedWithCustomError(pump, 'ClaimOrderExist')
        })

        it('will revet if user use the token a signature to claim token b reward', async () => {
            let claimAmount = parseAmount(10000);
            let orderId = 23059723523125626n;
            let signature = await getClaimSignature(token.target, orderId, claimAmount, alice.address)
            await expect(pump.connect(bob).userClaim(token, orderId, claimAmount, signature, {
                value: parseAmount(0.001)
            }))
                .to.revertedWithCustomError(pump, 'InvalidSignature')
        })

        it('Cannt trade with bonding curve', async () => {
            await expect(token.connect(alice).buyToken(parseAmount(1000), ethers.ZeroAddress, 0, {
                value: parseAmount(0.01)
            })).to.revertedWithCustomError(token, 'TokenListed')

            await expect(token.connect(bob).sellToken(parseAmount(100), 0, ethers.ZeroAddress, 0))
                .to.revertedWithCustomError(token, 'TokenListed')
        })

        it("Can swap token with uniswap", async () => {
            const blockNumber = await ethers.provider.getBlockNumber();
            const block = await ethers.provider.getBlock(blockNumber);
            const now = block.timestamp + 10;
            await token.connect(bob).approve(uniswapV2Router02, parseAmount(100000000));
            await expect(uniswapV2Router02.connect(bob).swapExactTokensForETH(
                parseAmount(100000),
                0,
                [token, weth],
                alice,
                now
            )).to.changeTokenBalance(token, bob, -parseAmount(100000));
        })

        it("Can provide liquidity outside of the pool", async () => {})
    })
})