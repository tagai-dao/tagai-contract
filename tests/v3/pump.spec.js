const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { deployCoreFixture, toWei, saltFromNumber, createTokenByEvent } = require("./fixtures/deploy");

describe("Pump (v3)", function () {
  async function deployWithIpShareCreateFee() {
    const fixture = await deployCoreFixture();
    await fixture.ipshare.connect(fixture.owner).adminSetCreateFee(toWei(0.005));
    return fixture;
  }

  it("should revert when total create fee is insufficient for auto-create ipshare", async function () {
    const { pump, creator } = await loadFixture(deployWithIpShareCreateFee);
    const salt = saltFromNumber(1);

    await expect(
      pump.connect(creator).createToken("TKN1", salt, {
        value: toWei(0.01), // only covers pump createFee, not ipshare createFee
      })
    ).to.be.revertedWithCustomError(pump, "InsufficientCreateFee");
  });

  it("should forward ipshare create fee and create token successfully", async function () {
    const { pump, ipshare, creator, feeReceiver, ipshareFeeDestination } = await loadFixture(
      deployWithIpShareCreateFee
    );
    const salt = saltFromNumber(2);

    const pumpCreateFee = await pump.createFee();
    const ipshareCreateFee = await ipshare.createFee();
    const totalFee = pumpCreateFee + ipshareCreateFee;

    const feeReceiverBefore = await ethers.provider.getBalance(feeReceiver.address);
    const ipshareFeeBefore = await ethers.provider.getBalance(ipshareFeeDestination.address);

    await createTokenByEvent(pump, creator, "TKN2", salt, totalFee);

    const feeReceiverAfter = await ethers.provider.getBalance(feeReceiver.address);
    const ipshareFeeAfter = await ethers.provider.getBalance(ipshareFeeDestination.address);

    expect(await ipshare.ipshareCreated(creator.address)).to.equal(true);
    expect(await pump.getLastSaltIndex(creator.address)).to.equal(BigInt(salt));
    expect(await pump.totalTokens()).to.equal(1n);
    expect(feeReceiverAfter - feeReceiverBefore).to.equal(pumpCreateFee);
    expect(ipshareFeeAfter - ipshareFeeBefore).to.equal(ipshareCreateFee);
  });
});
