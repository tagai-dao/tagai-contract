const { ethers } = require('hardhat');

/**
 * 更新 OracleDistribution 合约的 signer
 * 合约地址: 0xe63B98dA0c8fbDfE94A08Fc6b5d8797374415F57
 * 新 signer 地址: 0x7B1E2Ca2935dB066EB5CBf606328Fa6013Ee3984
 */
async function main() {
    console.log('开始更新 OracleDistribution 合约的 signer...');
    
    // 获取签名者（必须是合约的 owner）
    const [signer] = await ethers.getSigners();
    console.log('执行账户:', signer.address);
    console.log('账户余额:', ethers.formatEther(await signer.provider.getBalance(signer.address)), 'ETH');
    
    // 合约地址
    const contractAddress = '0xe63B98dA0c8fbDfE94A08Fc6b5d8797374415F57';
    
    // 连接到已部署的合约
    const oracleDistribution = await ethers.getContractAt('OracleDistribution', contractAddress);
    console.log('已连接到合约:', contractAddress);
    
    // 查询合约的 owner 地址
    console.log('\n查询合约 owner...');
    const owner = await oracleDistribution.owner();
    console.log('合约 Owner 地址:', owner);
    
    // 检查执行账户是否是 owner
    if (owner.toLowerCase() !== signer.address.toLowerCase()) {
        console.error('\n❌ 错误: 当前执行账户不是合约 owner!');
        console.error('   执行账户:', signer.address);
        console.error('   合约 Owner:', owner);
        console.error('   请使用 owner 账户来执行此脚本');
        process.exit(1);
    }
    
    console.log('✅ 验证通过: 当前账户是合约 owner\n');
    
    // 新的 signer 地址
    const newSignerAddress = '0x7B1E2Ca2935dB066EB5CBf606328Fa6013Ee3984';
    
    // 验证地址格式
    if (!ethers.isAddress(newSignerAddress)) {
        throw new Error('无效的新 signer 地址');
    }
    
    // 调用 adminUpdateSigner 函数
    console.log('\n准备更新 signer...');
    console.log('当前 signer:', '需要从事件中查看');
    console.log('新 signer:', newSignerAddress);
    
    const tx = await oracleDistribution.adminUpdateSigner(newSignerAddress);
    console.log('交易已发送，交易哈希:', tx.hash);
    
    // 等待交易确认
    console.log('等待交易确认...');
    const receipt = await tx.wait();
    console.log('交易已确认，区块号:', receipt.blockNumber);
    
    // 查找并输出事件
    const event = receipt.logs.find(log => {
        try {
            const parsed = oracleDistribution.interface.parseLog(log);
            return parsed && parsed.name === 'AdminUpdateSigner';
        } catch (e) {
            return false;
        }
    });
    
    if (event) {
        const parsed = oracleDistribution.interface.parseLog(event);
        console.log('\n✅ Signer 更新成功!');
        console.log('新 signer 地址:', parsed.args.signer);
    } else {
        console.log('\n✅ 交易已确认，但未找到事件日志');
    }
    
    console.log('\n脚本执行完成');
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('❌ 执行失败:', error);
        process.exit(1);
    });
