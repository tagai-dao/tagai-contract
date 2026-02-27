const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { deployCoreFixture, toWei, saltFromNumber, createTokenByEvent } = require("../../v3/fixtures/deploy");

describe("Fork(v3): Pancake V4 mainnet integration", function () {
  const FORK_BLOCK = 83628324n;
  const UNIVERSAL_ROUTER = "0xd9C500DfF816a1Da21A48A732d3498Bf09dc9AEB";
  const PERMIT2 = "0x31c2F6fcFf4F8759b3Bd5Bf0e1084A055615c768";
  const COMMAND_INFI_SWAP = "0x10";
  const ACTION_CL_SWAP_EXACT_IN_SINGLE = "0x06";
  const ACTION_SETTLE_ALL = "0x0c";
  const ACTION_TAKE_ALL = "0x0f";
  const INITIAL_SQRT_PRICE_X96 = 27302121365878665742458286n;
  const LISTING_TICK_LOWER = -191700;
  const LISTING_TICK_UPPER = 887220;
  const PROBE_LIQUIDITY_DELTA = 1000000n;
  const vaultErrors = new ethers.Interface([
    "error AppUnregistered()",
    "error CurrencyNotSettled()",
    "error LockerAlreadySet(address locker)",
    "error SettleNonNativeCurrencyWithValue()",
    "error MustClearExactPositiveDelta()",
    "error NoLocker()",
    "error FeeCurrencySynced()",
  ]);
  const clErrors = new ethers.Interface([
    "error PoolManagerMismatch()",
    "error TickSpacingTooLarge(int24 tickSpacing)",
    "error TickSpacingTooSmall(int24 tickSpacing)",
    "error PoolPaused()",
    "error SwapAmountCannotBeZero()",
  ]);

  function decodeRevertData(data) {
    if (!data || data === "0x") return "empty revert data";
    if (data.startsWith("0x08c379a0")) {
      try {
        const [msg] = ethers.AbiCoder.defaultAbiCoder().decode(["string"], "0x" + data.slice(10));
        return `Error(string): ${msg}`;
      } catch (_) {
        return `Error(string) raw: ${data}`;
      }
    }
    try {
      const e = vaultErrors.parseError(data);
      if (e) return `VaultError: ${e.name}`;
    } catch (_) {}
    try {
      const e = clErrors.parseError(data);
      if (e) return `CLPoolManagerError: ${e.name}`;
    } catch (_) {}
    return `Unknown revert selector: ${data.slice(0, 10)} raw: ${data}`;
  }

  async function deployForkFixture() {
    const fixture = await deployCoreFixture();
    const { owner, pump } = fixture;

    const poolManager = await pump.getPoolManager();
    const vault = await pump.getVault();

    const TipTagSwapHook = await ethers.getContractFactory("TipTagSwapHook");
    const hook = await TipTagSwapHook.deploy(poolManager, vault, pump.target);
    await pump.connect(owner).adminSetHookAddress(hook.target);

    return {
      ...fixture,
      poolManager,
      vault,
      hook,
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

  function computePoolId(key) {
    return ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(address currency0,address currency1,address hooks,address poolManager,uint24 fee,bytes32 parameters)"],
        [key]
      )
    );
  }

  function keyToTuple(key) {
    return [key.currency0, key.currency1, key.hooks, key.poolManager, key.fee, key.parameters];
  }

  async function initializePoolAsTokenOnFork({ token, hook, poolManager }) {
    const hookBitmap = await hook.getHooksRegistrationBitmap();
    const key = buildPoolKey(token.target, hook.target, poolManager, hookBitmap);
    const poolId = computePoolId(key);

    const pm = new ethers.Contract(
      poolManager,
      [
        "function initialize((address currency0,address currency1,address hooks,address poolManager,uint24 fee,bytes32 parameters),uint160) external returns (int24)",
      ],
      token.runner
    );
    const hk = new ethers.Contract(hook.target, ["function registerPool(bytes32,address) external"], token.runner);

    await ethers.provider.send("hardhat_setBalance", [token.target, "0x3635C9ADC5DEA00000"]);
    await ethers.provider.send("hardhat_impersonateAccount", [token.target]);
    const tokenSigner = await ethers.getSigner(token.target);
    await pm.connect(tokenSigner).initialize(keyToTuple(key), INITIAL_SQRT_PRICE_X96);
    await hk.connect(tokenSigner).registerPool(poolId, token.target);
    await ethers.provider.send("hardhat_stopImpersonatingAccount", [token.target]);

    return key;
  }

  function parseProbeDelta(err, probe) {
    const data = err?.data || err?.error?.data || err?.info?.error?.data;
    if (!data || data === "0x") return null;
    try {
      const parsed = probe.interface.parseError(data);
      if (!parsed || parsed.name !== "ProbeDelta") return null;
      return { amount0: parsed.args[0], amount1: parsed.args[1] };
    } catch (_) {
      return null;
    }
  }

  async function createAndListTokenOnFork(fixture) {
    const { creator, pump, vault } = fixture;
    const salt = saltFromNumber(1);
    const createFee = await pump.createFee();
    const { token } = await createTokenByEvent(pump, creator, "FORK", salt, createFee);

    const vaultContract = new ethers.Contract(
      vault,
      [
        "function isAppRegistered(address app) external returns (bool)",
        "function registerApp(address app) external",
        "function owner() external view returns (address)",
      ],
      creator
    );
    try {
      const registered = await vaultContract.isAppRegistered(token.target);
      if (!registered) {
        let registerDone = false;
        try {
          await vaultContract.registerApp(token.target);
          registerDone = true;
        } catch (_) {
          // If creator cannot register app, impersonate vault owner on fork for setup.
          const vaultOwner = await vaultContract.owner();
          await ethers.provider.send("hardhat_setBalance", [vaultOwner, "0x3635C9ADC5DEA00000"]); // 1000 BNB
          await ethers.provider.send("hardhat_impersonateAccount", [vaultOwner]);
          const ownerSigner = await ethers.getSigner(vaultOwner);
          await vaultContract.connect(ownerSigner).registerApp(token.target);
          await ethers.provider.send("hardhat_stopImpersonatingAccount", [vaultOwner]);
          registerDone = true;
        }
        if (!registerDone) {
          throw new Error("vault registerApp failed");
        }
      }
      const afterRegistered = await vaultContract.isAppRegistered(token.target);
      if (!afterRegistered) {
        throw new Error("vault app is still unregistered after setup");
      }
    } catch (_) {
      // Some vault deployments gate registration by permissions.
      // We keep this best-effort and continue to surface real revert reasons from listing path.
    }

    const capAmount = toWei(650000000);
    const needEth = await pump.getBuyPriceAfterFee(0, capAmount);
    try {
      await token.connect(creator).buyToken(0, ethers.ZeroAddress, 0, { value: needEth + 10_000_000_000n });
    } catch (err) {
      const data = err?.data || err?.error?.data || err?.info?.error?.data;
      throw new Error(`listing reverted: ${decodeRevertData(data)}`);
    }
    return token;
  }

  it("should use bsc mainnet fork at expected block and real v4 addresses", async function () {
    const { pump } = await loadFixture(deployForkFixture);
    const blockNum = await ethers.provider.getBlockNumber();
    expect(BigInt(blockNum)).to.be.gte(FORK_BLOCK);

    const poolManager = await pump.getPoolManager();
    const vault = await pump.getVault();
    const pmCode = await ethers.provider.getCode(poolManager);
    const vaultCode = await ethers.provider.getCode(vault);
    expect(pmCode).to.not.equal("0x");
    expect(vaultCode).to.not.equal("0x");
  });

  it("should list token through real pancake v4 contracts on fork", async function () {
    const fixture = await loadFixture(deployForkFixture);
    const token = await createAndListTokenOnFork(fixture);
    expect(await token.listed()).to.equal(true);
    expect(await token.v4PoolId()).to.not.equal(ethers.ZeroHash);
  });

  it("should collect hook fee and increase pending profits on real swap flow", async function () {
    const fixture = await loadFixture(deployForkFixture);
    const { creator, pump, hook, feeReceiver, ipshare, poolManager } = fixture;
    const token = await createAndListTokenOnFork(fixture);

    const hookBitmap = await hook.getHooksRegistrationBitmap();
    const key = buildPoolKey(token.target, hook.target, poolManager, hookBitmap);
    const sellAmount = toWei(10000000);

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

    // Step1: ERC20 approve Permit2.
    await token.connect(creator).approve(PERMIT2, ethers.MaxUint256);
    // Step2: Permit2 approve UniversalRouter.
    await permit2.approve(token.target, UNIVERSAL_ROUTER, (1n << 160n) - 1n, (1n << 48n) - 1n);

    const clSwapExactInSingle = ethers.AbiCoder.defaultAbiCoder().encode(
      ["tuple(tuple(address currency0,address currency1,address hooks,address poolManager,uint24 fee,bytes32 parameters) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData)"],
      [[key, false, BigInt(sellAmount), 0n, "0x"]]
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

    const deadline = BigInt((await ethers.provider.getBlock("latest")).timestamp) + 600n;
    await universalRouter.execute(COMMAND_INFI_SWAP, [infiPayload], deadline);

    const feeAfter = await ethers.provider.getBalance(feeReceiver.address);
    const pendingAfter = await ipshare.getPendingProfits(creator.address, creator.address);
    expect(feeAfter).to.be.gt(feeBefore);
    expect(pendingAfter).to.be.gt(pendingBefore);
  });

  it.skip("should diagnose vault.lock path by step on fork", async function () {
    const fixture = await loadFixture(deployForkFixture);
    const { creator, pump, hook, vault, poolManager } = fixture;

    const salt = saltFromNumber(77);
    const createFee = await pump.createFee();
    const { token } = await createTokenByEvent(pump, creator, "PROBE", salt, createFee);
    const key = await initializePoolAsTokenOnFork({ token, hook, poolManager });

    const Probe = await ethers.getContractFactory("ForkVaultLockProbe");
    const probe = await Probe.deploy(vault, poolManager);

    const vaultCtl = new ethers.Contract(
      vault,
      [
        "function owner() external view returns (address)",
        "function registerApp(address app) external",
        "function isAppRegistered(address app) external returns (bool)",
      ],
      creator
    );
    try {
      const ownerAddr = await vaultCtl.owner();
      await ethers.provider.send("hardhat_setBalance", [ownerAddr, "0x3635C9ADC5DEA00000"]);
      await ethers.provider.send("hardhat_impersonateAccount", [ownerAddr]);
      const ownerSigner = await ethers.getSigner(ownerAddr);
      await vaultCtl.connect(ownerSigner).registerApp(probe.target);
      await vaultCtl.connect(ownerSigner).registerApp(token.target);
      await ethers.provider.send("hardhat_stopImpersonatingAccount", [ownerAddr]);
    } catch (_) {}

    // A: lock handshake should be healthy.
    try {
      await probe.lockNoop();
    } catch (err) {
      const data = err?.data || err?.error?.data || err?.info?.error?.data;
      const txHash = err?.transactionHash || "none";
      let probeMsg = "none";
      try {
        const parsed = probe.interface.parseError(data);
        probeMsg = parsed ? parsed.name : "none";
      } catch (_) {}
      throw new Error(`lockNoop reverted: tx=${txHash} vault=${decodeRevertData(data)} probe=${probeMsg}`);
    }

    // B: isolate modifyLiquidity and extract delta from explicit probe error.
    let deltaFromProbe = null;
    try {
      await probe.lockModifyOnly(keyToTuple(key), LISTING_TICK_LOWER, LISTING_TICK_UPPER, PROBE_LIQUIDITY_DELTA);
    } catch (err) {
      deltaFromProbe = parseProbeDelta(err, probe);
    }
    expect(deltaFromProbe).to.not.equal(null);

    const amount0 = deltaFromProbe.amount0;
    const amount1 = deltaFromProbe.amount1;

    // C: settle path with exact funding (first principles: debt must be fully netted).
    if (amount0 < 0n) {
      await creator.sendTransaction({ to: probe.target, value: -amount0 });
    }
    if (amount1 < 0n) {
      const tokenNeed = (-amount1 * 12n) / 10n + 1000n;
      const supply = await token.bondingCurveSupply();
      const needEth = await pump.getBuyPriceAfterFee(supply, tokenNeed);
      await token.connect(creator).buyToken(0, ethers.ZeroAddress, 0, { value: needEth + 1_000_000_000_000n });
      await token.connect(creator).transfer(probe.target, tokenNeed);
    }

    await expect(probe.lockModifyAndSettle(keyToTuple(key), LISTING_TICK_LOWER, LISTING_TICK_UPPER, PROBE_LIQUIDITY_DELTA)).to.not.be
      .reverted;
  });
});
