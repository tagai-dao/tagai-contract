const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { deployCoreFixture, toWei, saltFromNumber, createTokenByEvent } = require("../fixtures/deploy");

describe("Integration: Hook fee flow", function () {
  async function deployListingFixture() {
    const fixture = await deployCoreFixture();
    const { owner, pump } = fixture;

    const Vault = await ethers.getContractFactory("TestVault");
    const vault = await Vault.deploy();

    const CLPoolManager = await ethers.getContractFactory("TestCLPoolManager");
    const clPoolManager = await CLPoolManager.deploy(vault.target);

    await vault.connect(owner).registerApp(clPoolManager.target);

    await pump.connect(owner).adminSetPoolManager(clPoolManager.target);
    await pump.connect(owner).adminSetVault(vault.target);

    const SwapRouter = await ethers.getContractFactory("MockCLSwapRouter");
    const swapRouter = await SwapRouter.deploy(vault.target, clPoolManager.target);

    return {
      ...fixture,
      vault,
      clPoolManager,
      swapRouter,
    };
  }

  async function deployHookWithRealIPShareFixture() {
    const fixture = await deployCoreFixture();
    const { owner, creator, alice, bob, ipshare } = fixture;

    await ipshare.connect(owner).adminStartTrade();
    await ipshare.connect(creator).createShare(creator.address);

    const MockVault = await ethers.getContractFactory("MockVaultForHook");
    const vault = await MockVault.deploy();
    await owner.sendTransaction({ to: vault.target, value: toWei(10) });

    const MockPump = await ethers.getContractFactory("MockPumpForHook");
    const pump = await MockPump.deploy(owner.address, ipshare.target, 100, 200);

    const poolManager = alice;

    const TipTagSwapHook = await ethers.getContractFactory("TipTagSwapHook");
    const hook = await TipTagSwapHook.deploy(poolManager.address, vault.target, pump.target);

    const MockToken = await ethers.getContractFactory("MockTokenForHook");
    const token = await MockToken.deploy(creator.address);

    const key = {
      currency0: ethers.ZeroAddress,
      currency1: token.target,
      hooks: hook.target,
      poolManager: poolManager.address,
      fee: 0,
      parameters: ethers.ZeroHash,
    };

    await pump.setCreatedToken(token.target, true);
    await token.registerByKey(hook.target, key);

    await ipshare.connect(alice).buyShares(creator.address, alice.address, 0, { value: toWei(3) });
    await ipshare.connect(bob).buyShares(creator.address, bob.address, 0, { value: toWei(2) });

    const aliceLiquid = await ipshare.ipshareBalance(creator.address, alice.address);
    const bobLiquid = await ipshare.ipshareBalance(creator.address, bob.address);
    await ipshare.connect(alice).stake(creator.address, aliceLiquid);
    await ipshare.connect(bob).stake(creator.address, (bobLiquid * 3n) / 4n);

    return {
      ...fixture,
      vault,
      pump,
      hook,
      token,
      key,
      poolManager,
    };
  }

  async function listToken(fixture, hookAddress) {
    const { creator, pump, feeReceiver, vault } = fixture;
    const salt = saltFromNumber(1);
    const createFee = await pump.createFee();
    const { token } = await createTokenByEvent(pump, creator, "DEX", salt, createFee);
    await pump.adminSetHookAddress(hookAddress);

    const feeReceiverBefore = await ethers.provider.getBalance(feeReceiver.address);
    const vaultEthBefore = await ethers.provider.getBalance(vault.target);
    const tokenEthBefore = await ethers.provider.getBalance(token.target);
    const tokenBalBefore = await token.balanceOf(token.target);

    const capAmount = toWei(650000000);
    const needEth = await pump.getBuyPriceAfterFee(0, capAmount);
    await token.connect(creator).buyToken(0, ethers.ZeroAddress, 0, "0x", 0, { value: needEth + 10_000_000_000n });

    const feeReceiverAfter = await ethers.provider.getBalance(feeReceiver.address);
    const vaultEthAfter = await ethers.provider.getBalance(vault.target);
    const tokenEthAfter = await ethers.provider.getBalance(token.target);
    const tokenBalAfter = await token.balanceOf(token.target);

    return {
      token,
      feeReceiverBefore,
      feeReceiverAfter,
      vaultEthBefore,
      vaultEthAfter,
      tokenEthBefore,
      tokenEthAfter,
      tokenBalBefore,
      tokenBalAfter,
    };
  }

  function buildPoolKey(tokenAddress, hookAddress, poolManagerAddress, hookBitmap) {
    const parameters = ethers.toBeHex((60n << 16n) | BigInt(hookBitmap), 32);
    return {
      currency0: ethers.ZeroAddress,
      currency1: tokenAddress,
      hooks: hookAddress,
      poolManager: poolManagerAddress,
      fee: 0,
      parameters,
    };
  }

  it("case3: listing should use fixed LP budget and flush remaining ETH", async function () {
    const fixture = await loadFixture(deployListingFixture);
    const { owner } = fixture;
    const MockHook = await ethers.getContractFactory("TipTagSwapHook");
    const hook = await MockHook.deploy(fixture.clPoolManager.target, fixture.vault.target, fixture.pump.target);
    await fixture.pump.connect(owner).adminSetHookAddress(hook.target);

    const {
      token,
      feeReceiverBefore,
      feeReceiverAfter,
      tokenEthBefore,
      tokenEthAfter,
      tokenBalBefore,
      tokenBalAfter,
    } = await listToken(fixture, hook.target);
    expect(await token.listed()).to.equal(true);
    expect(tokenEthBefore).to.equal(0n);
    expect(tokenEthAfter).to.equal(0n);
    expect(feeReceiverAfter).to.be.gte(feeReceiverBefore);
    // Before cap buy/listing, token contract holds full minted inventory (650M + 200M).
    expect(tokenBalBefore).to.equal(toWei(850000000));
    // Listing consumes up to 200M token for liquidity; leftovers remain in contract by design.
    expect(tokenBalAfter).to.be.lte(toWei(200000000));
  });

  it("case4: hook fee should flow into valueCapture and stakers can claim", async function () {
    const fixture = await loadFixture(deployHookWithRealIPShareFixture);
    const { creator, alice, bob, ipshare, hook, key, poolManager } = fixture;

    // ETH is unspecified side in afterSwap when amountSpecified<0 != zeroForOne.
    const params = {
      zeroForOne: false,
      amountSpecified: -1n,
      sqrtPriceLimitX96: 0,
    };
    const toBalanceDelta = (amount0, amount1) => {
      const two128 = 1n << 128n;
      const mask = two128 - 1n;
      const n0 = amount0 < 0n ? two128 + amount0 : amount0;
      const n1 = amount1 < 0n ? two128 + amount1 : amount1;
      return (n0 << 128n) | (n1 & mask);
    };
    const delta = toBalanceDelta(1_000_000n, 0n);

    // Remove creator's initial auto-stake so dividends are mainly for alice/bob.
    await ipshare.connect(creator).unstake(creator.address, toWei(10));

    await hook.connect(poolManager).afterSwap(poolManager.address, key, params, delta, "0x");

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

  it("case5: sell full 800m circulation should output near all pool ETH", async function () {
    const fixture = await loadFixture(deployListingFixture);
    const { owner, creator, pump, swapRouter, clPoolManager, ipshare, feeReceiver } = fixture;

    const TipTagSwapHook = await ethers.getContractFactory("TipTagSwapHook");
    const hook = await TipTagSwapHook.deploy(clPoolManager.target, fixture.vault.target, pump.target);
    await pump.connect(owner).adminSetHookAddress(hook.target);

    const { token } = await listToken(fixture, hook.target);
    expect(await token.listed()).to.equal(true);

    // Social allocation (150M) is in Nutbox community; creator only has bonding-curve tokens.
    const totalToSell = await token.balanceOf(creator.address);
    expect(totalToSell).to.be.gt(0n);

    const hookBitmap = await hook.getHooksRegistrationBitmap();
    const key = buildPoolKey(token.target, hook.target, clPoolManager.target, hookBitmap);
    const maxSqrtRatioMinusOne = 1461446703485210103287273052203988822378723970341n;

    const feeReceiverBefore = await ethers.provider.getBalance(feeReceiver.address);
    const pendingBefore = await ipshare.getPendingProfits(creator.address, creator.address);

    await token.connect(creator).approve(swapRouter.target, totalToSell);
    const quote = await swapRouter
      .connect(creator)
      .swapExactInputTokenForETH.staticCall(key, totalToSell, maxSqrtRatioMinusOne, creator.address);
    const ethOut = quote[0];
    expect(ethOut).to.be.gt(toWei(18));

    await swapRouter.connect(creator).swapExactInputTokenForETH(key, totalToSell, maxSqrtRatioMinusOne, creator.address);

    const feeReceiverAfter = await ethers.provider.getBalance(feeReceiver.address);
    const pendingAfter = await ipshare.getPendingProfits(creator.address, creator.address);
    expect(feeReceiverAfter).to.be.gt(feeReceiverBefore);
    expect(pendingAfter).to.be.gt(pendingBefore);
  });

  it("case6: listing should switch from unlisted to listed across cap boundary", async function () {
    const fixture = await loadFixture(deployListingFixture);
    const { owner, creator, pump } = fixture;

    const TipTagSwapHook = await ethers.getContractFactory("TipTagSwapHook");
    const hook = await TipTagSwapHook.deploy(fixture.clPoolManager.target, fixture.vault.target, pump.target);
    await pump.connect(owner).adminSetHookAddress(hook.target);

    const salt = saltFromNumber(2);
    const createFee = await pump.createFee();
    const { token } = await createTokenByEvent(pump, creator, "EDG", salt, createFee);

    const firstTargetAmount = toWei(649000000);
    const firstNeedEth = await pump.getBuyPriceAfterFee(0, firstTargetAmount);
    await token.connect(creator).buyToken(0, ethers.ZeroAddress, 0, "0x", 0, { value: firstNeedEth });

    expect(await token.listed()).to.equal(false);
    expect(await token.bondingCurveSupply()).to.be.lt(toWei(650000000));

    const createdAt = await token.createdAt();
    await time.increaseTo(createdAt + 16n);

    const currentSupply = await token.bondingCurveSupply();
    const secondNeedEth = await pump.getBuyPriceAfterFee(currentSupply, toWei(2000000));
    await token.connect(creator).buyToken(0, ethers.ZeroAddress, 0, "0x", 0, { value: secondNeedEth + 10_000_000_000n });

    expect(await token.listed()).to.equal(true);
    expect(await token.bondingCurveSupply()).to.equal(toWei(650000000));
  });

  it("case7: repeated post-list swaps should accumulate protocol fee and pending profits", async function () {
    const fixture = await loadFixture(deployListingFixture);
    const { owner, creator, pump, swapRouter, clPoolManager, ipshare, feeReceiver } = fixture;

    const TipTagSwapHook = await ethers.getContractFactory("TipTagSwapHook");
    const hook = await TipTagSwapHook.deploy(clPoolManager.target, fixture.vault.target, pump.target);
    await pump.connect(owner).adminSetHookAddress(hook.target);

    const { token } = await listToken(fixture, hook.target);
    expect(await token.listed()).to.equal(true);

    const totalToSell = await token.balanceOf(creator.address);
    const halfSell = totalToSell / 2n;
    await token.connect(creator).approve(swapRouter.target, totalToSell);

    const hookBitmap = await hook.getHooksRegistrationBitmap();
    const key = buildPoolKey(token.target, hook.target, clPoolManager.target, hookBitmap);
    const maxSqrtRatioMinusOne = 1461446703485210103287273052203988822378723970341n;

    const fee0 = await ethers.provider.getBalance(feeReceiver.address);
    const pending0 = await ipshare.getPendingProfits(creator.address, creator.address);

    await swapRouter.connect(creator).swapExactInputTokenForETH(key, halfSell, maxSqrtRatioMinusOne, creator.address);
    const fee1 = await ethers.provider.getBalance(feeReceiver.address);
    const pending1 = await ipshare.getPendingProfits(creator.address, creator.address);

    await swapRouter.connect(creator).swapExactInputTokenForETH(key, halfSell, maxSqrtRatioMinusOne, creator.address);
    const fee2 = await ethers.provider.getBalance(feeReceiver.address);
    const pending2 = await ipshare.getPendingProfits(creator.address, creator.address);

    expect(fee1).to.be.gt(fee0);
    expect(fee2).to.be.gt(fee1);
    expect(pending1).to.be.gt(pending0);
    expect(pending2).to.be.gt(pending1);
  });

  it("case8: listing should satisfy bounded ETH/TOKEN conservation checks", async function () {
    const fixture = await loadFixture(deployListingFixture);
    const { owner, pump } = fixture;

    const TipTagSwapHook = await ethers.getContractFactory("TipTagSwapHook");
    const hook = await TipTagSwapHook.deploy(fixture.clPoolManager.target, fixture.vault.target, pump.target);
    await pump.connect(owner).adminSetHookAddress(hook.target);

    const {
      token,
      feeReceiverBefore,
      feeReceiverAfter,
      vaultEthBefore,
      vaultEthAfter,
      tokenEthBefore,
      tokenEthAfter,
      tokenBalBefore,
      tokenBalAfter,
    } = await listToken(fixture, hook.target);

    // Listing lifecycle should end with no ETH left on token contract.
    expect(await token.listed()).to.equal(true);
    expect(tokenEthBefore).to.equal(0n);
    expect(tokenEthAfter).to.equal(0n);

    // ETH should be split into LP settlement (vault) + platform flush (feeReceiver).
    const vaultEthDelta = vaultEthAfter - vaultEthBefore;
    const feeEthDelta = feeReceiverAfter - feeReceiverBefore;
    expect(vaultEthDelta).to.be.gt(0n);
    expect(vaultEthDelta).to.be.lte(toWei(19));
    expect(feeEthDelta).to.be.gt(0n);

    // Token inventory drop includes bonding-curve distribution (650M) + LP allocation (<=200M).
    const consumedToken = tokenBalBefore - tokenBalAfter;
    expect(tokenBalBefore).to.equal(toWei(850000000));
    expect(consumedToken).to.be.gt(0n);
    expect(consumedToken).to.be.gte(toWei(650000000));
    expect(consumedToken).to.be.lte(toWei(850000000));
    expect(tokenBalAfter).to.be.gte(0n);
  });
});
