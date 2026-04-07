/**
 * PumpBsc - BSC 主网部署模块
 *
 * IPShare 使用链上已部署实例，本模块不再部署 IPShare。
 *
 * 部署顺序: Pump(内部部署 Token impl) -> TipTagSwapHook -> adminSetHookAddress
 *
 * 参数 (通过 --parameters 传入 JSON 或 m.getParameter 默认值):
 *   - ipshare: 已部署的 IPShare 合约地址 (必填；下方默认值为 BSC 主网 TagAI)
 *   - feeReceiver: Pump 手续费接收地址 (可选，默认 0x0)
 *   - clPoolManager: PancakeSwap V4 CLPoolManager (可选，默认 BSC 主网)
 *   - vault: PancakeSwap V4 Vault (可选，默认 BSC 主网)
 *
 * 部署命令 (带验证):
 *   npx hardhat ignition deploy ignition/modules/PumpBsc.js --network bsc --verify
 *
 * 使用参数文件:
 *   npx hardhat ignition deploy ignition/modules/PumpBsc.js --network bsc --verify --parameters ignition/parameters/bsc.json
 *
 * 升级 Pump/Hook（字节码变更）时 Ignition 会报 reconciliation failed：
 *   - 推荐：本文件使用的模块 id 为 PumpBscV8，与历史 PumpBsc#* journal 分离，直接重新 deploy 即可得到新地址。
 *   - 或保留旧模块名时：按依赖顺序 wipe 后再 deploy —
 *       npx hardhat ignition wipe chain-56 PumpBsc#PumpSetHook --network bsc
 *       npx hardhat ignition wipe chain-56 PumpBsc#TipTagSwapHook --network bsc
 *       npx hardhat ignition wipe chain-56 PumpBsc#Pump --network bsc
 *     （若 journal 仍与当前模块结构不一致，可备份后删除 ignition/deployments/chain-56 再部署。）
 */

const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");

// BSC 主网 PancakeSwap V4 (Infinity) 合约地址
const DEFAULT_CL_POOL_MANAGER = "0xa0FfB9c1CE1Fe56963B0321B32E7A0302114058b";
const DEFAULT_VAULT = "0x238a358808379702088667322f80aC48bAd5e6c4";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
// BSC 主网已部署 IPShare（TagAI），沿用该地址时无需在 parameters 里重复传
const DEFAULT_BSC_IPSHARE = "0x95450AaD4Cc195e03BB4791B7f6f04aC6D9BA922";

// 模块 id：升级合约时用新 id，避免与已执行的 PumpBsc#Pump 等 future 字节码对账冲突
module.exports = buildModule("PumpBscV8", (m) => {
  const ipshare = m.getParameter("ipshare", DEFAULT_BSC_IPSHARE);
  const feeReceiver = m.getParameter("feeReceiver", ZERO_ADDRESS);
  const clPoolManager = m.getParameter("clPoolManager", DEFAULT_CL_POOL_MANAGER);
  const vault = m.getParameter("vault", DEFAULT_VAULT);

  const pump = m.contract("Pump", [ipshare, feeReceiver], { id: "Pump" });

  const hook = m.contract(
    "TipTagSwapHook",
    [clPoolManager, vault, pump],
    { id: "TipTagSwapHook" }
  );

  m.call(pump, "adminSetHookAddress", [hook], { id: "PumpSetHook" });

  // Nutbox：`createToken` 要求 Committee / CommunityFactory / LinearTimeCalculator / SocialCurationFactory
  // 均已配置。部署 Nutbox 协议后由 owner 调用 `pump.adminSetNutbox(factory, calculator, socialFactory, committee)`。

  // 注：Pump 所有权转移需部署后手动执行: pump.transferOwnership(newOwner)
  // 新 owner 需调用 pump.acceptOwnership() 完成转移

  return {
    ipshare,
    pump,
    hook,
  };
});
