const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

// TagPoints 合约地址
const TAG_POINTS_ADDRESS = "0x013f02c21cEDf1c846044B30Cabe289ef4DaFD18";

// CSV 文件路径
const CSV_FILE_PATH = path.join(__dirname, "generated_addresses_reward2.csv");

async function main() {
    console.log("=== 从 CSV 文件批量铸造 TagPoints ===\n");
    
    // 获取部署者账户
    const [deployer] = await ethers.getSigners();
    console.log("操作者地址:", deployer.address);
    console.log("操作者余额:", ethers.formatEther(await deployer.provider.getBalance(deployer.address)), "ETH\n");
    
    // 连接到已部署的合约
    const TagAIPoints = await ethers.getContractFactory("TagAIPoints");
    const tagPoints = TagAIPoints.attach(TAG_POINTS_ADDRESS);
    
    // 验证合约信息
    console.log("=== 合约信息 ===");
    console.log("合约地址:", TAG_POINTS_ADDRESS);
    console.log("代币名称:", await tagPoints.name());
    console.log("代币符号:", await tagPoints.symbol());
    console.log("当前总供应量:", ethers.formatEther(await tagPoints.totalSupply()), "TAG-POINTS");
    console.log("管理员地址:", await tagPoints.getAdmin());
    
    // 检查是否为管理员
    const isAdmin = await tagPoints.isAdmin(deployer.address);
    if (!isAdmin) {
        console.error("\n❌ 错误: 当前地址不是管理员，无法铸造代币");
        process.exit(1);
    }
    console.log("\n✅ 当前地址是管理员，可以铸造代币");
    
    // 读取 CSV 文件
    console.log("\n=== 读取 CSV 文件 ===");
    console.log("文件路径:", CSV_FILE_PATH);
    
    if (!fs.existsSync(CSV_FILE_PATH)) {
        console.error("❌ CSV 文件不存在:", CSV_FILE_PATH);
        process.exit(1);
    }
    
    let csvData;
    try {
        csvData = fs.readFileSync(CSV_FILE_PATH, "utf8");
    } catch (error) {
        console.error("❌ 读取 CSV 文件失败:", error.message);
        process.exit(1);
    }
    
    // 解析 CSV 数据
    const lines = csvData.trim().split('\n');
    const recipients = [];
    const amounts = [];
    
    console.log(`\n解析到 ${lines.length} 行数据`);
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        const parts = line.split(',');
        if (parts.length !== 2) {
            console.warn(`⚠️  第 ${i + 1} 行格式错误，跳过: ${line}`);
            continue;
        }
        
        const address = parts[0].trim();
        const amountStr = parts[1].trim();
        
        // 验证地址格式
        if (!ethers.isAddress(address)) {
            console.warn(`⚠️  第 ${i + 1} 行地址格式错误，跳过: ${address}`);
            continue;
        }
        
        // 验证数量
        const amount = parseInt(amountStr);
        if (isNaN(amount) || amount <= 0) {
            console.warn(`⚠️  第 ${i + 1} 行数量无效，跳过: ${amountStr}`);
            continue;
        }
        
        recipients.push(address);
        amounts.push(ethers.parseEther(amount.toString()));
    }
    
    if (recipients.length === 0) {
        console.error("❌ 没有有效的地址和数量数据");
        process.exit(1);
    }
    
    console.log(`✅ 成功解析 ${recipients.length} 个有效地址`);
    
    // 计算总数量
    const totalAmount = amounts.reduce((sum, amount) => sum + amount, 0n);
    console.log(`总铸造数量: ${ethers.formatEther(totalAmount)} TAG-POINTS`);
    
    // 显示前几个地址的详情
    console.log("\n=== 铸造详情预览 ===");
    const previewCount = Math.min(5, recipients.length);
    for (let i = 0; i < previewCount; i++) {
        console.log(`地址 ${i + 1}: ${recipients[i]} - ${ethers.formatEther(amounts[i])} TAG-POINTS`);
    }
    if (recipients.length > previewCount) {
        console.log(`... 还有 ${recipients.length - previewCount} 个地址`);
    }
    
    // 检查当前余额
    console.log("\n=== 铸造前余额检查 ===");
    const checkCount = Math.min(3, recipients.length);
    for (let i = 0; i < checkCount; i++) {
        const balance = await tagPoints.balanceOf(recipients[i]);
        console.log(`地址 ${recipients[i]}: ${ethers.formatEther(balance)} TAG-POINTS`);
    }
    
    // 确认执行
    console.log(`\n准备批量铸造 ${recipients.length} 个地址，总数量 ${ethers.formatEther(totalAmount)} TAG-POINTS`);
    console.log("⚠️  请确认以上信息正确后继续...");
    
    // 执行批量铸造
    console.log("\n=== 开始批量铸造 ===");
    try {
        const tx = await tagPoints.batchMint(recipients, amounts);
        console.log("交易哈希:", tx.hash);
        console.log("等待交易确认...");
        
        const receipt = await tx.wait();
        console.log("✅ 交易确认!");
        console.log("Gas 使用:", receipt.gasUsed.toString());
        console.log("Gas 价格:", ethers.formatUnits(receipt.gasPrice, "gwei"), "Gwei");
        
        // 检查铸造后余额
        console.log("\n=== 铸造后余额检查 ===");
        for (let i = 0; i < checkCount; i++) {
            const balance = await tagPoints.balanceOf(recipients[i]);
            console.log(`地址 ${recipients[i]}: ${ethers.formatEther(balance)} TAG-POINTS`);
        }
        
        // 显示新的总供应量
        const newTotalSupply = await tagPoints.totalSupply();
        console.log("\n新的总供应量:", ethers.formatEther(newTotalSupply), "TAG-POINTS");
        
        console.log("\n🎉 批量铸造完成!");
        
    } catch (error) {
        console.error("❌ 批量铸造失败:", error.message);
        
        // 如果是特定错误，提供更详细的错误信息
        if (error.message.includes("OnlyAdmin")) {
            console.error("错误: 只有管理员可以铸造代币");
        } else if (error.message.includes("InvalidAddress")) {
            console.error("错误: 包含无效地址");
        } else if (error.message.includes("ArrayLengthMismatch")) {
            console.error("错误: 地址和数量数组长度不匹配");
        } else if (error.message.includes("ZeroAmount")) {
            console.error("错误: 包含零数量");
        } else if (error.message.includes("MaxSupplyReached")) {
            console.error("错误: 超过最大供应量限制");
        }
        
        process.exit(1);
    }
}

// 如果直接运行此脚本
if (require.main === module) {
    main()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error("脚本执行失败:", error);
            process.exit(1);
        });
}

module.exports = {
    main,
    TAG_POINTS_ADDRESS
};
