const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { toWei } = require("./fixtures/deploy");

const TWO_128 = 1n << 128n;
const MASK_128 = TWO_128 - 1n;

function toTwos128(x) {
  return x < 0n ? TWO_128 + x : x;
}

function toBalanceDelta(amount0, amount1) {
  return (toTwos128(amount0) << 128n) | (toTwos128(amount1) & MASK_128);
}

describe("TipTagSwapHook (v3)", function () {
  async function deployHookFixture() {
    const [owner, poolManager, feeReceiver, subject, other] = await ethers.getSigners();

    const MockIPShare = await ethers.getContractFactory("MockIPShareForHook");
    const ipshare = await MockIPShare.deploy();

    const MockVault = await ethers.getContractFactory("MockVaultForHook");
    const vault = await MockVault.deploy();

    const MockPump = await ethers.getContractFactory("MockPumpForHook");
    const pump = await MockPump.deploy(feeReceiver.address, ipshare.target, 100, 200);

    const TipTagSwapHook = await ethers.getContractFactory("TipTagSwapHook");
    const hook = await TipTagSwapHook.deploy(poolManager.address, vault.target, pump.target);

    const MockToken = await ethers.getContractFactory("MockTokenForHook");
    const token = await MockToken.deploy(subject.address);

    const key = {
      currency0: ethers.ZeroAddress,
      currency1: token.target,
      hooks: hook.target,
      poolManager: poolManager.address,
      fee: 0,
      parameters: ethers.ZeroHash,
    };

    await owner.sendTransaction({ to: vault.target, value: toWei(10) });

    return {
      owner,
      poolManager,
      feeReceiver,
      subject,
      other,
      ipshare,
      vault,
      pump,
      hook,
      token,
      key,
    };
  }

  async function registerPool(fixture) {
    const { pump, token, hook, key } = fixture;
    await pump.setCreatedToken(token.target, true);
    await token.registerByKey(hook.target, key);
  }

  it("should reject pool registration when token is not created by pump", async function () {
    const { token, hook, key } = await loadFixture(deployHookFixture);

    await expect(token.registerByKey(hook.target, key)).to.be.revertedWithCustomError(hook, "Unauthorized");
  });

  it("should allow token to register pool when created by pump", async function () {
    const fixture = await loadFixture(deployHookFixture);
    const { token, hook, key } = fixture;
    await fixture.pump.setCreatedToken(token.target, true);

    await expect(token.registerByKey(hook.target, key)).to.emit(hook, "PoolRegistered");
  });

  it("should allow only pool manager to call beforeSwap", async function () {
    const fixture = await loadFixture(deployHookFixture);
    const { hook, key, other } = fixture;

    const params = {
      zeroForOne: true,
      amountSpecified: -100000n,
      sqrtPriceLimitX96: 0,
    };

    await expect(hook.connect(other).beforeSwap(other.address, key, params, "0x")).to.be.revertedWithCustomError(
      hook,
      "NotPoolManager"
    );
  });

  it("should collect and distribute fees in beforeSwap", async function () {
    const fixture = await loadFixture(deployHookFixture);
    const { hook, key, poolManager, feeReceiver, subject, ipshare } = fixture;
    await registerPool(fixture);

    const params = {
      zeroForOne: true,
      amountSpecified: -100000n,
      sqrtPriceLimitX96: 0,
    };

    const feeReceiverBefore = await ethers.provider.getBalance(feeReceiver.address);
    const capturedBefore = await ipshare.totalCaptured();

    await expect(hook.connect(poolManager).beforeSwap(poolManager.address, key, params, "0x"))
      .to.emit(hook, "SwapFeeCollected")
      .withArgs(anyValue, key.currency1, 1000n, 2000n);

    const feeReceiverAfter = await ethers.provider.getBalance(feeReceiver.address);
    const capturedAfter = await ipshare.totalCaptured();

    expect(feeReceiverAfter - feeReceiverBefore).to.equal(1000n);
    expect(capturedAfter - capturedBefore).to.equal(2000n);
    expect(await ipshare.lastSubject()).to.equal(subject.address);
  });

  it("should collect and distribute fees in afterSwap when ETH is unspecified", async function () {
    const fixture = await loadFixture(deployHookFixture);
    const { hook, key, poolManager, feeReceiver, subject, ipshare } = fixture;
    await registerPool(fixture);

    const params = {
      zeroForOne: false,
      amountSpecified: -1n,
      sqrtPriceLimitX96: 0,
    };
    const delta = toBalanceDelta(50000n, 0n);

    const feeReceiverBefore = await ethers.provider.getBalance(feeReceiver.address);
    const capturedBefore = await ipshare.totalCaptured();

    await expect(hook.connect(poolManager).afterSwap(poolManager.address, key, params, delta, "0x"))
      .to.emit(hook, "SwapFeeCollected")
      .withArgs(anyValue, key.currency1, 500n, 1000n);

    const feeReceiverAfter = await ethers.provider.getBalance(feeReceiver.address);
    const capturedAfter = await ipshare.totalCaptured();

    expect(feeReceiverAfter - feeReceiverBefore).to.equal(500n);
    expect(capturedAfter - capturedBefore).to.equal(1000n);
    expect(await ipshare.lastSubject()).to.equal(subject.address);
  });

  it("should skip fee collection when fee ratio is zero", async function () {
    const fixture = await loadFixture(deployHookFixture);
    const { hook, key, poolManager, feeReceiver, ipshare, pump } = fixture;
    await registerPool(fixture);
    await pump.setFeeRatio(0, 0);

    const params = {
      zeroForOne: true,
      amountSpecified: -100000n,
      sqrtPriceLimitX96: 0,
    };

    const feeReceiverBefore = await ethers.provider.getBalance(feeReceiver.address);
    const capturedBefore = await ipshare.totalCaptured();

    await hook.connect(poolManager).beforeSwap(poolManager.address, key, params, "0x");

    const feeReceiverAfter = await ethers.provider.getBalance(feeReceiver.address);
    const capturedAfter = await ipshare.totalCaptured();

    expect(feeReceiverAfter).to.equal(feeReceiverBefore);
    expect(capturedAfter).to.equal(capturedBefore);
  });
});
