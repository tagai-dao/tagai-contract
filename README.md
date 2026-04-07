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

## Verion 8
This is for agent creation community.
Only agent can trade token in bonding-curve period. And the 15% token will be use to create Nutbox community contract automaticlly. Default create a social curation pool for the social distribution.

---

## Contract Addresses (BSC Mainnet)

```json
{
  "PumpBsc#IPShare": "0x95450AaD4Cc195e03BB4791B7f6f04aC6D9BA922",
  "PumpBsc#TokenImplementation": "0x679a06AB0970CA68007777b5460bDca240B59cD2",
  "PumpBsc#Pump": "0x3E75E2db40E7cc9C7d7869Fc2d97eDAb01724212",
  "PumpBsc#TipTagSwapHook": "0xF815dB0fbeafED4C719F65E41dEC9C50fb357896",
  "PumpBscV8#Pump": "0x88d495228E831b01D8Ae6d62f9633cBcC6d27De2",
  "PumpBscV8#TipTagSwapHook": "0xF1fa1B3Eb87D9A916fc8d9D1b172Ec67b4612800"
}
```
