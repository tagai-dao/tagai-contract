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

  async function deployListedTokenFixture() {
    const fixture = await deployCoreFixture();
    const { owner, creator, pump } = fixture;

    const Vault = await ethers.getContractFactory("TestVault");
    const vault = await Vault.deploy();
    const CLPoolManager = await ethers.getContractFactory("TestCLPoolManager");
    const clPoolManager = await CLPoolManager.deploy(vault.target);
    await vault.connect(owner).registerApp(clPoolManager.target);

    await pump.connect(owner).adminSetPoolManager(clPoolManager.target);
    await pump.connect(owner).adminSetVault(vault.target);

    const TipTagSwapHook = await ethers.getContractFactory("TipTagSwapHook");
    const hook = await TipTagSwapHook.deploy(clPoolManager.target, vault.target, pump.target);
    await pump.connect(owner).adminSetHookAddress(hook.target);

    const salt = saltFromNumber(88);
    const createFee = await pump.createFee();
    const { token } = await createTokenByEvent(pump, creator, "CLM", salt, createFee);

    const capAmount = toWei(650000000);
    const needEth = await pump.getBuyPriceAfterFee(0, capAmount);
    await token.connect(creator).buyToken(0, ethers.ZeroAddress, 0, "0x", 0, { value: needEth + 10_000_000_000n });

    return {
      ...fixture,
      vault,
      clPoolManager,
      hook,
      token,
    };
  }

  it("should revert when total create fee is insufficient for auto-create ipshare", async function () {
    const { pump, creator } = await loadFixture(deployWithIpShareCreateFee);
    const salt = saltFromNumber(1);

    // pumpCreateFee (0.005) + ipshareCreateFee (0.005) = 0.01 ETH; send less than that
    await expect(
      pump.connect(creator).createToken("TKN1", salt, {
        value: toWei(0.009),
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

  it("should reject createToken when caller is a contract (Only EOA)", async function () {
    const { pump, creator } = await loadFixture(deployCoreFixture);
    const PumpCaller = await ethers.getContractFactory("PumpCaller");
    const caller = await PumpCaller.deploy();

    await expect(
      caller.connect(creator).callCreateToken(pump.target, "EOA1", saltFromNumber(1), { value: toWei(0.01) })
    ).to.be.revertedWith("Only EOA");
  });

  it("should reject duplicated tick and non-increasing salt", async function () {
    const { pump, creator } = await loadFixture(deployCoreFixture);
    const createFee = await pump.createFee();

    await createTokenByEvent(pump, creator, "DUP", saltFromNumber(1), createFee);
    await expect(
      pump.connect(creator).createToken("DUP", saltFromNumber(2), { value: createFee })
    ).to.be.revertedWithCustomError(pump, "TickHasBeenCreated");

    await expect(
      pump.connect(creator).createToken("NEW", saltFromNumber(1), { value: createFee })
    ).to.be.revertedWithCustomError(pump, "SaltNotAvailable");
  });

  it("should match predictTokenAddress with deployed token address", async function () {
    const { pump, creator } = await loadFixture(deployCoreFixture);
    const createFee = await pump.createFee();
    const salt = saltFromNumber(3);
    const predicted = await pump.predictTokenAddress(creator.address, salt);
    const { tokenAddress } = await createTokenByEvent(pump, creator, "PRED", salt, createFee);
    expect(tokenAddress).to.equal(predicted);
  });

  it("should link Nutbox community, pool, and emit NutboxLinked on createToken", async function () {
    const { pump, creator } = await loadFixture(deployCoreFixture);
    const createFee = await pump.createFee();
    const salt = saltFromNumber(42);
    const tx = await pump.connect(creator).createToken("NBX", salt, { value: createFee });
    const receipt = await tx.wait();

    const parsed = receipt.logs
      .map((log) => {
        try {
          return pump.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    const linked = parsed.find((p) => p.name === "NutboxLinked");
    expect(linked).to.not.equal(undefined);
    const tokenAddr = linked.args.token;
    const token = await ethers.getContractAt("Token", tokenAddr);
    expect(await token.nutboxCommunity()).to.equal(linked.args.community);
    expect(await token.nutboxSocialPool()).to.equal(linked.args.socialPool);
    expect(await pump.createdTokens(tokenAddr)).to.equal(true);

    const comm = await ethers.getContractAt("MockNutboxCommunity", linked.args.community);
    expect(await comm.owner()).to.equal(creator.address);
    const alloc = await token.NUTBOX_ALLOCATION();
    expect(await token.balanceOf(linked.args.community)).to.equal(alloc);
  });
});
