const { deployIPShare } = require('./common')
const { getEthBalacne, parseAmount } = require('./helper')
const { ZeroAddress } = require('ethers')
const { ethers } = require('hardhat')
const { expect } = require('chai')
const { time, loadFixture } = require('@nomicfoundation/hardhat-toolbox/network-helpers')

describe("IPShare", function () {
    let ipshare;
    let donut;
    let owner;
    let alice;
    let bob;
    let carol;
    let subject;
    let donutFeeDestination;
    let createFee = 0;

    async function getSubjectFee(amount) {
        return amount * await ipshare.subjectFeePercent() / 10000n
    }

    async function getProtocolFee(amount) {
        return amount * await ipshare.donutFeePercent() / 10000n
    }

    async function createIPShare(user, amount, price) {
        return ipshare.connect(user).createShare(user)
    }

    async function buyIPShare(subject, buyer, amount, amountOutMin) {
        return ipshare.connect(buyer).buyShares(subject, buyer, amountOutMin, {
          value: parseAmount(amount),
        });
      }

    async function sellIPShare(subject, seller, share, amountOutMin) {
        return ipshare.connect(seller).sellShares(subject, share, amountOutMin);
    }

    async function stakeIPShare(subject, staker, share) {
        return ipshare.connect(staker).stake(subject, parseAmount(share));
    }

    async function unstakeIPShare(subject, staker, share) {
        return ipshare.connect(staker).unstake(subject, parseAmount(share));
    }
    

    beforeEach(async () => {
       ({
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
            subject
        } = await loadFixture(deployIPShare));
    })

    describe('admin', function() {
        describe('adminSetDonut', function() {
            it("will revert if the caller is not the owner", async () => {
                await expect(ipshare.connect(alice).adminSetDonut(donut.address)).to.be
                .revertedWithCustomError(ipshare, 'OwnableUnauthorizedAccount');
            });
        
            it("set donut contract address", async () => {
            await ipshare.connect(owner).adminSetDonut(donut);
            expect(await ipshare.donut()).eq(donut.address);
            })
        })

        describe("admin start trade", function () {
            it("will revert if the caller is not the owner", async () => {
                await expect(ipshare.connect(alice).adminStartTrade()).to.be
                .revertedWithCustomError(ipshare, 'OwnableUnauthorizedAccount');

                expect(await ipshare.startTrade()).eq(false);
            });
        
            it("Start trade", async () => {
            await ipshare.connect(owner).adminStartTrade();
            expect(await ipshare.startTrade()).eq(true);
            })
        })

        describe("admin start fomo3d", function () {
            it("will revert if the caller is not the owner", async () => {
                await expect(ipshare.connect(alice).adminStartFM3D()).to.be
                .revertedWithCustomError(ipshare, 'OwnableUnauthorizedAccount');

                expect(await ipshare.startFM3D()).eq(false);
            });
        
            it("Start fomo 3d", async () => {
                await expect(ipshare.connect(owner).adminStartFM3D()).to.be
                    .revertedWithCustomError(ipshare, 'DonutNotSet');
                await ipshare.connect(owner).adminSetDonut(donut);
                await ipshare.connect(owner).adminStartFM3D();
                expect(await ipshare.startFM3D()).eq(true)
            })
        })  
        
        describe("adminSetSubjectFeePercent", function () {
            it("will revert if the caller is not the owner", async () => {
              await expect(ipshare.connect(alice).adminSetSubjectFeePercent(520)).to.be
              .revertedWithCustomError(ipshare, 'OwnableUnauthorizedAccount');
            })
      
            it("subject fee must not be greater than 10%", async () => {
              await expect(ipshare.connect(owner).adminSetSubjectFeePercent(2000)).
                to.be.revertedWithCustomError(ipshare, 'FeePercentIsTooLarge')
            })
      
            it("set correct fee percentage", async () => {
              const fee = 999;
              await ipshare.connect(owner).adminSetSubjectFeePercent(fee)
              expect(await ipshare.subjectFeePercent()).eq(fee);
            })
          })
      
          describe("adminSetDonutFeePercent", function () {
            it("will revert if the caller is not the owner", async () => {
              await expect(ipshare.connect(alice).adminSetDonutFeePercent(520)).to.be
                .revertedWithCustomError(ipshare, 'OwnableUnauthorizedAccount');
            })
      
            it("donut fee must not be greater than 10%", async () => {
              await expect(ipshare.connect(owner).adminSetDonutFeePercent(2000)).
                to.be.revertedWithCustomError(ipshare, 'FeePercentIsTooLarge')
            })
      
            it("set correct fee percentage", async () => {
              const fee = 999;
              await ipshare.connect(owner).adminSetDonutFeePercent(fee)
              expect(await ipshare.donutFeePercent()).eq(fee);
            })
          })
      
          describe("adminSetDonutFeeDestination:Which address does the fee go to", function () {
            it("will revert if the caller is not the owner", async () => {
              const addr = "0x1234567890123456789012345678901234567890"
              await expect(ipshare.connect(alice).adminSetDonutFeeDestination(addr)).to.be
              .revertedWithCustomError(ipshare, 'OwnableUnauthorizedAccount');
            })
      
            it("set donut fee collector", async () => {
              const addr = "0x1234567890123456789012345678901234567890"
              await ipshare.connect(owner).adminSetDonutFeeDestination(addr)
              expect(await ipshare.donutFeeDestination()).eq(addr)
            })
          })
    })

    describe('before trade', function() {
        it('Everyone can create ipshare', async () => {
            let amount = 0;
            const bb = await ethers.provider.getBalance(alice)
            await expect(createIPShare(alice, amount, 5))
                .to.emit(ipshare, "CreateIPshare")
                .withArgs(alice.address, parseAmount(10), createFee);
            

            const ba = await ethers.provider.getBalance(alice)

            expect(await ipshare.ipshareCreated(alice)).eq(true);

            amount = 10
            await expect(createIPShare(bob, amount, 5))
                .to.emit(ipshare, "CreateIPshare")
                .withArgs(bob.address, parseAmount(10), createFee);

            expect(await ipshare.ipshareCreated(bob)).eq(true);
        })

        it('Cannt buy and sell shares', async () => {
            await createIPShare(alice, 10, 5);
            await expect(ipshare.connect(bob).buyShares(alice, bob, 0n, {
                value: parseAmount(1)
            })).to.be.revertedWithCustomError(ipshare, 'PendingTradeNow')
            await expect(ipshare.connect(alice).buyShares(alice, alice, 0n, {
                value: parseAmount(1)
            })).to.be.revertedWithCustomError(ipshare, 'PendingTradeNow')
        })

        it('Cannt stake and unstake shares', async () => {
            await createIPShare(alice, 10, 5);
            await expect(ipshare.connect(alice).stake(alice, parseAmount(0.1))).to.be
            .revertedWithCustomError(ipshare, 'PendingTradeNow')

            await expect(ipshare.connect(alice).unstake(alice, parseAmount(0.1))).to.be
            .revertedWithCustomError(ipshare, 'PendingTradeNow')
        })

        it('Can create ipshare for other one', async () => {
            let amount = 1;
            await expect(ipshare.connect(alice).createShare(bob))
            .to.emit(ipshare, 'CreateIPshare')
            .withArgs(bob.address, parseAmount(10), createFee);
            expect(await ipshare.ipshareBalance(alice, alice)).eq(0);
            expect(await ipshare.ipshareBalance(alice, bob)).eq(0);
            expect(await ipshare.ipshareCreated(alice)).eq(false);
            expect(await ipshare.ipshareBalance(bob, alice)).eq(0);
            expect(await ipshare.ipshareBalance(bob, bob)).eq(0);
            expect(await ipshare.ipshareSupply(bob)).eq(parseAmount(10))
        })

        it('Auto stake when create ipshare', async () => {
            let amount = 0;
            await expect(createIPShare(alice, amount, 5))
                .to.emit(ipshare, "CreateIPshare")
                .withArgs(alice.address, parseAmount(amount + 10), createFee);

            expect(await ipshare.ipshareCreated(alice)).eq(true);
            expect(await ipshare.ipshareBalance(alice, alice)).eq(0);
            expect(await ipshare.ipshareSupply(alice)).eq(parseAmount(amount + 10));
            const aliceStakeInfo = await ipshare.getStakerInfo(alice, alice);
            expect(aliceStakeInfo[0]).eq(alice);
            expect(aliceStakeInfo[1]).eq(parseAmount(amount + 10))

            await expect(createIPShare(bob, amount, 5))
                .to.emit(ipshare, "CreateIPshare")
                .withArgs(bob.address, parseAmount(10), createFee);

            expect(await ipshare.ipshareCreated(bob)).eq(true);
            expect(await ipshare.ipshareBalance(bob, bob)).eq(0);
            expect(await ipshare.ipshareSupply(bob)).eq(parseAmount(10));
            const bobStakeInfo = await ipshare.getStakerInfo(bob, bob);
            expect(bobStakeInfo[0]).eq(bob);
            expect(bobStakeInfo[1]).eq(parseAmount(10))
        })

        it("Can capture value", async () => {
            await createIPShare(subject, 10, 5);
            await expect(ipshare.valueCapture(subject, {
                value: parseAmount(0.1)
            })).to.emit(ipshare, 'ValueCaptured')
            .withArgs(subject, owner, parseAmount(0.1))

            const supply = await ipshare.ipshareSupply(subject)
            const balance = await ipshare.ipshareBalance(subject, ipshare)
            const stakeInfo = await ipshare.getStakerInfo(subject, subject)
            // console.log(supply.toString() / 1e18, balance.toString() / 1e18, stakeInfo)
        })

        it('Can claim captured shares', async () => {
            await createIPShare(subject, 10, 5);
            await expect(ipshare.valueCapture(subject, {
                value: parseAmount(0.1)
            })).to.emit(ipshare, 'ValueCaptured')
            .withArgs(subject, owner, parseAmount(0.1))

            await ipshare.connect(subject).claim(subject)
            const balance = await ipshare.ipshareBalance(subject, ipshare)
            const suBalance = await ipshare.ipshareBalance(subject, subject)
            // console.log(balance.toString() / 1e18, suBalance.toString() / 1e18)
        })
    })

    describe('Start trade', function() {
        beforeEach(async () => {
            await ipshare.adminStartTrade();
            await createIPShare(subject, 0, 0)
        })

        it('Can buy and sell shares', async () => {
 
            await expect(buyIPShare(subject, alice, 0.1, 0))
                .to.emit(ipshare, 'Trade')
                .withArgs(
                    alice,
                    subject,
                    true,
                    11082067376306707856n,
                    100000000000000000n,
                    2500000000000000n,
                    4500000000000000n,
                    21082067376306707856n
                )

            await expect(sellIPShare(subject, alice, parseAmount(10), 0n))
                .to.emit(ipshare, 'Trade')
                .withArgs(
                    alice,
                    subject,
                    false,
                    10000000000000000000n,
                    88988741476467283n,
                    2224718536911682n,
                    4004493366441027n,
                    11082067376306707856n
                )
        })

        it('Cannt buy shares with slippage', async () => {
            await createIPShare(alice, 10, 5);
            const supply = await ipshare.ipshareSupply(alice)
            const buyAmount = await ipshare.getBuyAmountByValue(supply, parseAmount(1))
            await expect(ipshare.connect(bob).buyShares(alice, bob, buyAmount, {
                value: parseAmount(1)
            })).to.be.revertedWithCustomError(ipshare, 'OutOfSlippage')

            await expect(ipshare.connect(bob).buyShares(alice, bob, buyAmount * 950n / 1000n, {
                value: parseAmount(1)
            })).to.emit(ipshare, 'Trade')
            .withArgs(
                bob,
                alice,
                true,
                33916508338293499783n,
                1000000000000000000n,
                25000000000000000n,
                45000000000000000n,
                43916508338293499783n
            )
        })
        it('Cannt sell shares with slippage', async () => {
            await createIPShare(alice, 10, 5);
            let amount = parseAmount(10)
            const supply = await ipshare.ipshareSupply(alice)
            console.log(10, supply)
            await buyIPShare(alice, bob, 1, 0)
            const balance = await ipshare.ipshareBalance(alice, bob)
            console.log(1, balance.toString() / 1e18)
            
            amount = balance / 2n;
            const aa = await ipshare.getSellPriceAfterFee(alice, amount)
            console.log(2,aa)
            await expect(ipshare.connect(bob).sellShares(alice, amount, aa + 1n)).to.be.revertedWithCustomError(ipshare, 'OutOfSlippage')
            await expect(ipshare.connect(bob).sellShares(alice, amount, aa))
                .to.emit(ipshare, 'Trade')
                .withArgs(
                    bob,
                    alice,
                    false,
                    16958254169146749891n,
                    723423967166235937n,
                    18085599179155898n,
                    32554078522480617n,
                    26958254169146749892n
                )
        })

        it('Can stake and unstake shares', async () => {
            await buyIPShare(subject, alice, 10, 0)
            await expect(ipshare.connect(alice).stake(subject, parseAmount(30)))
                .to.emit(ipshare, 'Stake')
                .withArgs(alice, subject, true, parseAmount(30), parseAmount(30))
            await expect(ipshare.connect(alice).stake(subject, parseAmount(20)))
                .to.emit(ipshare, 'Stake')
                .withArgs(alice, subject, true, parseAmount(20), parseAmount(50))

            await expect(ipshare.connect(alice).unstake(subject, parseAmount(10)))
                .to.emit(ipshare, 'Stake')
                .withArgs(alice, subject, false, parseAmount(10), parseAmount(40))

            await time.increase(86400 * 8)
            // redeem
            const balanceBefore = await ipshare.ipshareBalance(subject, alice)
            await ipshare.connect(alice).redeem(subject)
            const balanceAfter = await ipshare.ipshareBalance(subject, alice)
            expect(balanceBefore + parseAmount(10)).eq(balanceAfter)
        })

        it("Can capture value and claim reward", async () => {
            await buyIPShare(subject, alice, 0.1, 0)
            await ipshare.connect(alice).stake(subject, parseAmount(10))
            await expect(ipshare.valueCapture(subject, {
                value: parseAmount(0.1)
            })).to.emit(ipshare, 'ValueCaptured')
            .withArgs(subject, owner, parseAmount(0.1))

            const sbb = await ipshare.ipshareBalance(subject, subject)
            const abb = await ipshare.ipshareBalance(subject, alice)

            await ipshare.connect(subject).claim(subject)
            await ipshare.connect(alice).claim(subject)

            const sba = await ipshare.ipshareBalance(subject, subject)
            const aba = await ipshare.ipshareBalance(subject, alice)
            
            expect(sba).gt(sbb)
            expect(aba).gt(abb)
            expect((sba - sbb) / (aba - abb)).eq(1)
            // console.log(sba - sbb, aba - abb)
        })
    })
})