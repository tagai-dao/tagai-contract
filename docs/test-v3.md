# v3 测试文档（现状 + 补充案例）

## 1. 文档目标与测试第一性原理

本文件用于回答两个问题：

1. 当前 v3 自动化测试已经证明了什么。
2. 基于合约真实逻辑，还需要补哪些关键测试。

从第一性原理看，测试要优先保障三件事：

- 资金安全：任何资金转移都必须可解释、可追踪、可回滚（失败即 revert）。
- 状态机正确性：`创建 -> 交易 -> 上市 -> 分润/Claim` 的阶段切换不能乱序或越权。
- 经济分配正确性：手续费、分润、奖励分配与公式一致，且在边界条件不失真。

---

## 1.1 当前落地状态（本轮已同步）

说明：以下状态以当前仓库测试文件为准。

- 已落地（新增）：`tests/v3/token.spec.js`、`tests/v3/pump.spec.js`、`tests/v3/ipshare.spec.js`、`tests/v3/tiptagSwapHook.spec.js`、`tests/v3/integration/hook-fee-flow.spec.js`。
- 已新增辅助合约：`contracts/mocks/PumpCaller.sol`（仅用于 `Only EOA` 测试触发）。
- 回归结果：新增用例在本地均已通过（定向执行通过）。

按优先级落地进度：

- `P0`：已完成（含 Token listed 状态机、Pump create/claim 关键失败分支、IPShare 权限与失败路径、Hook 授权与未注册池行为）。
- `P1`：已完成（Hook 极小金额边界、Pump userClaim 成功路径、IPShare valueCapture(0)）。
- `P2`：已完成（“上市临界切换”“多次 swap 累计分润增长”“资产守恒区间定量校验”均已落地）。

---

## 2. 当前测试覆盖矩阵（按模块）

### 2.1 Token（`tests/v3/token.spec.js`）

已覆盖：

- 首次买入使用 `Pump.getFeeRatio()` 静态费率，并校验 `Trade` 事件中的 `tiptagFee/sellsmanFee`。
- 首次买入后，15 秒防狙击窗口内 `getBuyFeeRatios()` 的二次衰减逻辑（`createdAt+2/+14/+16`）正确。
- 未上市时卖出仍走静态卖出费率，且与 `Pump.getPrice` 推导一致。

当前缺口：

- `buyToken/sellToken` 的 revert 分支基本未覆盖（`TokenListed`、`IPShareNotCreated`、`DustIssue`、`OutOfSlippage`）。
- `_buyTokenFillToCap`（顶格买入触发上市）仅在集成测试弱验证，缺少单测级精确断言。
- `receive()` 自动买入路径未覆盖。
- 上市前 `_beforeTokenTransfer` 防护（禁止第三方转入 Vault）未覆盖。

### 2.2 Pump（`tests/v3/pump.spec.js`）

已覆盖：

- 创建时总费用不足（`createFee + ipshareCreateFee`）触发 `InsufficientCreateFee`。
- 自动创建 IPShare 时，`ipshare create fee` 与 `pump create fee` 分账正确。

当前缺口：

- `createToken` 核心约束未覆盖：`Only EOA`、`TickHasBeenCreated`、`SaltNotAvailable`。
- 预铸买入失败路径 `PreMineTokenFail` 未覆盖。
- `predictTokenAddress` 与实际地址一致性未覆盖。
- `userClaim` 的签名、重复订单、费用不足、token 未创建等分支覆盖不足。

### 2.3 IPShare（`tests/v3/ipshare.spec.js`）

已覆盖：

- `createShare` 初始化时自动 stake 10 份，`supply/balance/stakerInfo` 一致。
- `createFee` 不足 revert、超额退款、fee destination 入账。
- `startTrade` 前买卖被禁止（`PendingTradeNow`）。
- 卖出保底 10 份限制（`CanntSellLast10Shares`）。
- stake/unstake/redeem 基础生命周期与 7 天锁定期。
- `valueCapture` 后按 stake 比例产生可领取收益，`claim` 后余额增加。
- max staker 随质押变化更新。
- `buyShares` 事件参数、供给变化、手续费去向、买入滑点保护。

当前缺口：

- `createShare` EOA 限制（合约地址 subject）未覆盖。
- `IPShareAlreadyCreated`、`pause/unpause`、`NoFunds`、`InsufficientShares`、`NoProfitToClaim` 等失败分支覆盖不足。
- `unstake` 重复发起（`InUnstakingPeriodNow`）和 `redeem` 无可赎回（`NoIPShareToRedeem`）未覆盖。

### 2.4 TipTagSwapHook（`tests/v3/tiptagSwapHook.spec.js`）

已覆盖：

- `registerPool` 只允许由 Pump 创建的 token 注册。
- `beforeSwap` 仅 poolManager 可调用（`NotPoolManager`）。
- `beforeSwap/afterSwap` 两条收费路径均验证了手续费归集与分发。
- `feeRatio == 0` 时跳过收费。

当前缺口：

- `beforeInitialize` 鉴权分支未覆盖（`Unauthorized`）。
- 未注册 pool 时 before/after swap 的“零行为”分支未覆盖。
- `unspecifiedAmount == 0`、`totalFee == 0` 更细边界分支缺少断言。
- `poolToken` 绑定正确性（同池多 token 混淆防护）可增加回归用例。

### 2.5 Integration（`tests/v3/integration/hook-fee-flow.spec.js`）

已覆盖：

- 上市时固定 LP 预算、余量 ETH flush 到 feeReceiver。
- Hook 手续费可进入 `IPShare.valueCapture` 并被 staker 领取。
- 满流通量（800M）卖出路径可回收大量 ETH，且 feeReceiver 与 pendingProfits 增长。

当前缺口：

- 上市边界（临界前一笔、临界后一笔）断言还不够细。
- 资产守恒（token/ETH/费用）仅做了方向性断言，缺少“区间 + 误差”检查。
- 长序列多次 swap 的累计分润一致性可增强。

---

## 3. 新增测试案例池（按优先级）

说明：每条都包含“目的 / 前置条件 / 步骤 / 关键断言 / 风险点”，可直接映射为 `it("...")`。

## 3.1 P0（必须先补）

### A. Token 模块

1) `listed` 后禁止曲线买入

- 目的：避免上市后仍走曲线，破坏单一流动性来源。
- 前置条件：把 token 顶到 cap，触发 `listed=true`。
- 步骤：调用 `buyToken(...)`。
- 关键断言：revert `TokenListed`。
- 风险点：状态机串线，出现双市场定价。

2) `listed` 后禁止曲线卖出

- 目的：与买入同理，保证上市后只走 DEX。
- 前置条件：同上。
- 步骤：调用 `sellToken(...)`。
- 关键断言：revert `TokenListed`。
- 风险点：套利窗口与资金池错配。

3) `sellsman` 非零且未创建 IPShare 时买卖都应失败

- 目的：保障 `valueCapture` 的目标主体合法。
- 前置条件：传入一个未 `ipshareCreated` 地址为 `sellsman`。
- 步骤：分别调用 `buyToken/sellToken`。
- 关键断言：revert `IPShareNotCreated`。
- 风险点：手续费黑洞或错误归属。

4) Dust 下限保护

- 目的：避免过小交易触发精度/手续费异常。
- 前置条件：构造使 `sellsmanFee < 1e8` 的输入。
- 步骤：调用 `buyToken` 与 `sellToken`（小额）。
- 关键断言：revert `DustIssue`。
- 风险点：小额交易污染账本，诱发经济攻击面。

5) 顶格买入触发 `_buyTokenFillToCap` 的退款与上市

- 目的：确保临界路径不会吞资金、不会少上币。
- 前置条件：接近 cap，准备 `msg.value > usedEth`。
- 步骤：执行最后一笔 buy。
- 关键断言：`listed=true`、用户收到退款、`Trade.ethAmount == usedEth`、触发 `TokenListedToDex`。
- 风险点：临界路径最容易出现资金错账。

6) 上市前禁止外部地址把 token 转入 Vault

- 目的：验证 `_beforeTokenTransfer` 防护。
- 前置条件：token 未上市，普通账户持有 token。
- 步骤：`transfer(vault, amount)`。
- 关键断言：revert `TokenNotListed`。
- 风险点：提前污染结算资产。

### B. Pump 模块

7) 仅 EOA 可创建 token

- 目的：验证 `msg.sender == tx.origin` 防 phishing 约束。
- 前置条件：通过测试合约代理调用 `createToken`。
- 步骤：合约中转调用。
- 关键断言：revert `"Only EOA"`。
- 风险点：被中间合约打包诱导创建。

8) 重复 `tick` 创建应失败

- 目的：保证 ticker 唯一性。
- 前置条件：先创建一个 `tick`。
- 步骤：再次创建相同 `tick`。
- 关键断言：revert `TickHasBeenCreated`。
- 风险点：品牌/路由歧义。

9) `salt` 回退或重复应失败

- 目的：保证每用户地址空间单调递增。
- 前置条件：先用 `salt=n` 创建成功。
- 步骤：再用 `salt<=n` 创建。
- 关键断言：revert `SaltNotAvailable`。
- 风险点：可预测地址被复用、部署序冲突。

10) `predictTokenAddress` 与实际部署地址一致

- 目的：保证地址预计算可用于前端/风控。
- 前置条件：给定 deployer + salt。
- 步骤：先 predict，再 create。
- 关键断言：`predicted == emitted token address`。
- 风险点：链下签名与链上地址不一致。

11) `userClaim` 关键失败分支

- 目的：防伪签、防重复、防费用绕过。
- 前置条件：已 listed token。
- 步骤：构造错误签名、重复 orderId、claimFee 不足、未创建 token。
- 关键断言：分别 revert `InvalidSignature/ClaimOrderExist/CostFeeFail/TokenNotCreated`。
- 风险点：社发代币被盗领。

### C. IPShare 模块

12) `createShare` subject 非 EOA 时拒绝

- 目的：验证 EIP-7702 兼容 EOA 限制实现。
- 前置条件：部署一个普通合约地址作为 subject。
- 步骤：`createShare(subjectContract)`。
- 关键断言：revert `"Subject must be EOA"`。
- 风险点：把 subject 指向不可预期合约账户。

13) 重复创建同一 subject 应失败

- 目的：保证每个 subject 仅有一条 share 曲线。
- 前置条件：已 `createShare(subject)`。
- 步骤：再次 `createShare(subject)`。
- 关键断言：revert `IPShareAlreadyCreated`。
- 风险点：供给与权益拆分。

14) pause/unpause 全链路防护

- 目的：验证紧急刹车有效。
- 前置条件：owner 调用 `pause()`。
- 步骤：尝试 `createShare/buyShares/sellShares/stake/unstake/valueCapture`。
- 关键断言：均因 paused 失败；`unpause()` 后恢复。
- 风险点：紧急状态仍可出金或改状态。

15) `sellShares` 余额不足应直接失败（不再静默截断）

- 目的：验证修复点有效。
- 前置条件：持仓小于卖出量。
- 步骤：`sellShares(shareAmount > balance)`。
- 关键断言：revert `InsufficientShares`。
- 风险点：用户误判成交量，账本不一致。

16) `claim` 在无收益时失败

- 目的：防止空 claim 污染状态。
- 前置条件：staker 存在但无 `pendingProfits`。
- 步骤：`claim(subject)`。
- 关键断言：revert `NoProfitToClaim`。
- 风险点：重复 claim 造成不必要 gas 与潜在状态异常。

17) `unstake` 重复发起应失败

- 目的：保证一次仅一个赎回窗口。
- 前置条件：已 `unstake` 一次且未 `redeem`。
- 步骤：再次 `unstake`。
- 关键断言：revert `InUnstakingPeriodNow`。
- 风险点：锁仓状态被覆盖。

18) `redeem` 无可赎回份额应失败

- 目的：保障赎回前置条件。
- 前置条件：未发起 `unstake`。
- 步骤：`redeem(subject)`。
- 关键断言：revert `NoIPShareToRedeem`。
- 风险点：空操作误导前端状态。

### D. Hook 模块

19) `beforeInitialize` 只允许已创建 token

- 目的：防止任意 sender 借 hook 创建池。
- 前置条件：构造 `sender` 为非 Pump 创建 token。
- 步骤：poolManager 调 `beforeInitialize`。
- 关键断言：revert `Unauthorized`。
- 风险点：恶意池注册，费用分发错配。

20) 未注册 pool 时 before/afterSwap 不收费

- 目的：验证 `poolToken[poolId]==0` 分支。
- 前置条件：不调用 `registerPool`。
- 步骤：触发 beforeSwap 与 afterSwap。
- 关键断言：返回 zero delta，`feeReceiver/totalCaptured` 不变。
- 风险点：对未知池错误扣费。

## 3.2 P1（建议补）

21) Hook `unspecifiedAmount == 0` 时不收费

- 目的：覆盖 afterSwap 中零金额快速返回。
- 前置条件：构造 delta.amount0 = 0。
- 步骤：调用 `afterSwap`。
- 关键断言：`SwapFeeCollected` 不触发，返回 fee=0。
- 风险点：零成交也扣费。

22) Hook `totalFee == 0` 的极小交易边界

- 目的：覆盖整数截断为 0 的分支。
- 前置条件：feeRatio 非 0，但 `specifiedAmount` 很小。
- 步骤：调用 `beforeSwap/afterSwap`。
- 关键断言：不触发收费分发。
- 风险点：尘埃交易行为与预期不一致。

23) Token `receive()` 自动买入路径

- 目的：覆盖 fallback 入口。
- 前置条件：token 未上市。
- 步骤：直接向 token 转 ETH（无 calldata）。
- 关键断言：触发买入，`bondingCurveSupply` 增加，事件参数正确。
- 风险点：入口分叉导致主路径与 fallback 行为不一致。

24) Pump `userClaim` 成功路径下状态完整性

- 目的：补全正向断言。
- 前置条件：有效签名 + 足够 pending 奖励。
- 步骤：调用 `userClaim`。
- 关键断言：`claimedOrder=true`、`pending` 减少、`totalClaimed` 增加、用户 token 增加。
- 风险点：成功但状态漏更新，后续可重复领取。

25) IPShare `valueCapture(msg.value==0)` 失败

- 目的：保护空捕获调用。
- 前置条件：subject 已创建。
- 步骤：`valueCapture(subject, {value:0})`。
- 关键断言：revert `NoFunds`。
- 风险点：空调用污染事件与统计。

## 3.3 P2（增强回归）

26) Integration：上市临界前后一致性

- 目的：验证“临界前不上市、临界后立即上市”。
- 前置条件：精确计算 cap 前一笔和后一笔。
- 步骤：连续两笔 buy。
- 关键断言：第一笔 `listed=false`，第二笔 `listed=true`，且事件顺序正确。
- 风险点：临界切换抖动。

27) Integration：多次 swap 后 fee 累计一致性

- 目的：验证 Hook 长序列收费稳定。
- 前置条件：执行 N 次不同方向 swap。
- 步骤：统计前后 `feeReceiver`、`pendingProfits`。
- 关键断言：累计值与每笔 fee 求和一致（允许最小整数舍入误差）。
- 风险点：长周期漂移。

28) Integration：上市后资产守恒区间校验

- 目的：把方向性断言升级为定量断言。
- 前置条件：记录 listing 前后 token 合约、vault、feeReceiver 的 ETH/token。
- 步骤：触发上市。
- 关键断言：ETH 去向 = LP 使用 + flush；token 去向 = LP 使用 + 合约余量。
- 风险点：隐性资金泄漏。

---

## 4. 推荐测试落地顺序

建议按“先防事故，再补完整”的顺序：

1. 先补 P0（尤其是 `Token listed 状态机`、`Pump userClaim`、`IPShare pause/权限`、`Hook 未注册池`）。
2. 再补 P1 的边界与 fallback（减少线上灰区）。
3. 最后补 P2 的长路径一致性（防回归）。

---

## 5. 编写规范建议（便于可读与维护）

- 用例命名对齐现有风格：`should ...`，一个 `it` 只验证一个核心行为。
- 每条用例同时做两类断言：事件断言 + 余额/状态断言，避免“只看事件不看钱”。
- 优先复用 `tests/v3/fixtures/deploy.js`，减少部署噪音。
- 涉及时间窗口（15 秒防狙击、7 天解锁）统一使用 `time.increaseTo/increase`，避免测试抖动。
- 涉及费用计算时统一把公式写在测试体内，保证“预期值可读、可审计”。

---

## 6. 快速回归最小集合（建议）

若每次只跑一小组冒烟回归，建议至少包含以下 8 条：

- Token：`listed 后 buy/sell 均 revert`。
- Token：`_buyTokenFillToCap` 退款 + 上市事件。
- Pump：`userClaim` 无效签名 + 成功领取各 1 条。
- IPShare：`pause` 下关键函数均不可用。
- IPShare：`InsufficientShares` 与 `NoProfitToClaim`。
- Hook：`未注册池不收费` + `beforeInitialize Unauthorized`。

这组覆盖了最核心的资金与状态机风险面。
