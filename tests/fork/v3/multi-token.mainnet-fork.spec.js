const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { deployCoreFixture, toWei, saltFromNumber, createTokenByEvent } = require("../../v3/fixtures/deploy");

describe("Fork(v3): Multi-token isolation", function () {
  before(function () {
    if (process.env.ENABLE_FORK !== "1") {
      this.skip();
    }
  });

  const UNIVERSAL_ROUTER = "0xd9C500DfF816a1Da21A48A732d3498Bf09dc9AEB";
  const PERMIT2 = "0x31c2F6fcFf4F8759b3Bd5Bf0e1084A055615c768";
  const COMMAND_INFI_SWAP = "0x10";
  const ACTION_CL_SWAP_EXACT_IN_SINGLE = "0x06";
  const ACTION_SETTLE_ALL = "0x0c";
  const ACTION_TAKE_ALL = "0x0f";

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

  function computePoolId(key) {
    return ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(address currency0,address currency1,address hooks,address poolManager,uint24 fee,bytes32 parameters)"],
        [key]
      )
    );
  }

  function parseEvents(receipt, contractInterface, eventName, addr) {
    return receipt.logs
      .filter((log) => log.address.toLowerCase() === addr.toLowerCase())
      .map((log) => {
        try {
          return contractInterface.parseLog(log);
        } catch (_) {
          return null;
        }
      })
      .filter((ev) => ev && ev.name === eventName);
  }

  function absDiff(a, b) {
    return a >= b ? a - b : b - a;
  }

  async function computeExpectedPendingDelta(ipshare, subject, staker, captureValues, supplyBefore) {
    const subjectFeePercent = await ipshare.subjectFeePercent();
    const protocolFeePercent = await ipshare.protocolFeePercent();
    const totalStaked = await ipshare.totalStakedIPshare(subject);
    const stakerInfo = await ipshare.getStakerInfo(subject, staker);
    const stakerAmount = stakerInfo.amount;

    let supply = supplyBefore;
    let expectedPendingDelta = 0n;
    for (const capturedEth of captureValues) {
      const subjectFee = (capturedEth * subjectFeePercent) / 10000n;
      const protocolFee = (capturedEth * protocolFeePercent) / 10000n;
      const netFunds = capturedEth - subjectFee - protocolFee;
      const obtainedAmount = await ipshare.getBuyAmountByValue(supply, netFunds);
      const accDelta = (obtainedAmount * 10n ** 18n) / totalStaked;
      expectedPendingDelta += (accDelta * stakerAmount) / 10n ** 18n;
      supply += obtainedAmount;
    }
    return expectedPendingDelta;
  }

  async function deployForkFixture() {
    const fixture = await deployCoreFixture();
    const { owner, pump } = fixture;
    const poolManager = await pump.getPoolManager();
    const vault = await pump.getVault();

    const TipTagSwapHook = await ethers.getContractFactory("TipTagSwapHook");
    const hook = await TipTagSwapHook.deploy(poolManager, vault, pump.target);
    await pump.connect(owner).adminSetHookAddress(hook.target);

    return { ...fixture, poolManager, vault, hook };
  }

  async function registerVaultAppIfNeeded(vaultAddress, app, signer) {
    const vault = new ethers.Contract(
      vaultAddress,
      [
        "function isAppRegistered(address app) external returns (bool)",
        "function registerApp(address app) external",
        "function owner() external view returns (address)",
      ],
      signer
    );
    const isRegistered = await vault.isAppRegistered(app);
    if (isRegistered) return;
    try {
      await vault.registerApp(app);
    } catch (_) {
      const owner = await vault.owner();
      await ethers.provider.send("hardhat_setBalance", [owner, "0x3635C9ADC5DEA00000"]);
      await ethers.provider.send("hardhat_impersonateAccount", [owner]);
      const ownerSigner = await ethers.getSigner(owner);
      await vault.connect(ownerSigner).registerApp(app);
      await ethers.provider.send("hardhat_stopImpersonatingAccount", [owner]);
    }
  }

  async function createAndListToken({ pump, vault, signer, tick, saltNum }) {
    const createFee = await pump.createFee();
    const { token } = await createTokenByEvent(pump, signer, tick, saltFromNumber(saltNum), createFee);

    // pre-list normal buy/sell
    await token.connect(signer).buyToken(0, ethers.ZeroAddress, 0, "0x", 0, { value: toWei(1) });
    const bal = await token.balanceOf(signer.address);
    await token.connect(signer).sellToken(bal / 4n, 0, ethers.ZeroAddress, 0, "0x", 0);

    await registerVaultAppIfNeeded(vault, token.target, signer);
    const createdAt = await token.createdAt();
    await time.increaseTo(createdAt + 16n);

    const capAmount = toWei(650000000);
    const supplyNow = await token.bondingCurveSupply();
    const remain = capAmount - supplyNow;
    const needEth = await pump.getBuyPriceAfterFee(supplyNow, remain);
    await token.connect(signer).buyToken(0, ethers.ZeroAddress, 0, "0x", 0, { value: needEth + 10_000_000_000n });

    expect(await token.listed()).to.equal(true);
    return token;
  }

  async function swapTokenForBnb({ token, key, trader, hook, amountIn }) {
    const permit2 = new ethers.Contract(
      PERMIT2,
      ["function approve(address token, address spender, uint160 amount, uint48 expiration) external"],
      trader
    );
    const universalRouter = new ethers.Contract(
      UNIVERSAL_ROUTER,
      ["function execute(bytes commands, bytes[] inputs, uint256 deadline) external payable"],
      trader
    );

    await token.connect(trader).approve(PERMIT2, ethers.MaxUint256);
    await permit2.approve(token.target, UNIVERSAL_ROUTER, (1n << 160n) - 1n, (1n << 48n) - 1n);

    const clSwapExactInSingle = ethers.AbiCoder.defaultAbiCoder().encode(
      ["tuple(tuple(address currency0,address currency1,address hooks,address poolManager,uint24 fee,bytes32 parameters) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData)"],
      [[key, false, BigInt(amountIn), 0n, "0x"]]
    );
    const settleAll = ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [token.target, ethers.MaxUint256]);
    const takeAll = ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [ethers.ZeroAddress, 0n]);
    const infiPayload = ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes", "bytes[]"],
      ["0x" + ACTION_CL_SWAP_EXACT_IN_SINGLE.slice(2) + ACTION_SETTLE_ALL.slice(2) + ACTION_TAKE_ALL.slice(2), [
        clSwapExactInSingle,
        settleAll,
        takeAll,
      ]]
    );

    const deadline = BigInt((await ethers.provider.getBlock("latest")).timestamp) + 600n;
    const tx = await universalRouter.execute(COMMAND_INFI_SWAP, [infiPayload], deadline);
    const receipt = await tx.wait();
    const fees = parseEvents(receipt, hook.interface, "SwapFeeCollected", hook.target);
    expect(fees.length).to.equal(1);
    return fees[0].args;
  }

  it("should create and run two tokens independently on fork", async function () {
    const fixture = await loadFixture(deployForkFixture);
    const { creator, buyer, pump, hook, poolManager, feeReceiver, ipshare, vault } = fixture;

    const tokenA = await createAndListToken({ pump, vault, signer: creator, tick: "TKA", saltNum: 1001 });
    const tokenB = await createAndListToken({ pump, vault, signer: buyer, tick: "TKB", saltNum: 2001 });

    expect(tokenA.target).to.not.equal(tokenB.target);

    const poolIdA = await tokenA.v4PoolId();
    const poolIdB = await tokenB.v4PoolId();
    expect(poolIdA).to.not.equal(ethers.ZeroHash);
    expect(poolIdB).to.not.equal(ethers.ZeroHash);
    expect(poolIdA).to.not.equal(poolIdB);

    const hookBitmap = await hook.getHooksRegistrationBitmap();
    const keyA = buildPoolKey(tokenA.target, hook.target, poolManager, hookBitmap);
    const keyB = buildPoolKey(tokenB.target, hook.target, poolManager, hookBitmap);
    expect(computePoolId(keyA)).to.equal(poolIdA);
    expect(computePoolId(keyB)).to.equal(poolIdB);

    const balanceA1 = await tokenA.balanceOf(creator.address);
    const balanceB1 = await tokenB.balanceOf(buyer.address);
    const feeBefore = await ethers.provider.getBalance(feeReceiver.address);
    const pendingBeforeA = await ipshare.getPendingProfits(creator.address, creator.address);
    const pendingBeforeB = await ipshare.getPendingProfits(buyer.address, buyer.address);

    const swapInA = toWei(10000000);
    const swapInB = toWei(10000000);
    const supplyBeforeA = await ipshare.ipshareSupply(creator.address);

    const feeEventA = await swapTokenForBnb({ token: tokenA, key: keyA, trader: creator, hook, amountIn: swapInA });
    const balanceA2 = await tokenA.balanceOf(creator.address);
    const balanceB2 = await tokenB.balanceOf(buyer.address);
    expect(balanceA1 - balanceA2).to.equal(swapInA);
    expect(balanceB2).to.equal(balanceB1);
    expect(feeEventA.token).to.equal(tokenA.target);

    const supplyBeforeB = await ipshare.ipshareSupply(buyer.address);
    const feeEventB = await swapTokenForBnb({ token: tokenB, key: keyB, trader: buyer, hook, amountIn: swapInB });
    const balanceA3 = await tokenA.balanceOf(creator.address);
    const balanceB3 = await tokenB.balanceOf(buyer.address);
    expect(balanceA3).to.equal(balanceA2);
    expect(balanceB2 - balanceB3).to.equal(swapInB);
    expect(feeEventB.token).to.equal(tokenB.target);

    const feeAfter = await ethers.provider.getBalance(feeReceiver.address);
    const pendingAfterA = await ipshare.getPendingProfits(creator.address, creator.address);
    const pendingAfterB = await ipshare.getPendingProfits(buyer.address, buyer.address);

    expect(feeAfter - feeBefore).to.equal(feeEventA.platformFee + feeEventB.platformFee);

    const expectedPendingDeltaA = await computeExpectedPendingDelta(
      ipshare,
      creator.address,
      creator.address,
      [feeEventA.deployerFee],
      supplyBeforeA
    );
    const expectedPendingDeltaB = await computeExpectedPendingDelta(
      ipshare,
      buyer.address,
      buyer.address,
      [feeEventB.deployerFee],
      supplyBeforeB
    );
    const pendingDeltaA = pendingAfterA - pendingBeforeA;
    const pendingDeltaB = pendingAfterB - pendingBeforeB;
    expect(absDiff(pendingDeltaA, expectedPendingDeltaA) <= 3n).to.equal(true);
    expect(absDiff(pendingDeltaB, expectedPendingDeltaB) <= 3n).to.equal(true);

    await expect(
      tokenA.connect(creator).buyToken(0, ethers.ZeroAddress, 0, "0x", 0, { value: toWei(1) })
    ).to.be.revertedWithCustomError(
      tokenA,
      "TokenListed"
    );
    await expect(
      tokenB.connect(buyer).buyToken(0, ethers.ZeroAddress, 0, "0x", 0, { value: toWei(1) })
    ).to.be.revertedWithCustomError(
      tokenB,
      "TokenListed"
    );
  });
});
