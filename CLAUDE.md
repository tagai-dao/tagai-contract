# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Compile contracts
yarn compile

# Run all unit tests
yarn test

# Run a single test file
npx hardhat test tests/v3/ipshare.spec.js

# Run fork tests (requires BSC_RPC_URL env var)
ENABLE_FORK=1 BSC_RPC_URL=<url> yarn test:fork:v3

# Deploy to BSC mainnet
yarn deploy        # via scripts/deploy.js (env-var driven)
yarn deploy:bsc    # via Hardhat Ignition with verification

# Deploy to BSC testnet
yarn deploy-chapel
```

Required env vars: `KEY` (deployer private key), `BSC` or `BSC_RPC_URL`, `BSC_API_KEY`.

## Architecture Overview

This is a meme token launchpad ("pump.fun style") deployed on BSC that integrates with PancakeSwap V4 (Infinity). There are four core contracts:

### Core Contracts

**`Pump.sol`** — Factory and bonding curve math
- Deploys tokens via `Clones.cloneDeterministic` (CREATE2 minimal proxy pattern)
- Computes exponential bonding curve prices using Solady's `FixedPointMathLib` (`expWad`, `lnWad`, `mulWad`)
- Manages social distribution rewards (12.87 tokens/second per token, claimed via ECDSA-signed `userClaim`)
- Admin: controls hook address, fee ratios, pool manager/vault addresses, claim signer

**`Token.sol`** — Individual meme token (deployed as clone)
- **Phase 1 (bonding curve):** 650M tokens available; fees split between platform and IPShare via `valueCapture()`
- Anti-snipe: first 15 seconds, `sellsmanFee` decays quadratically from 80% to normal; fee recipient locked to creator
- **Phase 2 (DEX listing):** triggered when bonding curve fills; auto-creates a PancakeSwap V4 CL pool with 19 ETH + 200M tokens, registers with `TipTagSwapHook`
- Supply: 650M (bonding curve) + 200M (LP) + 150M (social rewards minted to Pump)

**`IPShare.sol`** — KOL share bonding curve and staking
- Each creator (KOL/subject) has shares on a cubic bonding curve
- `valueCapture(subject)` receives ETH and buys back shares on behalf of all stakers — this is how fees flow from Token and TipTagSwapHook into IPShare
- Stakers lock shares for 7 days, then can redeem/claim ETH rewards pro-rata
- Uses a max-heap to track top staker per subject

**`TipTagSwapHook.sol`** — PancakeSwap V4 CL hook
- Intercepts every swap (`beforeSwap` + `afterSwap`) to take fees
- Fee routing: `feeRatio[0]` → platform `feeReceiver`, `feeRatio[1]` → `IPShare.valueCapture(subject)`
- Subject resolved from `hookData` (passed by caller) or defaults to token creator
- Only pools registered by Pump-created tokens can use this hook (`beforeInitialize` guard)

### Contract Interaction Flow

```
User → Pump.createToken() → deploys Token clone (CREATE2)
                          → auto-creates IPShare for creator

User → Token.buyToken()   → exponential bonding curve price
                          → fees: platform + IPShare.valueCapture()
                          → when cap hit: _makeLiquidityPool()
                               → CLPoolManager (PCS V4 pool creation)
                               → TipTagSwapHook.registerPool()

User → UniversalRouter → CLPoolManager → TipTagSwapHook
                                       → platform fee + IPShare.valueCapture()
```

### Deployment System

Two methods exist:
1. **`scripts/deploy.js`** — env-var driven, supports `EXISTING_IPSHARE`, `DEPLOY_HOOK`, `VERIFY`, etc.
2. **`ignition/modules/PumpBsc.js`** — declarative Hardhat Ignition; parameters in `ignition/parameters/bsc.json` (copy from `bsc.example.json`)

Deploy order: `IPShare` → `Token` (impl) → `Pump` → `TipTagSwapHook` → wire hook into Pump via `adminSetHookAddress`.

Ownership uses `Ownable2Step` — after `transferOwnership`, the new owner must call `acceptOwnership()`.

### BSC Mainnet Deployed Addresses

| Contract | Address |
|---|---|
| IPShare | `0x95450AaD4Cc195e03BB4791B7f6f04aC6D9BA922` |
| Token (impl) | `0x679a06AB0970CA68007777b5460bDca240B59cD2` |
| Pump | `0x3E75E2db40E7cc9C7d7869Fc2d97eDAb01724212` |
| TipTagSwapHook | `0xF815dB0fbeafED4C719F65E41dEC9C50fb357896` |
| CLPoolManager (PCS V4) | `0xa0FfB9c1CE1Fe56963B0321B32E7A0302114058b` |
| Vault (PCS V4) | `0x238a358808379702088667322f80aC48bAd5e6c4` |

### Tests

- **Unit tests:** `tests/v3/` — uses `tests/v3/fixtures/deploy.js` shared fixture (`deployCoreFixture()`, `createTokenByEvent()`)
- **Fork tests:** `tests/fork/v3/` — require `ENABLE_FORK=1` + `BSC_RPC_URL`, pinned to block `83628324`
- Mock contracts in `contracts/mocks/` for lightweight hook unit testing

### Key Technical Details

- Solidity `0.8.26` with `viaIR: true`, `evmVersion: cancun`, optimizer 1000 runs
- PCS V4 pool listing constants: `LISTING_TICK_LOWER = -191700`, `LISTING_TICK_UPPER = 887220`, `LISTING_LIQUIDITY_DELTA = 6547423157242855`
- Ethers v6 is used in tests (use `ethers.parseEther()` not `ethers.utils.parseEther()`)
- `infinity-core` package = PancakeSwap V4 core (from `github:pancakeswap/pancake-v4-core`)
- Solady library is vendored in `contracts/solady/`

## gstack

Use the `/browse` skill from gstack for all web browsing. Never use `mcp__claude-in-chrome__*` tools directly.

Available gstack skills:
`/office-hours`, `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`, `/design-consultation`, `/review`, `/ship`, `/browse`, `/qa`, `/qa-only`, `/design-review`, `/setup-browser-cookies`, `/retro`, `/investigate`, `/document-release`, `/codex`, `/careful`, `/freeze`, `/guard`, `/unfreeze`, `/gstack-upgrade`
