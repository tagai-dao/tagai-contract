const { ethers } = require("hardhat");

async function main() {
    console.log("开始部署 TagAIPoints 合约...");
    
    // 获取部署者账户
    const [deployer] = await ethers.getSigners();
    console.log("部署者地址:", deployer.address);
    console.log("部署者余额:", ethers.formatEther(await deployer.provider.getBalance(deployer.address)), "ETH");
    
    // 部署合约
    const TagAIPoints = await ethers.getContractFactory("TagAIPoints");
    
    const tagAIPoints = await TagAIPoints.deploy();
    
    await tagAIPoints.waitForDeployment();
    
    const contractAddress = await tagAIPoints.getAddress();
    console.log("TagAIPoints 合约地址:", contractAddress);
    
    // 验证合约信息
    console.log("\n=== 合约信息 ===");
    console.log("代币名称:", await tagAIPoints.name());
    console.log("代币符号:", await tagAIPoints.symbol());
    console.log("代币精度:", await tagAIPoints.decimals());
    console.log("总供应量:", ethers.formatEther(await tagAIPoints.totalSupply()), "TAGAI");
    console.log("管理员地址:", await tagAIPoints.getAdmin());
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("部署失败:", error);
        process.exit(1);
    });
