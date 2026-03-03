const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { deployCoreFixture, toWei, saltFromNumber, createTokenByEvent } = require("../../v3/fixtures/deploy");

describe("Fork(v3): Full onchain flow", function () {
  const FORK_BLOCK = 83628324n;
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

  function getParsedEvents(receipt, contractInterface, eventName, expectedAddress) {
    return receipt.logs
      .filter((log) => !expectedAddress || log.address.toLowerCase() === expectedAddress.toLowerCase())
      .map((log) => {
        try {
          return contractInterface.parseLog(log);
        } catch (_) {
          return null;
        }
      })
      .filter((ev) => ev && ev.name === eventName);
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

  it("should complete create -> bonding trades -> list -> dex swap full flow", async function () {
    const fixture = await loadFixture(deployForkFixture);
    const { creator, buyer, feeReceiver, pump, ipshare, hook, poolManager, vault } = fixture;

    const blockNum = await ethers.provider.getBlockNumber();
    expect(BigInt(blockNum)).to.be.gte(FORK_BLOCK);

    // 1) Create token
    const salt = saltFromNumber(20260227);
    const expectedAddr = await pump.predictTokenAddress(creator.address, salt);
    const createFee = await pump.createFee();
    const { token } = await createTokenByEvent(pump, creator, "FULL", salt, createFee);
    expect(token.target).to.equal(expectedAddr);
    expect(await pump.createdTokens(token.target)).to.equal(true);
    expect(await token.listed()).to.equal(false);

    // 2) Bonding curve buy/sell in pre-list phase
    const buyValue = toWei(1);
    const buyerBalanceBefore = await token.balanceOf(buyer.address);
    const feeRatio = await pump.getFeeRatio();
    const feeReceiverBeforeCurve = await ethers.provider.getBalance(feeReceiver.address);
    const pendingBeforeCurve = await ipshare.getPendingProfits(creator.address, creator.address);
    const curveSupplyBeforeCapture = await ipshare.ipshareSupply(creator.address);

    const buyTx = await token.connect(buyer).buyToken(0, ethers.ZeroAddress, 0, { value: buyValue });
    const buyReceipt = await buyTx.wait();
    const buyTrades = getParsedEvents(buyReceipt, token.interface, "Trade", token.target);
    expect(buyTrades.length).to.equal(1);
    const buyTrade = buyTrades[0].args;
    expect(buyTrade.isBuy).to.equal(true);
    expect(buyTrade.ethAmount).to.equal(buyValue);
    expect(buyTrade.tiptagFee).to.equal((buyValue * feeRatio[0]) / 10000n);
    expect(buyTrade.sellsmanFee).to.equal((buyValue * feeRatio[1]) / 10000n);

    const buyerBalanceAfterBuy = await token.balanceOf(buyer.address);
    expect(buyerBalanceAfterBuy).to.be.gt(buyerBalanceBefore);

    const supplyAfterBuy = await token.bondingCurveSupply();
    const sellAmount = buyerBalanceAfterBuy / 2n;
    const sellTx = await token.connect(buyer).sellToken(sellAmount, 0, ethers.ZeroAddress, 0);
    const sellReceipt = await sellTx.wait();
    const sellTrades = getParsedEvents(sellReceipt, token.interface, "Trade", token.target);
    expect(sellTrades.length).to.equal(1);
    const sellTrade = sellTrades[0].args;
    expect(sellTrade.isBuy).to.equal(false);
    const afterSupply = supplyAfterBuy - sellAmount;
    const sellPrice = await pump.getPrice(afterSupply, sellAmount);
    expect(sellTrade.ethAmount).to.equal(sellPrice);
    expect(sellTrade.tiptagFee).to.equal((sellPrice * feeRatio[0]) / 10000n);
    expect(sellTrade.sellsmanFee).to.equal((sellPrice * feeRatio[1]) / 10000n);

    const supplyAfterSell = await token.bondingCurveSupply();
    expect(supplyAfterSell).to.be.lt(supplyAfterBuy);

    const feeReceiverAfterCurve = await ethers.provider.getBalance(feeReceiver.address);
    const pendingAfterCurve = await ipshare.getPendingProfits(creator.address, creator.address);
    const expectedCurveFee = buyTrade.tiptagFee + sellTrade.tiptagFee;
    expect(feeReceiverAfterCurve - feeReceiverBeforeCurve).to.equal(expectedCurveFee);

    const expectedCurvePendingDelta = await computeExpectedPendingDelta(
      ipshare,
      creator.address,
      creator.address,
      [buyTrade.sellsmanFee, sellTrade.sellsmanFee],
      curveSupplyBeforeCapture
    );
    expect(pendingAfterCurve - pendingBeforeCurve).to.be.gte(expectedCurvePendingDelta - 3n);
    expect(pendingAfterCurve - pendingBeforeCurve).to.be.lte(expectedCurvePendingDelta + 3n);

    // 3) List to Pancake V4 by filling bonding curve cap
    await registerVaultAppIfNeeded(vault, token.target, creator);
    // Avoid anti-snipe dynamic fee window affecting cap-fill listing amount.
    const createdAt = await token.createdAt();
    await time.increaseTo(createdAt + 16n);
    const capAmount = toWei(650000000);
    const supplyNow = await token.bondingCurveSupply();
    const remain = capAmount - supplyNow;
    const needEth = await pump.getBuyPriceAfterFee(supplyNow, remain);
    const feeReceiverBeforeListingBuy = await ethers.provider.getBalance(feeReceiver.address);
    const pendingBeforeListingBuy = await ipshare.getPendingProfits(creator.address, creator.address);
    const listingSupplyBeforeCapture = await ipshare.ipshareSupply(creator.address);
    const tokenEthBeforeListing = await ethers.provider.getBalance(token.target);
    const listingTx = await token.connect(creator).buyToken(0, ethers.ZeroAddress, 0, { value: needEth + 10_000_000_000n });
    const listingReceipt = await listingTx.wait();
    const listingTrades = getParsedEvents(listingReceipt, token.interface, "Trade", token.target);
    expect(listingTrades.length).to.equal(1);
    const listingTrade = listingTrades[0].args;
    expect(listingTrade.isBuy).to.equal(true);

    expect(await token.listed()).to.equal(true);
    const poolId = await token.v4PoolId();
    expect(poolId).to.not.equal(ethers.ZeroHash);

    const hookBitmap = await hook.getHooksRegistrationBitmap();
    const key = buildPoolKey(token.target, hook.target, poolManager, hookBitmap);
    expect(computePoolId(key)).to.equal(poolId);

    const clpm = new ethers.Contract(poolManager, ["function getLiquidity(bytes32 id) external view returns (uint128)"], creator);
    expect(await clpm.getLiquidity(poolId)).to.be.gt(0n);

    const feeReceiverAfterListingBuy = await ethers.provider.getBalance(feeReceiver.address);
    const pendingAfterListingBuy = await ipshare.getPendingProfits(creator.address, creator.address);
    const tokenEthAfterListing = await ethers.provider.getBalance(token.target);
    const expectedListingFlush =
      tokenEthBeforeListing + listingTrade.ethAmount - listingTrade.tiptagFee - listingTrade.sellsmanFee - toWei(19);
    const expectedListingFeeReceiverDelta = listingTrade.tiptagFee + expectedListingFlush;
    const listingFeeReceiverDelta = feeReceiverAfterListingBuy - feeReceiverBeforeListingBuy;
    const listingResidual =
      listingFeeReceiverDelta > expectedListingFeeReceiverDelta
        ? listingFeeReceiverDelta - expectedListingFeeReceiverDelta
        : expectedListingFeeReceiverDelta - listingFeeReceiverDelta;
    expect(listingResidual).to.be.lte(1000n);
    expect(tokenEthAfterListing).to.equal(0n);
    const expectedListingPendingDelta = await computeExpectedPendingDelta(
      ipshare,
      creator.address,
      creator.address,
      [listingTrade.sellsmanFee],
      listingSupplyBeforeCapture
    );
    expect(pendingAfterListingBuy - pendingBeforeListingBuy).to.be.gte(expectedListingPendingDelta - 3n);
    expect(pendingAfterListingBuy - pendingBeforeListingBuy).to.be.lte(expectedListingPendingDelta + 3n);

    // listed 后曲线交易应关闭
    await expect(token.connect(buyer).buyToken(0, ethers.ZeroAddress, 0, { value: toWei(1) })).to.be.revertedWithCustomError(
      token,
      "TokenListed"
    );

    // 4) Swap on real Pancake V4 via Permit2 + UniversalRouter
    const permit2 = new ethers.Contract(
      PERMIT2,
      ["function approve(address token, address spender, uint160 amount, uint48 expiration) external"],
      creator
    );
    const universalRouter = new ethers.Contract(
      UNIVERSAL_ROUTER,
      ["function execute(bytes commands, bytes[] inputs, uint256 deadline) external payable"],
      creator
    );

    const creatorTokenBeforeSwap = await token.balanceOf(creator.address);
    const swapIn = toWei(10000000);
    expect(creatorTokenBeforeSwap).to.be.gte(swapIn);

    await token.connect(creator).approve(PERMIT2, ethers.MaxUint256);
    await permit2.approve(token.target, UNIVERSAL_ROUTER, (1n << 160n) - 1n, (1n << 48n) - 1n);

    const clSwapExactInSingle = ethers.AbiCoder.defaultAbiCoder().encode(
      ["tuple(tuple(address currency0,address currency1,address hooks,address poolManager,uint24 fee,bytes32 parameters) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData)"],
      [[key, false, BigInt(swapIn), 0n, "0x"]]
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

    const feeBefore = await ethers.provider.getBalance(feeReceiver.address);
    const pendingBefore = await ipshare.getPendingProfits(creator.address, creator.address);
    const dexSupplyBefore1 = await ipshare.ipshareSupply(creator.address);

    const deadline = BigInt((await ethers.provider.getBlock("latest")).timestamp) + 600n;
    const swapTx = await universalRouter.execute(COMMAND_INFI_SWAP, [infiPayload], deadline);
    const swapReceipt = await swapTx.wait();
    const hookEvents1 = getParsedEvents(swapReceipt, hook.interface, "SwapFeeCollected", hook.target);
    expect(hookEvents1.length).to.equal(1);
    const hookFee1 = hookEvents1[0].args;

    const creatorTokenAfterSwap = await token.balanceOf(creator.address);
    const feeAfter = await ethers.provider.getBalance(feeReceiver.address);
    const pendingAfter = await ipshare.getPendingProfits(creator.address, creator.address);

    expect(creatorTokenAfterSwap).to.be.lt(creatorTokenBeforeSwap);
    expect(feeAfter - feeBefore).to.equal(hookFee1.platformFee);
    const expectedDexPendingDelta1 = await computeExpectedPendingDelta(
      ipshare,
      creator.address,
      creator.address,
      [hookFee1.deployerFee],
      dexSupplyBefore1
    );
    expect(pendingAfter - pendingBefore).to.be.gte(expectedDexPendingDelta1 - 3n);
    expect(pendingAfter - pendingBefore).to.be.lte(expectedDexPendingDelta1 + 3n);

    // 5) Reverse swap on DEX: BNB -> TOKEN
    const buyInBnb = toWei(0.2);
    const creatorTokenBeforeReverse = await token.balanceOf(creator.address);
    const feeBeforeReverse = await ethers.provider.getBalance(feeReceiver.address);
    const pendingBeforeReverse = await ipshare.getPendingProfits(creator.address, creator.address);
    const dexSupplyBefore2 = await ipshare.ipshareSupply(creator.address);

    const clSwapExactInSingleReverse = ethers.AbiCoder.defaultAbiCoder().encode(
      ["tuple(tuple(address currency0,address currency1,address hooks,address poolManager,uint24 fee,bytes32 parameters) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData)"],
      [[key, true, BigInt(buyInBnb), 0n, "0x"]]
    );
    const settleAllReverse = ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [ethers.ZeroAddress, ethers.MaxUint256]);
    const takeAllReverse = ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [token.target, 0n]);
    const infiPayloadReverse = ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes", "bytes[]"],
      ["0x" + ACTION_CL_SWAP_EXACT_IN_SINGLE.slice(2) + ACTION_SETTLE_ALL.slice(2) + ACTION_TAKE_ALL.slice(2), [
        clSwapExactInSingleReverse,
        settleAllReverse,
        takeAllReverse,
      ]]
    );

    const deadlineReverse = BigInt((await ethers.provider.getBlock("latest")).timestamp) + 600n;
    const reverseTx = await universalRouter.execute(COMMAND_INFI_SWAP, [infiPayloadReverse], deadlineReverse, { value: buyInBnb });
    const reverseReceipt = await reverseTx.wait();
    const hookEvents2 = getParsedEvents(reverseReceipt, hook.interface, "SwapFeeCollected", hook.target);
    expect(hookEvents2.length).to.equal(1);
    const hookFee2 = hookEvents2[0].args;

    const creatorTokenAfterReverse = await token.balanceOf(creator.address);
    const feeAfterReverse = await ethers.provider.getBalance(feeReceiver.address);
    const pendingAfterReverse = await ipshare.getPendingProfits(creator.address, creator.address);

    expect(creatorTokenAfterReverse).to.be.gt(creatorTokenBeforeReverse);
    expect(feeAfterReverse - feeBeforeReverse).to.equal(hookFee2.platformFee);
    const expectedDexPendingDelta2 = await computeExpectedPendingDelta(
      ipshare,
      creator.address,
      creator.address,
      [hookFee2.deployerFee],
      dexSupplyBefore2
    );
    expect(pendingAfterReverse - pendingBeforeReverse).to.be.gte(expectedDexPendingDelta2 - 3n);
    expect(pendingAfterReverse - pendingBeforeReverse).to.be.lte(expectedDexPendingDelta2 + 3n);

    // ======================== 6) hookData: custom IPShare subject on DEX ========================
    // Create IPShare for alice so we can use her as a custom subject
    const { alice, bob } = fixture;
    await ipshare.adminStartTrade();
    const minHoldPrice = await ipshare.getPrice(10n * 10n ** 18n, 0n);
    const aliceIPShareFee = await ipshare.createFee();
    await ipshare.connect(alice).createShare(alice.address, { value: minHoldPrice + aliceIPShareFee });

    // Helper to build swap payloads
    function buildSwapPayload(swapKey, zeroForOne, amountIn, hookData) {
      const clSwap = ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(tuple(address currency0,address currency1,address hooks,address poolManager,uint24 fee,bytes32 parameters) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData)"],
        [[swapKey, zeroForOne, BigInt(amountIn), 0n, hookData]]
      );
      const settleToken = zeroForOne ? ethers.ZeroAddress : swapKey.currency1;
      const takeToken = zeroForOne ? swapKey.currency1 : ethers.ZeroAddress;
      const settle = ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [settleToken, ethers.MaxUint256]);
      const take = ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [takeToken, 0n]);
      return ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes", "bytes[]"],
        [
          "0x" + ACTION_CL_SWAP_EXACT_IN_SINGLE.slice(2) + ACTION_SETTLE_ALL.slice(2) + ACTION_TAKE_ALL.slice(2),
          [clSwap, settle, take],
        ]
      );
    }

    // 6a) TOKEN -> BNB swap with hookData specifying alice as the IPShare subject
    {
      const hookData = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [alice.address]);
      const hookSwapIn = toWei(5000000);
      const infiPayload6a = buildSwapPayload(key, false, hookSwapIn, hookData);

      const feeReceiverBefore6a = await ethers.provider.getBalance(feeReceiver.address);
      const alicePendingBefore6a = await ipshare.getPendingProfits(alice.address, alice.address);
      const creatorPendingBefore6a = await ipshare.getPendingProfits(creator.address, creator.address);

      const deadline6a = BigInt((await ethers.provider.getBlock("latest")).timestamp) + 600n;
      const swapTx6a = await universalRouter.execute(COMMAND_INFI_SWAP, [infiPayload6a], deadline6a);
      const swapReceipt6a = await swapTx6a.wait();

      const hookEvents6a = getParsedEvents(swapReceipt6a, hook.interface, "SwapFeeCollected", hook.target);
      expect(hookEvents6a.length).to.equal(1);
      expect(hookEvents6a[0].args.deployerFee).to.be.gt(0n);

      const feeReceiverAfter6a = await ethers.provider.getBalance(feeReceiver.address);
      expect(feeReceiverAfter6a - feeReceiverBefore6a).to.equal(hookEvents6a[0].args.platformFee);

      // Fee should go to alice's IPShare, NOT creator's
      const alicePendingAfter6a = await ipshare.getPendingProfits(alice.address, alice.address);
      const creatorPendingAfter6a = await ipshare.getPendingProfits(creator.address, creator.address);
      expect(alicePendingAfter6a).to.be.gt(alicePendingBefore6a);
      expect(creatorPendingAfter6a).to.equal(creatorPendingBefore6a);
    }

    // 6b) BNB -> TOKEN swap with hookData specifying alice
    {
      const hookData = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [alice.address]);
      const hookBuyBnb = toWei(0.1);
      const infiPayload6b = buildSwapPayload(key, true, hookBuyBnb, hookData);

      const alicePendingBefore6b = await ipshare.getPendingProfits(alice.address, alice.address);
      const creatorPendingBefore6b = await ipshare.getPendingProfits(creator.address, creator.address);

      const deadline6b = BigInt((await ethers.provider.getBlock("latest")).timestamp) + 600n;
      const swapTx6b = await universalRouter.execute(COMMAND_INFI_SWAP, [infiPayload6b], deadline6b, { value: hookBuyBnb });
      const swapReceipt6b = await swapTx6b.wait();

      const hookEvents6b = getParsedEvents(swapReceipt6b, hook.interface, "SwapFeeCollected", hook.target);
      expect(hookEvents6b.length).to.equal(1);
      expect(hookEvents6b[0].args.deployerFee).to.be.gt(0n);

      const alicePendingAfter6b = await ipshare.getPendingProfits(alice.address, alice.address);
      const creatorPendingAfter6b = await ipshare.getPendingProfits(creator.address, creator.address);
      expect(alicePendingAfter6b).to.be.gt(alicePendingBefore6b);
      expect(creatorPendingAfter6b).to.equal(creatorPendingBefore6b);
    }

    // 6c) hookData subject with no IPShare (bob) — should fall back to creator
    {
      const hookData = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [bob.address]);
      const hookBuyBnb = toWei(0.1);
      const infiPayload6c = buildSwapPayload(key, true, hookBuyBnb, hookData);

      const creatorPendingBefore6c = await ipshare.getPendingProfits(creator.address, creator.address);

      const deadline6c = BigInt((await ethers.provider.getBlock("latest")).timestamp) + 600n;
      const swapTx6c = await universalRouter.execute(COMMAND_INFI_SWAP, [infiPayload6c], deadline6c, { value: hookBuyBnb });
      const swapReceipt6c = await swapTx6c.wait();

      const hookEvents6c = getParsedEvents(swapReceipt6c, hook.interface, "SwapFeeCollected", hook.target);
      expect(hookEvents6c.length).to.equal(1);

      // Should fall back to creator since bob has no IPShare
      const creatorPendingAfter6c = await ipshare.getPendingProfits(creator.address, creator.address);
      expect(creatorPendingAfter6c).to.be.gt(creatorPendingBefore6c);
    }

    // 6d) Empty hookData — backward compatible, fee goes to creator
    {
      const hookBuyBnb = toWei(0.1);
      const infiPayload6d = buildSwapPayload(key, true, hookBuyBnb, "0x");

      const creatorPendingBefore6d = await ipshare.getPendingProfits(creator.address, creator.address);

      const deadline6d = BigInt((await ethers.provider.getBlock("latest")).timestamp) + 600n;
      const swapTx6d = await universalRouter.execute(COMMAND_INFI_SWAP, [infiPayload6d], deadline6d, { value: hookBuyBnb });
      const swapReceipt6d = await swapTx6d.wait();

      const hookEvents6d = getParsedEvents(swapReceipt6d, hook.interface, "SwapFeeCollected", hook.target);
      expect(hookEvents6d.length).to.equal(1);

      const creatorPendingAfter6d = await ipshare.getPendingProfits(creator.address, creator.address);
      expect(creatorPendingAfter6d).to.be.gt(creatorPendingBefore6d);
    }
  });
});
