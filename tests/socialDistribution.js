const { loadFixture, mine, time } = require('@nomicfoundation/hardhat-toolbox/network-helpers');
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
    })

    async function getSignature(token, claimer, amount) {
        const orderId = 2305728529052n;
        const message = ethers.solidityPackedKeccak256(
            ['uint256', 'address', 'uint256', 'address', 'uint256'],
            [97, token, orderId, claimer, amount]
        );
        const signature = await owner.signMessage(ethers.getBytes(message));
        return {
            signature,
            orderId
        };
    }

    it('admin should create a new token', async () => {
        await expect(socialDistribution.adminAddNewToken(testERC20.target, alice.address, [
            {
                startTime: Math.floor(Date.now() / 1000) + 100,
                endTime: Math.floor(Date.now() / 1000) + 86400,
                amount: parseAmount(100)    
            },
            {
                startTime: Math.floor(Date.now() / 1000) + 86401,
                endTime: Math.floor(Date.now() / 1000) + 172800,
                amount: parseAmount(50)
            }
        ])).to.emit(socialDistribution, 'AdminAddNewToken')
            .withArgs(testERC20.target, alice.address, 'TEST');
    })

    it('admin can change token dev', async () => {
        await socialDistribution.adminAddNewToken(testERC20.target, alice.address, [
            {
                startTime: Math.floor(Date.now() / 1000) + 100,
                endTime: Math.floor(Date.now() / 1000) + 86400,
                amount: parseAmount(100)    
            },
            {
                startTime: Math.floor(Date.now() / 1000) + 86401,
                endTime: Math.floor(Date.now() / 1000) + 172800,
                amount: parseAmount(50)
            }
        ])
        await socialDistribution.adminUpdateTokenDev(testERC20.target, bob.address);
        expect(await socialDistribution.getTokenDev(testERC20.target)).to.equal(bob.address);
    })

    it('others can not create a new token', async () => {
        await expect(socialDistribution.connect(alice).adminAddNewToken(testERC20.target, alice.address, [
            {
                startTime: Math.floor(Date.now() / 1000) + 100,
                endTime: Math.floor(Date.now() / 1000) + 86400,
                amount: parseAmount(100)    
            }
        ])).to.be.revertedWithCustomError(socialDistribution, 'OwnableUnauthorizedAccount');
    })

    it('should fail if set a wrong distribution', async () => {
        await expect(socialDistribution.adminAddNewToken(testERC20.target, alice.address, [
            {
                startTime: 1,
                endTime: Math.floor(Date.now() / 1000) + 86400,
                amount: parseAmount(100)    
            }
        ])).to.be.revertedWithCustomError(socialDistribution, 'MustStartFromNow');
    })

    it('should fail if the distribution is not continuous', async () => {
        await expect(socialDistribution.adminAddNewToken(testERC20.target, alice.address, [
            {
                startTime: Math.floor(Date.now() / 1000) + 100, 
                endTime: Math.floor(Date.now() / 1000) + 86400,
                amount: parseAmount(100)    
            },
            {
                startTime: Math.floor(Date.now() / 1000) + 86402,
                endTime: Math.floor(Date.now() / 1000) + 172800,
                amount: parseAmount(50)
            }
        ])).to.be.revertedWithCustomError(socialDistribution, 'PolicyMustBeContinuous');
    })

    it('should fail if the token has been created', async () => {
        await expect(socialDistribution.adminAddNewToken(testERC202.target, alice.address, [
            {
                startTime: Math.floor(Date.now() / 1000) + 100,
                endTime: Math.floor(Date.now() / 1000) + 86400,
                amount: parseAmount(100)    
            },
            {
                startTime: Math.floor(Date.now() / 1000) + 86401,
                endTime: Math.floor(Date.now() / 1000) + 172800,
                amount: parseAmount(50)
            }
        ]))
            .to.be.revertedWithCustomError(socialDistribution, 'TokenAlreadyExists');
    })

    it('can transfer token to the social distribution contract', async () => {
        await testERC20.transfer(socialDistribution.target, parseAmount(100000000));
    })

    it('can get token distribution', async () => {
        await socialDistribution.adminAddNewToken(testERC20.target, alice.address, [
            {
                startTime: Math.floor(Date.now() / 1000) + 100,
                endTime: Math.floor(Date.now() / 1000) + 86400,
                amount: parseAmount(100)    
            },
            {
                startTime: Math.floor(Date.now() / 1000) + 86401,
                endTime: Math.floor(Date.now() / 1000) + 172800,
                amount: parseAmount(50)
            }
        ])
        const distributions = await socialDistribution.getDistribution(testERC20.target);
        expect(distributions.length).to.equal(2);
        expect(distributions[0].startTime).to.equal(Math.floor(Date.now() / 1000) + 100);
        expect(distributions[0].endTime).to.equal(Math.floor(Date.now() / 1000) + 86400);
        expect(distributions[0].amount).to.equal(parseAmount(100));
        expect(distributions[1].startTime).to.equal(Math.floor(Date.now() / 1000) + 86401);
        expect(distributions[1].endTime).to.equal(Math.floor(Date.now() / 1000) + 172800);
        expect(distributions[1].amount).to.equal(parseAmount(50));
    })

    describe('claim token distribution', () => {
        beforeEach(async () => {
            await socialDistribution.adminAddNewToken(testERC20.target, alice.address, [
                {
                    startTime: Math.floor(Date.now() / 1000) + 100,
                    endTime: Math.floor(Date.now() / 1000) + 86400,
                    amount: parseAmount(100)    
                },
                {
                    startTime: Math.floor(Date.now() / 1000) + 86401,
                    endTime: Math.floor(Date.now() / 1000) + 172800,
                    amount: parseAmount(50)
                }
            ])
        })

        it('can claim token distribution', async () => {
            await testERC20.transfer(socialDistribution.target, parseAmount(10000000));
            await time.increase(100);
            const { signature, orderId } = await getSignature(testERC20.target, alice.address, parseAmount(100));
            await expect(socialDistribution.connect(alice).userClaim(testERC20.target, orderId, parseAmount(100), signature,{
                value: parseAmount(0.01)
            }))
                .to.emit(socialDistribution, 'UserClaimReward')
                .withArgs(testERC20.target, orderId, alice.address, parseAmount(100));
            expect(await testERC20.balanceOf(alice.address)).to.equal(parseAmount(100));
        })

        it('should fail if claim with insufficient fee', async () => {
            await testERC20.transfer(socialDistribution.target, parseAmount(10000000));
            await time.increase(100);
            const { signature, orderId } = await getSignature(testERC20.target, alice.address, parseAmount(100));
            await expect(socialDistribution.connect(alice).userClaim(testERC20.target, orderId, parseAmount(100), signature))
                .to.revertedWithCustomError(socialDistribution, 'CostFeeFail');
        })

        it('cannt claim token distribution if not enough balance', async () => {
            await time.increase(100);
            const { signature, orderId } = await getSignature(testERC20.target, alice.address, parseAmount(100));
            await expect(socialDistribution.connect(alice).userClaim(testERC20.target, orderId, parseAmount(100), signature, {
                value: parseAmount(0.01)
            }))
                .to.revertedWithCustomError(testERC20, 'ERC20InsufficientBalance')
                .withArgs(socialDistribution.target, 0, parseAmount(100));
        })
    
        it('cannt claim token distribution if wrong signature', async () => {
            await testERC20.transfer(socialDistribution.target, parseAmount(10000000));
            await time.increase(100);
            const { signature, orderId } = await getSignature(testERC20.target, alice.address, parseAmount(100));
            await expect(socialDistribution.connect(alice).userClaim(testERC20.target, orderId + 1n, parseAmount(100), signature, {
                value: parseAmount(0.01)
            }))
                .to.revertedWithCustomError(socialDistribution, 'InvalidSignature');
        })
    
        it('cannt claim token distribution if order has been claimed', async () => {
            await testERC20.transfer(socialDistribution.target, parseAmount(10000000));
            await time.increase(100);
            let { signature, orderId } = await getSignature(testERC20.target, alice.address, parseAmount(100));
            await socialDistribution.connect(alice).userClaim(testERC20.target, orderId, parseAmount(100), signature, {
                value: parseAmount(0.01)
            })
            let newSig = await getSignature(testERC20.target, bob.address, parseAmount(100));
            await expect(socialDistribution.connect(bob).userClaim(testERC20.target, newSig.orderId, parseAmount(100), newSig.signature, {
                value: parseAmount(0.01)
            })).to.revertedWithCustomError(socialDistribution, 'ClaimOrderExist');
        })

        it('should fail if the claim amount exceed the total amount', async () => {
            await testERC20.transfer(socialDistribution.target, parseAmount(10000000));
            await time.increase(200);

            const firstOrderId = 831235355n;
            const message = ethers.solidityPackedKeccak256(
                ['uint256', 'address', 'uint256', 'address', 'uint256'],
                [97, testERC20.target, firstOrderId, bob.address, parseAmount(5000)]
            );
            const signature1 = await owner.signMessage(ethers.getBytes(message));
            
            await socialDistribution.connect(bob).userClaim(testERC20.target, firstOrderId, parseAmount(5000), signature1, {
                value: parseAmount(0.01)
            })

            const { signature, orderId } = await getSignature(testERC20.target, alice.address, parseAmount(6900));
            await expect(socialDistribution.connect(alice).userClaim(testERC20.target, orderId, parseAmount(6900), signature, {
                value: parseAmount(0.01)
            })).to.revertedWithCustomError(socialDistribution, 'InvalidClaimAmount');
        })
    
        it('cannt claim token distribution if token not created', async () => {
            await testERC202.transfer(socialDistribution.target, parseAmount(10000000));
            await time.increase(100);
            const { signature, orderId } = await getSignature(testERC202.target, alice.address, parseAmount(100));
            await expect(socialDistribution.connect(alice).userClaim(testERC202.target, orderId, parseAmount(100), signature,{
                value: parseAmount(0.01)
            })).to.revertedWithCustomError(socialDistribution, 'TokenNotCreated');
        })
    })
})
