/**
 * PumpBsc - BSC 主网部署模块
 *
 * 部署顺序: IPShare -> Token(impl) -> Pump -> TipTagSwapHook -> adminSetHookAddress
 *
 * 参数 (通过 --parameters 传入 JSON 或 m.getParameter 默认值):
 *   - protocolFeeDestination: IPShare 协议费接收地址 (必填)
 *   - feeReceiver: Pump 手续费接收地址 (可选，默认 0x0)
 *   - clPoolManager: PancakeSwap V4 CLPoolManager (可选，默认 BSC 主网)
 *   - vault: PancakeSwap V4 Vault (可选，默认 BSC 主网)
 *
 * 部署命令 (带验证):
 *   npx hardhat ignition deploy ignition/modules/PumpBsc.js --network bsc --verify
 *
 * 使用参数文件:
 *   npx hardhat ignition deploy ignition/modules/PumpBsc.js --network bsc --verify --parameters ignition/parameters/bsc.json
 */

const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");

// BSC 主网 PancakeSwap V4 (Infinity) 合约地址
const DEFAULT_CL_POOL_MANAGER = "0xa0FfB9c1CE1Fe56963B0321B32E7A0302114058b";
const DEFAULT_VAULT = "0x238a358808379702088667322f80aC48bAd5e6c4";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

module.exports = buildModule("PumpBsc", (m) => {
  // ========== 参数 ==========
  const protocolFeeDestination = m.getParameter(
    "protocolFeeDestination"
    // 无默认值，部署时必须通过 parameters 传入
  );
  const feeReceiver = m.getParameter("feeReceiver", ZERO_ADDRESS);
  const clPoolManager = m.getParameter("clPoolManager", DEFAULT_CL_POOL_MANAGER);
  const vault = m.getParameter("vault", DEFAULT_VAULT);

  // ========== 1. 部署 IPShare ==========
  const ipshare = m.contract("IPShare", [protocolFeeDestination], {
    id: "IPShare",
  });

  // ========== 2. 部署 Token 实现 ==========
  const tokenImplementation = m.contract("Token", [], {
    id: "TokenImplementation",
  });

  // ========== 3. 部署 Pump ==========
  const pump = m.contract(
    "Pump",
    [ipshare, tokenImplementation, feeReceiver],
    { id: "Pump" }
  );

  // ========== 4. 部署 TipTagSwapHook ==========
  const hook = m.contract(
    "TipTagSwapHook",
    [clPoolManager, vault, pump],
    { id: "TipTagSwapHook" }
  );

  // ========== 5. Pump 设置 Hook 地址 ==========
  m.call(pump, "adminSetHookAddress", [hook], { id: "PumpSetHook" });

  // Nutbox：`createToken` 要求 Committee / CommunityFactory / LinearTimeCalculator / SocialCurationFactory
  // 均已配置。部署 Nutbox 协议后由 owner 调用 `pump.adminSetNutbox(factory, calculator, socialFactory, committee)`。

  // 注：Pump 所有权转移需部署后手动执行: pump.transferOwnership(newOwner)
  // 新 owner 需调用 pump.acceptOwnership() 完成转移

  return {
    ipshare,
    tokenImplementation,
    pump,
    hook,
  };
});
