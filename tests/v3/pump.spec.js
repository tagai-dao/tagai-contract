const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
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
    await token.connect(creator).buyToken(0, ethers.ZeroAddress, 0, { value: needEth + 10_000_000_000n });

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

  it("should reject userClaim when fee is insufficient", async function () {
    const { pump, creator, token } = await loadFixture(deployListedTokenFixture);
    const dummySig = "0x" + "11".repeat(65);
    const claimFee = await pump.getClaimFee();

    await expect(
      pump.connect(creator).userClaim(token.target, 1n, toWei(1), dummySig, { value: claimFee - 1n })
    ).to.be.revertedWithCustomError(pump, "CostFeeFail");
  });

  it("should reject userClaim with invalid signature", async function () {
    const { owner, pump, creator, token } = await loadFixture(deployListedTokenFixture);
    await pump.connect(owner).adminChangeClaimSigner(owner.address);

    // Create some pending social rewards so amount check does not fail first.
    await time.increase(2);
    await pump.claimPendingSocialRewards(token.target);

    const orderId = 1n;
    const claimAmount = toWei(1);
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const digest = ethers.solidityPackedKeccak256(
      ["uint256", "address", "uint256", "address", "uint256"],
      [chainId, token.target, orderId, creator.address, claimAmount]
    );
    // Signed by creator instead of owner(claimSigner), should fail.
    const invalidSig = await creator.signMessage(ethers.getBytes(digest));
    const claimFee = await pump.getClaimFee();

    await expect(
      pump.connect(creator).userClaim(token.target, orderId, claimAmount, invalidSig, { value: claimFee })
    ).to.be.revertedWithCustomError(pump, "InvalidSignature");
  });

  it("should reject duplicated claim order id", async function () {
    const { owner, pump, creator, token } = await loadFixture(deployListedTokenFixture);
    await pump.connect(owner).adminChangeClaimSigner(owner.address);

    const claimAmount = toWei(1);
    await time.increase(claimAmount / 12_870_000_000_000_000_000n + 2n);
    await pump.claimPendingSocialRewards(token.target);

    const orderId = 7n;
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const digest = ethers.solidityPackedKeccak256(
      ["uint256", "address", "uint256", "address", "uint256"],
      [chainId, token.target, orderId, creator.address, claimAmount]
    );
    const sig = await owner.signMessage(ethers.getBytes(digest));
    const claimFee = await pump.getClaimFee();

    await pump.connect(creator).userClaim(token.target, orderId, claimAmount, sig, { value: claimFee });
    await expect(
      pump.connect(creator).userClaim(token.target, orderId, claimAmount, sig, { value: claimFee })
    ).to.be.revertedWithCustomError(pump, "ClaimOrderExist");
  });

  it("should claim social rewards and update all claim states", async function () {
    const { owner, pump, creator, token } = await loadFixture(deployListedTokenFixture);
    await pump.connect(owner).adminChangeClaimSigner(owner.address);

    const claimAmount = toWei(2);
    await time.increase(claimAmount / 12_870_000_000_000_000_000n + 2n);
    await pump.claimPendingSocialRewards(token.target);

    const pendingBefore = await pump.pendingClaimSocialRewards(token.target);
    const claimedBefore = await pump.totalClaimedSocialRewards(token.target);
    const userBefore = await token.balanceOf(creator.address);

    const orderId = 99n;
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const digest = ethers.solidityPackedKeccak256(
      ["uint256", "address", "uint256", "address", "uint256"],
      [chainId, token.target, orderId, creator.address, claimAmount]
    );
    const sig = await owner.signMessage(ethers.getBytes(digest));
    const claimFee = await pump.getClaimFee();

    await pump.connect(creator).userClaim(token.target, orderId, claimAmount, sig, { value: claimFee });

    const pendingAfter = await pump.pendingClaimSocialRewards(token.target);
    const claimedAfter = await pump.totalClaimedSocialRewards(token.target);
    const userAfter = await token.balanceOf(creator.address);

    expect(await pump.claimedOrder(token.target, orderId)).to.equal(true);
    expect(pendingBefore - pendingAfter).to.equal(claimAmount);
    expect(claimedAfter - claimedBefore).to.equal(claimAmount);
    expect(userAfter - userBefore).to.equal(claimAmount);
  });
});
