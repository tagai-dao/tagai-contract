# v3 Test Documentation

## 1. Document Purpose

This document provides the final description of the current v3 testing system, including:

- Test capabilities: which core business behaviors are verified.
- Test methodology: how validation is performed across local mock and mainnet fork environments.
- Coverage scope: module-level coverage, end-to-end coverage, and fund-flow reconciliation coverage.
- Go-live readiness: current conclusions and risk boundaries from testing.

---

## 2. First-Principles Testing Goals

From a protocol safety perspective, tests are designed to prove three things first:

- **Fund safety**: every fund flow (user, platform, revenue sharing) is explainable, and failures are revert-safe.
- **State-machine correctness**: transitions across `create -> bonding-curve trading -> listing -> DEX trading -> revenue sharing` are strictly controlled.
- **Economic-rule correctness**: fees, revenue sharing, and balance changes match contract formulas, including edge conditions.

---

## 3. Test Architecture Overview

### 3.1 Layered Test Strategy

- **Local v3 layer (mock + unit/integration)**
  - Directory: `tests/v3/**`
  - Goal: cover error branches, permission branches, state branches, and edge branches.
- **Forked mainnet layer (real Pancake V4 dependencies)**
  - Directory: `tests/fork/v3/**`
  - Goal: validate real interaction paths with `Vault/CLPoolManager/Permit2/UniversalRouter`.

### 3.2 Key Environment Constraints

- Fork BSC mainnet at fixed `blockNumber = 83628324`.
- Hardhat network must use `cancun` (on-chain Vault uses `tstore/tload`; mismatch causes `invalid opcode`).
- Toggle test mode via `ENABLE_FORK`:
  - `ENABLE_FORK=0`: run local v3 tests.
  - `ENABLE_FORK=1`: run fork v3 tests.

---

## 4. Implemented Test Capabilities

### 4.1 Token

Covered behaviors:

- Anti-sniping fee window validation (dynamic fee decay during the first 15 seconds after creation).
- Buy/sell logic and fee logic validation before listing.
- Validation that bonding-curve trading is closed after listing (`TokenListed`).
- Failure-path validation for dust limits, IPShare subject validity, and related constraints.
- Validation of listing-threshold trigger logic and `listed/v4PoolId` state updates.

### 4.2 Pump

Covered behaviors:

- Core `createToken` constraints: EOA-only, unique tick, monotonic salt usage, and deterministic address prediction.
- Correctness of creation fee charging and distribution.
- Full validation of key `userClaim` failure branches and success branches.

### 4.3 IPShare

Covered behaviors:

- Lifecycle coverage for create, buy/sell, stake/unstake/redeem.
- `valueCapture` accounting and staker revenue-sharing paths.
- Pause mechanism and common failure branches (insufficient balance, no claimable profits, duplicate unstake, etc.).

### 4.4 TipTagSwapHook

Covered behaviors:

- Permission and authorization validation for `registerPool/beforeInitialize/beforeSwap/afterSwap`.
- Behavior separation between registered and unregistered pools.
- Edge-case validation for small trades and zero-fee branches.

### 4.5 Local Integration (v3 integration)

Covered behaviors:

- LP budget and residual ETH flush behavior during listing.
- Hook fee flow to platform and IPShare revenue-sharing paths.
- Accumulated revenue sharing and asset-conservation range checks after repeated swaps.

---

## 5. Mainnet Fork End-to-End Validation (Core Acceptance)

### 5.1 Test Files

- `tests/fork/v3/pancakeV4.mainnet-fork.spec.js`
- `tests/fork/v3/full-flow.mainnet-fork.spec.js`

### 5.2 Covered End-to-End Flow

`Deploy Pump/IPShare/Hook -> Create Token -> Bonding-curve buy/sell -> Reach cap and list on Pancake V4 -> DEX forward trade (Token->BNB) -> DEX reverse trade (BNB->Token)`

### 5.3 Core Assertion Strategy

- **State assertions (strict equality)**
  - `listed`, `v4PoolId`, pool liquidity, and consistency of predicted creation address.
- **Event assertions (strict parsing)**
  - `Token.Trade`, `TipTagSwapHook.SwapFeeCollected`.
- **Fund-flow assertions (exact or tight tolerance)**
  - Platform fees are reconciled exactly with event amounts.
  - `pendingProfits` is derived step-by-step from the `IPShare` formula with wei-level tight tolerance.

> Note: the listing-triggered `_makeLiquidityPool` path may include tiny real V4 settlement residuals. They are handled as controlled micro-residuals, not by relaxing assertions into directional checks.

---

## 6. Test Method and Commands

### 6.1 Run Local v3 Tests

```bash
ENABLE_FORK=0 npx hardhat test tests/v3/tiptagSwapHook.spec.js tests/v3/ipshare.spec.js tests/v3/token.spec.js tests/v3/integration/hook-fee-flow.spec.js tests/v3/pump.spec.js
```

### 6.2 Run Fork Mainnet Tests

```bash
ENABLE_FORK=1 BSC_RPC_URL="<your_rpc>" npx hardhat test tests/fork/v3/pancakeV4.mainnet-fork.spec.js tests/fork/v3/full-flow.mainnet-fork.spec.js
```

### 6.3 Pass Criteria

- All main-flow test cases must pass.
- Directional assertions (`gt/lt`) are not allowed for critical fund flows; assertions must be backed by formulas or event amounts.
- If any `it.skip` exists, its purpose (diagnostic/non-main-flow) and non-blocking scope must be explicitly documented.

---

## 7. Coverage Boundaries and Known Limitations

- Fork tests depend on fixed block state and RPC quality (insufficient archive capability may cause `missing trie node`).
- Real DEX interactions include on-chain integer rounding and settlement residuals; use explainable micro-tolerance, not loose assertions.
- One diagnostic `it.skip` is currently retained (for historical rollback troubleshooting) and does not block main-flow acceptance.

---

## 8. Deployment Recommendation (Based on Current Results)

Conclusion: the project is ready for deployment preparation. A phased rollout is recommended instead of an immediate full rollout.

Minimum pre-launch checklist:

- Verify production address configuration: `Vault/CLPoolManager/Permit2/UniversalRouter/Hook`.
- Verify deployment/runtime environment supports `cancun`.
- Run full fork acceptance cases before small-traffic canary rollout.
- Monitor `SwapFeeCollected`, `feeReceiver`, `pendingProfits`, and `pool liquidity` after launch.
