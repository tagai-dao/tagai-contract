# bsc-v3 Update Notes (Compared with `bsc-v2`)

## 1. Background

The core objective of `bsc-v3` is to upgrade the protocol from a "local bonding-curve + legacy DEX model" to a full flow that runs on real BSC mainnet infrastructure. The main priorities are:

- More standardized trading and listing workflows.
- Clearer fee distribution paths.
- Stricter security constraints and state-machine control.
- Testing upgraded from local simulation to mainnet-fork integration validation.

---

## 2. Core Upgrade Overview

Compared with `bsc-v2`, this release introduces four major changes:

1. **DEX Infrastructure Upgrade**
   - Upgraded from legacy `Uniswap V2`-related dependencies to `Pancake V4 (Infinity)` integration.
   - Added `TipTagSwapHook.sol` to route swap fees to platform and IP revenue-sharing layers according to protocol rules.

2. **Token Listing Logic Refactor**
   - Added the `listed` state machine in `Token.sol` to clearly separate bonding-curve and DEX phases.
   - Automatically executes `_makeLiquidityPool` once listing conditions are met.

3. **Stronger Pump/Token Security and Predictability**
   - `Pump.createToken` enforces stricter constraints (e.g., EOA-only, salt management, deterministic address prediction).
   - `Token` adds an anti-sniping fee window (dynamic fee decay) and post-listing behavior constraints.

4. **Test System Upgraded for Pre-Deployment Validation**
   - Added structured `tests/v3` coverage (module + integration).
   - Added `tests/fork/v3` to validate real contract interactions under BSC mainnet fork.

---

## 3. Major Contract-Level Changes

## 3.1 `Pump.sol`

Key improvements:

- Serves as the factory layer to manage critical protocol addresses (`PoolManager`, `Vault`, `Hook`, etc.).
- `createToken(string tick, bytes32 salt)` provides a clearer creation interface and deterministic prediction support via `predictTokenAddress`.
- Social distribution flows are reorganized: `claimPendingSocialRewards`, `userClaim`, and signature/order validation are more complete.

Value:

- More controllable token creation flow with predictable addresses.
- Better support for frontend and risk-control pre-checks.
- Lower risk of duplicate creation and address collisions.

## 3.2 `Token.sol`

Key improvements:

- Introduces `listed` state to define phase transition boundaries.
- Introduces a 15-second anti-sniping dynamic fee window to reduce extreme early frontrunning impact.
- Implements automated listing via `_makeLiquidityPool`, and integrates V4 settlement through `lockAcquired`.
- Restricts further bonding-curve trading after listing to avoid dual-market pricing confusion.

Value:

- Clearer phase boundaries.
- More explainable fund-flow paths.
- Automated listing behavior with lower manual-operation risk.

## 3.3 `IPShare.sol`

Key improvements (continued and strengthened):

- Continues to serve as the IP value and revenue-sharing layer (buy/sell, staking, profit distribution, redeem).
- Fee-flow coordination with `Pump` / `Hook` is clearer, and `valueCapture` has a more stable role in the full economic loop.

Value:

- Converts external trading activity into IP-layer value capture.
- Supports long-term incentives rather than only short-term trading.

## 3.4 `TipTagSwapHook.sol` (New)

Core functions:

- Integrates with Pancake V4 hook lifecycle (`beforeInitialize` / `beforeSwap` / `afterSwap`).
- Maintains `pool -> token` registration mapping.
- Splits and routes swap fees by configured ratios (platform + IPShare revenue sharing).

Value:

- Brings DEX-layer trading fees into protocol-internal revenue sharing.
- Directly couples trading activity with IP value capture.

---

## 4. Architecture Cleanup and Dependency Alignment

Compared with `bsc-v2`, this release streamlines project structure:

- Removed a set of legacy/non-primary-path files (including parts of `UniswapV2`-related implementations and old test scripts).
- Added and standardized `v3` test directories and fork test directories.
- Realigned interfaces and scripts around the current primary flow (`Pump/Token/IPShare/Hook + V4`).

The goal is to reduce mixing between historical and current paths, and improve maintainability and readability.

---

## 5. Improvements in Testing and Validation Capability

The testing upgrade in this release is not just "more test cases"; it is a validation-layer upgrade:

- **Module-level validation**: permissions, failure paths, state transitions, and boundary conditions.
- **Integration-level validation**: listing thresholds, fee flows, accumulated revenue sharing, and asset consistency.
- **Mainnet-fork validation**: real interactions with `Vault / CLPoolManager / Permit2 / UniversalRouter`.
- **Full-flow validation**: complete loop from "create -> bonding-curve trading -> listing -> bidirectional DEX trading -> fee distribution".

This significantly increases pre-deployment confidence for `bsc-v3` compared with `bsc-v2`.

---

## 6. Compatibility and Migration Notes

- When running fork tests, ensure local EVM capability matches on-chain dependencies (e.g., `cancun`).
- Business flow has migrated from legacy DEX dependencies to the V4 path; deployment parameters must use the corresponding real addresses.
- Recommended rollout strategy is "canary rollout -> monitoring confirmation -> gradual scale-up", instead of an immediate full cutover.

---