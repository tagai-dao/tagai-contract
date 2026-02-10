# TagAI Protocol Documentation

## 1. Protocol Overview

TagAI establishes a multi-layered ecosystem designed to capture and monetize individual reputation (IP) through a combination of bonding curves, fair launch mechanisms, and gamified incentives.

The system is built on first principles of value creation and liquidity:
1.  **Value Layer (`IPShare.sol`)**: Tokenizes the reputation of a subject (creator/KOL) using a high-volatility curve.
2.  **Liquidity Layer (`Pump.sol`, `Token.sol`)**: Provides an instant, fair launchpad for creator tokens using a smoother bonding curve that eventually graduates to a decentralized exchange (Uniswap V2).
3.  **Gamification Layer (`Donut.sol`)**: specific game mechanics (FOMO3D style) that drive external capital into the Value Layer, creating a sustainable economic flywheel.

---

## 2. Core Modules

### 2.1. Value Layer: `IPShare.sol`

**Concept**:
IPShare represents the "stock" of a person's influence. Unlike standard ERC20 tokens, these shares are minted and burned directly via a bonding curve, ensuring continuous liquidity without a counterparty.

**First Principles Design**:
-   **Cubic Bonding Curve**: The price follows a cubic function ($y = x^3$). This aggressive curve design means that as supply increases, the price rises sharply. This incentivizes early adoption and high conviction, effectively filtering for true believers who are willing to hold through volatility.
-   **Intrinsic Value Capture**: The system is designed so that external activities (like the `Donut` game) automatically buy back these shares, physically injecting value into the curve.

**Key Mechanics**:
-   **Creation**: A subject (creator) initializes their IPShare. The first 10 shares are minted to the creator to ensure "skin in the game".
-   **Trading**:
    -   `buyShares`: Users send ETH to mint shares. Price increases deterministically.
    -   `sellShares`: Users burn shares to receive ETH. Price decreases.
-   **Staking & Dividends**:
    -   Holders can `stake` their shares to earn protocol dividends.
    -   **Max-Heap Management**: The contract maintains a Max-Heap data structure to efficiently track top stakers, ensuring the system remains scalable even with many participants.
    -   **Value Capture**: The `valueCapture` function allows external contracts (like `Donut` or `Pump`) to distribute rewards to stakers by buying back shares and distributing them (or their underlying value).

---

### 2.2. Liquidity Layer: `Pump.sol` & `Token.sol`

**Concept**:
While `IPShare` captures long-term reputation value, `Pump` and `Token` provide a mechanism for **Fair Launch** and **Instant Trading** of standard ERC20 assets associated with that reputation.

**First Principles Design**:
-   **Exponential Bonding Curve**: Unlike the aggressive cubic curve of IPShare, the Token launch uses a smoother Exponential Bonding Curve ($y = a \cdot e^{x/b}$). This allows for a more gradual price discovery phase, suitable for wider community distribution before hitting the open market.
-   **Graduation Mechanism**: The bonding curve is not the end state. Once a funding target is met (the curve is "completed"), the liquidity is automatically migrated to Uniswap V2. This eliminates the "rug pull" risk common in manual liquidity provisioning.

**Key Mechanics**:
-   **Asset Creation (`Pump.sol`)**:
    -   Acts as a Factory. When `createToken` is called, it deploys a new `Token.sol` contract.
    -   Requires the creator to have an existing `IPShare`, linking the asset back to the reputation layer.
-   **Trading (`Token.sol` delegating to `Pump.sol`)**:
    -   The `Pump` contract calculates the pricing logic (`getBuyPrice`, `getSellPrice`) based on the exponential formula.
    -   The `Token` contract handles the actual ERC20 transfers and state checks.
-   **Social Distribution**:
    -   The protocol implements a time-based reward system (`claimPendingSocialRewards`). A portion of the token supply is reserved and released linearly over time (similar to a Universal Basic Income for the ecosystem), encouraging long-term engagement.
-   **Liquidity Migration (`_makeLiquidityPool`)**:
    -   Once the bonding curve creates enough ETH reserves, the contract calls the Uniswap V2 Factory to create a pair, adds the liquidity, and burns the LP tokens (sending them to the dead address), permanently locking the liquidity.

---

### 2.3. Gamification Layer: `Donut.sol`

**Concept**:
`Donut` acts as the **economic engine** or "Flywheel" of the system. It is a "Key Game" (similar to FOMO3D) where participants compete for a jackpot, but with a twist: their participation fees directly pump the value of `IPShare`.

**First Principles Design**:
-   **Aligned Incentives**: In traditional lotteries, ticket sales profit the organizer. In Donut, 97% of the "donation" (ticket price) is used to **buy** the `IPShare` of a specific subject. This means playing the game directly supports the creator and increases the value of the underlying asset (`IPShare`) held by stakeholders.
-   **Fear of Missing Out (FOMO)**: The game has a countdown timer. Every donation extends the timer. The last person to donate before the timer hits zero wins a significant portion of the prize pool. This psychological mechanism drives continuous volume.

**Key Mechanics**:
-   **The Round**:
    -   Starts with a countdown (`INIT_ROUND_ERA`).
    -   Donating ETH extends the countdown (up to a hard cap) and registers the user as the potential winner.
    -   The last 6 participants share the pot if the timer expires.
-   **Value Routing**:
    -   **97%** of the ETH buys `IPShare` for the specified subject (Buy Pressure).
    -   **3%** goes to the Pot (Jackpot).
-   **Winning**:
    -   Distributed to the last 6 depositors.
    -   A portion of the pot carries over to the next round to ensure the game continues.

---

## 3. Economic Flow Summary

1.  **Creator** establishes their reputation anchor via **IPShare**.
2.  **Creator** launches a **Token** on **Pump**.
    -   Community trades the Token on the exponential curve.
    -   Trading fees from Pump flow back to the protocol and the IPShare stakers.
    -   Once mature, the Token graduates to Uniswap.
3.  **Users** play **Donut** to win the jackpot.
    -   To play, they must "donate" to a specific Creator (Subject).
    -   The donation buys the Creator's **IPShare**, pushing its price up (Cubic Curve).
    -   **IPShare Stakers** profit from this buy pressure and the resulting dividends.

This creates a closed loop where speculation (Token/Donut) creates fundamental value for the long-term holders (IPShare Stakers).

---

## 4. Contract Addresses (Testnet)

```javascript
IPShare:        0x7B0ddC305C32AAEbabc0FE372a4460e9903e95D0
Pump:           0xa77253Ac630502A35A6FcD210A01f613D33ba7cD
TagAIPoints:    0x661fC0a052d2A73da9E09a5C67AE6b9c1B5Eb352
TagAIPoints2:   0x013f02c21cEDf1c846044B30Cabe289ef4DaFD18
```
