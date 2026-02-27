# TagAI Protocol

## Contract Overview

This repository focuses on three core capabilities:
IP value capture, fair token launch, and DEX fee distribution.

### `IPShare.sol`
- Creates IP shares for a subject (creator/KOL).
- Supports buy, sell, stake, unstake, and redeem flows.
- Uses `valueCapture` to route external value into stakers.

### `Pump.sol`
- Factory contract that deploys new `Token` contracts.
- Manages creation fees, protocol fee parameters, and key addresses (Hook/PoolManager/Vault).
- Exposes claim-related entry points for social distribution.

### `Token.sol`
- Implements bonding-curve trading in the pre-listing phase.
- Switches to DEX liquidity mode once listing conditions are met (`listed` state).
- Disables bonding-curve trading after listing to avoid dual-market behavior.

### `TipTagSwapHook.sol`
- Integrates with Pancake V4 hook callbacks.
- Collects and distributes swap fees (platform share + IPShare value capture).
- Maintains pool-to-token registration for fee routing.

### `Donut.sol` (optional)
- Gamified incentive module for additional capital flow.
- Can route part of value flow into the IP value layer.

---

## Contract Addresses (BSC Mainnet)

```text
IPShare: 0x24328DccA1bA54EeE82e2993F021802e64290486
Pump:    0x0476571a77Cc8Fc28796935Cf173c265F2021448
```
