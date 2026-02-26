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
    const { creator, pump, feeReceiver } = fixture;
    const salt = saltFromNumber(1);
    const createFee = await pump.createFee();
    const { token } = await createTokenByEvent(pump, creator, "DEX", salt, createFee);
    await pump.adminSetHookAddress(hookAddress);

    const feeReceiverBefore = await ethers.provider.getBalance(feeReceiver.address);
    const tokenEthBefore = await ethers.provider.getBalance(token.target);
    const tokenBalBefore = await token.balanceOf(token.target);

    const capAmount = toWei(650000000);
    const needEth = await pump.getBuyPriceAfterFee(0, capAmount);
    await token.connect(creator).buyToken(0, ethers.ZeroAddress, 0, { value: needEth + 10_000_000_000n });

    const feeReceiverAfter = await ethers.provider.getBalance(feeReceiver.address);
    const tokenEthAfter = await ethers.provider.getBalance(token.target);
    const tokenBalAfter = await token.balanceOf(token.target);

    return { token, feeReceiverBefore, feeReceiverAfter, tokenEthBefore, tokenEthAfter, tokenBalBefore, tokenBalAfter };
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

    await pump.connect(owner).adminChangeClaimSigner(owner.address);

    const TipTagSwapHook = await ethers.getContractFactory("TipTagSwapHook");
    const hook = await TipTagSwapHook.deploy(clPoolManager.target, fixture.vault.target, pump.target);
    await pump.connect(owner).adminSetHookAddress(hook.target);

    const { token } = await listToken(fixture, hook.target);
    expect(await token.listed()).to.equal(true);

    // claim 150M social-distribution token for creator
    const claimAmount = toWei(150000000);
    const claimRatePerSecond = 12_870_000_000_000_000_000n; // 12.87 token/sec
    const waitSeconds = claimAmount / claimRatePerSecond + 1n;
    await time.increase(waitSeconds);

    const orderId = 1n;
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const digest = ethers.solidityPackedKeccak256(
      ["uint256", "address", "uint256", "address", "uint256"],
      [chainId, token.target, orderId, creator.address, claimAmount]
    );
    const signature = await owner.signMessage(ethers.getBytes(digest));
    const claimFee = await pump.getClaimFee();
    await pump.connect(creator).userClaim(token.target, orderId, claimAmount, signature, { value: claimFee });

    // creator should hold 650M (curve) + 150M (social) = 800M token
    const totalToSell = toWei(800000000);
    expect(await token.balanceOf(creator.address)).to.equal(totalToSell);

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
});
