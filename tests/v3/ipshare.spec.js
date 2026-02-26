const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { deployCoreFixture, toWei } = require("./fixtures/deploy");

describe("IPShare (v3)", function () {
  async function deployIpShareFixture() {
    const fixture = await deployCoreFixture();
    return fixture;
  }

  async function createAndStartTrade(ipshare, owner, subject) {
    await ipshare.connect(owner).adminStartTrade();
    await ipshare.connect(subject).createShare(subject.address);
  }

  it("should create ipshare and auto-stake initial 10 shares", async function () {
    const { ipshare, creator } = await loadFixture(deployIpShareFixture);

    await ipshare.connect(creator).createShare(ethers.ZeroAddress);

    const stakerInfo = await ipshare.getStakerInfo(creator.address, creator.address);
    expect(await ipshare.ipshareCreated(creator.address)).to.equal(true);
    expect(await ipshare.ipshareSupply(creator.address)).to.equal(toWei(10));
    expect(await ipshare.totalStakedIPshare(creator.address)).to.equal(toWei(10));
    expect(await ipshare.ipshareBalance(creator.address, creator.address)).to.equal(0n);
    expect(stakerInfo.amount).to.equal(toWei(10));
  });

  it("should enforce create fee and refund extra payment", async function () {
    const { ipshare, owner, creator, ipshareFeeDestination } = await loadFixture(deployIpShareFixture);
    const createFee = toWei(0.005);
    await ipshare.connect(owner).adminSetCreateFee(createFee);

    await expect(
      ipshare.connect(creator).createShare(creator.address, {
        value: createFee - 1n,
      })
    ).to.be.revertedWithCustomError(ipshare, "InsufficientPay");

    const extra = toWei(1);
    const destinationBefore = await ethers.provider.getBalance(ipshareFeeDestination.address);
    await ipshare.connect(creator).createShare(creator.address, {
      value: createFee + extra,
    });
    const destinationAfter = await ethers.provider.getBalance(ipshareFeeDestination.address);

    expect(destinationAfter - destinationBefore).to.equal(createFee);
    expect(await ethers.provider.getBalance(ipshare.target)).to.equal(0n);
  });

  it("should block buy and sell before trade starts", async function () {
    const { ipshare, creator, buyer } = await loadFixture(deployIpShareFixture);
    await ipshare.connect(creator).createShare(creator.address);

    await expect(
      ipshare.connect(buyer).buyShares(creator.address, buyer.address, 0, {
        value: toWei(1),
      })
    ).to.be.revertedWithCustomError(ipshare, "PendingTradeNow");

    await expect(ipshare.connect(creator).sellShares(creator.address, 1, 0)).to.be.revertedWithCustomError(
      ipshare,
      "PendingTradeNow"
    );
  });

  it("should reject selling below min hold shares", async function () {
    const { ipshare, owner, creator } = await loadFixture(deployIpShareFixture);
    await createAndStartTrade(ipshare, owner, creator);

    await ipshare.connect(creator).unstake(creator.address, toWei(10));
    await time.increase(8 * 24 * 60 * 60);
    await ipshare.connect(creator).redeem(creator.address);

    await expect(
      ipshare.connect(creator).sellShares(creator.address, toWei(1), 0)
    ).to.be.revertedWithCustomError(ipshare, "CanntSellLast10Shares");
  });

  it("should support stake, unstake and redeem lifecycle", async function () {
    const { ipshare, owner, creator, buyer } = await loadFixture(deployIpShareFixture);
    await createAndStartTrade(ipshare, owner, creator);

    await ipshare.connect(buyer).buyShares(creator.address, buyer.address, 0, {
      value: toWei(1),
    });
    const buyerBalance = await ipshare.ipshareBalance(creator.address, buyer.address);
    const stakeAmount = buyerBalance / 2n;

    await ipshare.connect(buyer).stake(creator.address, stakeAmount);
    await ipshare.connect(buyer).unstake(creator.address, stakeAmount / 2n);

    await expect(ipshare.connect(buyer).redeem(creator.address)).to.be.revertedWithCustomError(
      ipshare,
      "IPShareIsInlockingPeriodNow"
    );

    await time.increase(8 * 24 * 60 * 60);
    const beforeRedeem = await ipshare.ipshareBalance(creator.address, buyer.address);
    await ipshare.connect(buyer).redeem(creator.address);
    const afterRedeem = await ipshare.ipshareBalance(creator.address, buyer.address);
    expect(afterRedeem).to.equal(beforeRedeem + stakeAmount / 2n);
  });

  it("should distribute valueCapture profits proportionally to stakers", async function () {
    const { ipshare, owner, creator, alice, bob } = await loadFixture(deployIpShareFixture);
    await createAndStartTrade(ipshare, owner, creator);

    await ipshare.connect(alice).buyShares(creator.address, alice.address, 0, {
      value: toWei(1),
    });
    await ipshare.connect(bob).buyShares(creator.address, bob.address, 0, {
      value: toWei(1),
    });

    const aliceLiquid = await ipshare.ipshareBalance(creator.address, alice.address);
    const bobLiquid = await ipshare.ipshareBalance(creator.address, bob.address);

    const aliceStake = aliceLiquid / 2n;
    const bobStake = bobLiquid / 4n;
    await ipshare.connect(alice).stake(creator.address, aliceStake);
    await ipshare.connect(bob).stake(creator.address, bobStake);

    await ipshare.valueCapture(creator.address, {
      value: toWei(1),
    });

    const alicePending = await ipshare.getPendingProfits(creator.address, alice.address);
    const bobPending = await ipshare.getPendingProfits(creator.address, bob.address);
    expect(alicePending).to.be.gt(0n);
    expect(bobPending).to.be.gt(0n);
    expect(alicePending).to.be.gt(bobPending);

    const aliceBefore = await ipshare.ipshareBalance(creator.address, alice.address);
    const bobBefore = await ipshare.ipshareBalance(creator.address, bob.address);
    await ipshare.connect(alice).claim(creator.address);
    await ipshare.connect(bob).claim(creator.address);
    const aliceAfter = await ipshare.ipshareBalance(creator.address, alice.address);
    const bobAfter = await ipshare.ipshareBalance(creator.address, bob.address);

    expect(aliceAfter - aliceBefore).to.be.gt(0n);
    expect(bobAfter - bobBefore).to.be.gt(0n);
    expect(aliceAfter - aliceBefore).to.be.gt(bobAfter - bobBefore);
  });

  it("should update max staker when stakes change", async function () {
    const { ipshare, owner, creator, alice } = await loadFixture(deployIpShareFixture);
    await createAndStartTrade(ipshare, owner, creator);

    let [maxStaker, maxAmount] = await ipshare.getMaxStaker(creator.address);
    expect(maxStaker).to.equal(creator.address);
    expect(maxAmount).to.equal(toWei(10));

    await ipshare.connect(alice).buyShares(creator.address, alice.address, 0, {
      value: toWei(2),
    });
    const aliceLiquid = await ipshare.ipshareBalance(creator.address, alice.address);
    await ipshare.connect(alice).stake(creator.address, aliceLiquid);

    [maxStaker, maxAmount] = await ipshare.getMaxStaker(creator.address);
    expect(maxStaker).to.equal(alice.address);
    expect(maxAmount).to.equal(aliceLiquid);
  });

  it("should buy shares successfully and update supply and buyer balance", async function () {
    const { ipshare, owner, creator, buyer } = await loadFixture(deployIpShareFixture);
    await createAndStartTrade(ipshare, owner, creator);

    const buyValue = toWei(1);
    const supplyBefore = await ipshare.ipshareSupply(creator.address);
    const protocolFeePercent = await ipshare.protocolFeePercent();
    const subjectFeePercent = await ipshare.subjectFeePercent();
    const protocolFee = (buyValue * protocolFeePercent) / 10000n;
    const subjectFee = (buyValue * subjectFeePercent) / 10000n;
    const buyFund = buyValue - protocolFee - subjectFee;
    const expectedReceived = await ipshare.getBuyAmountByValue(supplyBefore, buyFund);

    await expect(
      ipshare.connect(buyer).buyShares(creator.address, buyer.address, 0, {
        value: buyValue,
      })
    )
      .to.emit(ipshare, "Trade")
      .withArgs(
        buyer.address,
        creator.address,
        true,
        expectedReceived,
        buyValue,
        protocolFee,
        subjectFee,
        supplyBefore + expectedReceived
      );

    expect(await ipshare.ipshareBalance(creator.address, buyer.address)).to.equal(expectedReceived);
    expect(await ipshare.ipshareSupply(creator.address)).to.equal(supplyBefore + expectedReceived);
  });

  it("should distribute buy fees to protocol destination and subject", async function () {
    const { ipshare, owner, creator, buyer, ipshareFeeDestination } = await loadFixture(deployIpShareFixture);
    await createAndStartTrade(ipshare, owner, creator);

    const buyValue = toWei(1);
    const protocolFee = (buyValue * (await ipshare.protocolFeePercent())) / 10000n;
    const subjectFee = (buyValue * (await ipshare.subjectFeePercent())) / 10000n;

    const destinationBefore = await ethers.provider.getBalance(ipshareFeeDestination.address);
    const subjectBefore = await ethers.provider.getBalance(creator.address);

    await ipshare.connect(buyer).buyShares(creator.address, buyer.address, 0, {
      value: buyValue,
    });

    const destinationAfter = await ethers.provider.getBalance(ipshareFeeDestination.address);
    const subjectAfter = await ethers.provider.getBalance(creator.address);

    expect(destinationAfter - destinationBefore).to.equal(protocolFee);
    expect(subjectAfter - subjectBefore).to.equal(subjectFee);
  });

  it("should revert buy when subject ipshare does not exist", async function () {
    const { ipshare, owner, creator, buyer } = await loadFixture(deployIpShareFixture);
    await ipshare.connect(owner).adminStartTrade();

    await expect(
      ipshare.connect(buyer).buyShares(creator.address, buyer.address, 0, {
        value: toWei(1),
      })
    ).to.be.revertedWithCustomError(ipshare, "IPShareNotExist");
  });

  it("should revert buy when amountOutMin is higher than actual received", async function () {
    const { ipshare, owner, creator, buyer } = await loadFixture(deployIpShareFixture);
    await createAndStartTrade(ipshare, owner, creator);

    const buyValue = toWei(1);
    const supply = await ipshare.ipshareSupply(creator.address);
    const protocolFee = (buyValue * (await ipshare.protocolFeePercent())) / 10000n;
    const subjectFee = (buyValue * (await ipshare.subjectFeePercent())) / 10000n;
    const expectedReceived = await ipshare.getBuyAmountByValue(supply, buyValue - protocolFee - subjectFee);

    await expect(
      ipshare.connect(buyer).buyShares(creator.address, buyer.address, expectedReceived + 1n, {
        value: buyValue,
      })
    ).to.be.revertedWithCustomError(ipshare, "OutOfSlippage");
  });
});
