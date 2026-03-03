const { ethers, network, run } = require("hardhat");

const DEFAULT_MAINNET_POOL_MANAGER = "0xa0FfB9c1CE1Fe56963B0321B32E7A0302114058b";
const DEFAULT_MAINNET_VAULT = "0x238a358808379702088667322f80aC48bAd5e6c4";

function mustAddress(name, value) {
  if (!value || !ethers.isAddress(value)) {
    throw new Error(`Invalid address for ${name}: ${value}`);
  }
  return value;
}

function parseBool(value, defaultValue = false) {
  if (value === undefined || value === null || value === "") return defaultValue;
  return ["1", "true", "yes", "y"].includes(String(value).toLowerCase());
}

async function verifyContract(address, constructorArguments) {
  try {
    await run("verify:verify", {
      address,
      constructorArguments,
    });
    console.log(`verified: ${address}`);
  } catch (error) {
    const msg = String(error?.message || error);
    if (msg.includes("Already Verified")) {
      console.log(`already verified: ${address}`);
      return;
    }
    throw error;
  }
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const { chainId } = await deployer.provider.getNetwork();

  console.log("network:", network.name, "chainId:", Number(chainId));
  console.log("deployer:", deployer.address);
  console.log(
    "balance:",
    ethers.formatEther(await deployer.provider.getBalance(deployer.address)),
    "BNB"
  );

  const deployHook = parseBool(process.env.DEPLOY_HOOK, true);
  const runVerify = parseBool(process.env.VERIFY, false);
  const existingIPShare = process.env.EXISTING_IPSHARE || "";
  const feeReceiver = process.env.FEE_RECEIVER || ethers.ZeroAddress;
  const protocolFeeDestination = process.env.PROTOCOL_FEE_DESTINATION || "";
  const newOwner = process.env.PUMP_OWNER || "";

  let ipshareAddress;
  if (existingIPShare) {
    ipshareAddress = mustAddress("EXISTING_IPSHARE", existingIPShare);
    console.log("reuse IPShare:", ipshareAddress);
  } else {
    const protocolFeeDestinationAddress = mustAddress(
      "PROTOCOL_FEE_DESTINATION",
      protocolFeeDestination
    );
    const ipshare = await ethers.deployContract("IPShare", [protocolFeeDestinationAddress]);
    await ipshare.waitForDeployment();
    ipshareAddress = ipshare.target;
    console.log("IPShare deployed:", ipshareAddress);
  }

  const tokenImplementation = await ethers.deployContract("Token");
  await tokenImplementation.waitForDeployment();
  console.log("Token implementation deployed:", tokenImplementation.target);

  const pump = await ethers.deployContract("Pump", [
    ipshareAddress,
    tokenImplementation.target,
    feeReceiver,
  ]);
  await pump.waitForDeployment();
  console.log("Pump deployed:", pump.target);

  let hookAddress = ethers.ZeroAddress;
  if (deployHook) {
    const clPoolManager = mustAddress(
      "CL_POOL_MANAGER",
      process.env.CL_POOL_MANAGER || DEFAULT_MAINNET_POOL_MANAGER
    );
    const vault = mustAddress("VAULT", process.env.VAULT || DEFAULT_MAINNET_VAULT);
    const hook = await ethers.deployContract("TipTagSwapHook", [clPoolManager, vault, pump.target]);
    await hook.waitForDeployment();
    hookAddress = hook.target;
    console.log("TipTagSwapHook deployed:", hookAddress);

    const tx = await pump.adminSetHookAddress(hookAddress);
    await tx.wait();
    console.log("Pump hook updated:", hookAddress);
  }

  if (newOwner) {
    const ownerAddress = mustAddress("PUMP_OWNER", newOwner);
    const tx = await pump.transferOwnership(ownerAddress);
    await tx.wait();
    console.log("Pump ownership transfer initiated to:", ownerAddress);
    console.log("Target owner must call acceptOwnership() to finish transfer.");
  }

  if (runVerify) {
    console.log("start verify...");
    if (!existingIPShare) {
      await verifyContract(ipshareAddress, [protocolFeeDestination]);
    }
    await verifyContract(tokenImplementation.target, []);
    await verifyContract(pump.target, [ipshareAddress, tokenImplementation.target, feeReceiver]);
    if (hookAddress !== ethers.ZeroAddress) {
      const clPoolManager = process.env.CL_POOL_MANAGER || DEFAULT_MAINNET_POOL_MANAGER;
      const vault = process.env.VAULT || DEFAULT_MAINNET_VAULT;
      await verifyContract(hookAddress, [clPoolManager, vault, pump.target]);
    }
  }

  console.log("\n=== DEPLOY RESULT ===");
  console.log(
    JSON.stringify(
      {
        network: network.name,
        chainId: Number(chainId),
        deployer: deployer.address,
        ipshare: ipshareAddress,
        tokenImplementation: tokenImplementation.target,
        pump: pump.target,
        hook: hookAddress,
        feeReceiver,
        deployHook,
      },
      null,
      2
    )
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });