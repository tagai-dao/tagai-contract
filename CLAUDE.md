# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Compile contracts
npm run compile

# Run all tests (unit + integration, excludes fork tests)
npx hardhat test

# Run a single test file
npx hardhat test tests/v3/pump.spec.js

# Run fork tests (requires BSC_RPC_URL in .env)
npm run test:fork:v3

# Deploy to BSC mainnet with verification
npm run deploy:bsc

# Deploy without verification
npm run deploy:bsc:no-verify
```

No lint script is configured; `solhint` is installed but not wired into npm scripts.

## Architecture

This is a Hardhat project targeting BSC mainnet. The protocol is called **TagAI** — a fair token launch platform with IP value capture and DEX fee distribution.

### Core Contracts

**`Pump.sol`** — Factory. Deploys `Token` clones via `Clones.sol` (EIP-1167 minimal proxy). Manages creation fees, fee ratios, and addresses for IPShare/Hook/PoolManager/Vault. On `createToken`, it:
1. Optionally auto-creates an IPShare for the creator if one doesn't exist yet.
2. Deploys a Token clone and calls `Token.initialize`.
3. Creates a Nutbox community using the token itself as the community token (non-mintable), with a 3-era `LinearTimeCalculator` distribution policy starting at `block.timestamp + 1`.
4. Transfers `NUTBOX_ALLOCATION` (150M tokens = 15% of total supply) from Pump to the community.
5. Adds a single "Social Curation" pool (100% ratio) via `SocialCurationFactory`.
6. Calls `Token.setNutboxAddresses(community, pool)` to record the addresses.
7. Transfers community ownership to the token creator.

The `createToken` fee must cover: `pump.createFee` + optional IPShare create fee + `committee.getCreateCommunityFee()` + `committee.getCommunitySettingsFee()`.

**`Token.sol`** — Total supply is 1B tokens split as: 650M bonding curve + 200M DEX liquidity + 150M Nutbox allocation. Two phases:
1. **Pre-listing (bonding curve)**: Trades happen directly against the contract. Only EOAs can trade. The 150M Nutbox allocation is minted to `Pump` at `initialize` time; Pump transfers it to the community during `createToken`.
2. **Post-listing (DEX)**: Once the bonding curve cap is hit, the contract calls PancakeSwap V4 (Infinity) to initialize a CL pool and add liquidity. Bonding curve trading is disabled.

**`IPShare.sol`** — Fractional shares for IP creators/KOLs. Supports buy/sell/stake/unstake/redeem. `valueCapture()` routes ETH into stakers proportionally.

**`TipTagSwapHook.sol`** — PancakeSwap V4 CL hook. Intercepts `beforeSwap`/`afterSwap` to collect fees from the ETH side: `feeRatio[0]` → platform `feeReceiver`, `feeRatio[1]` → `IPShare.valueCapture()` for the subject specified in `hookData` (falls back to token creator).

### Key Design Decisions

- `Token` is deployed as a minimal proxy clone of `tokenImplementation` — the implementation is deployed once, clones share its bytecode.
- `Token` uses `ILockCallback` to interact with PancakeSwap V4 Vault during listing (the vault lock pattern).
- Anti-MEV: dynamic buy fee applies within 15 seconds of token creation; fee recipient is forced to `ipshareSubject` during this window regardless of `sellsman` param.
- Trade gate: `Pump.tradeSigner` controls bonding curve access. When non-zero, `buyToken` and `sellToken` require a valid off-chain signature. Signature payload: `keccak256(chainId, tokenAddress, msg.sender, deadline)` — binds to a specific token and expires. `tradeSigner == address(0)` disables the gate (default). Set via `adminSetTradeSigner`.
- `receive()` bypasses the gate (can't pass a signature); when gate is enabled, direct ETH sends will revert due to empty signature.
- `Pump.createToken` requires EOA caller (checked via `tx.origin == msg.sender`).
- Nutbox integration is mandatory — `adminSetNutbox` must be called after deployment; `createToken` reverts with `NutboxNotConfigured` if any of the four Nutbox addresses is zero.
- The Nutbox distribution policy is 3 eras: 30 days at ~12.857 token/s, 90 days at ~6.424 token/s, 240 days at ~3.212 token/s (rates are in wei, encoded as `abi.encodePacked(uint8(3), s1, e1, rate1, ...)`).
- `Token.setNutboxAddresses` is callable only once by Pump; subsequent calls revert with `NutboxAddressesAlreadySet`.

### Deployment

Uses Hardhat Ignition (`ignition/modules/PumpBsc.js`). Deployment order: `IPShare` → `Token` (impl) → `Pump` → `TipTagSwapHook` → `pump.adminSetHookAddress(hook)`. After deployment, call `pump.adminSetNutbox(...)` to wire in Nutbox contracts.

Required `.env` vars: `KEY` (deployer private key), `BSC` or `BSC_RPC_URL`, `BSC_API_KEY` (for verification).

### Tests

Tests live in `tests/v3/`. Fixtures in `tests/v3/fixtures/deploy.js` deploy the full stack with mock Nutbox contracts (`MockNutboxCommittee`, `MockNutboxCalculator`, `MockNutboxCommunityFactory`, `MockSocialCurationFactory`). Fork tests in `tests/fork/v3/` require `ENABLE_FORK=1` and a BSC RPC URL — they hit real PancakeSwap V4 contracts at block `83628324`.

### BSC Mainnet Addresses

```json
{
  "IPShare": "0x95450AaD4Cc195e03BB4791B7f6f04aC6D9BA922",
  "TokenImplementation": "0x679a06AB0970CA68007777b5460bDca240B59cD2",
  "Pump": "0x3E75E2db40E7cc9C7d7869Fc2d97eDAb01724212",
  "TipTagSwapHook": "0xF815dB0fbeafED4C719F65E41dEC9C50fb357896"
}
```

PancakeSwap V4 (Infinity) on BSC: `CLPoolManager = 0xa0FfB9c1CE1Fe56963B0321B32E7A0302114058b`, `Vault = 0x238a358808379702088667322f80aC48bAd5e6c4`.
