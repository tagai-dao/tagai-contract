const { ethers } = require('hardhat')

const PumpContract = '0xa77253Ac630502A35A6FcD210A01f613D33ba7cD'

async function main() {
    const [signer] = await ethers.getSigners();
    const pump = await ethers.getContractAt('Pump', PumpContract, signer);
    const [salt] = await pump.generateSalt(signer.address);
    const tx = await pump.createToken('TST', salt, {
        value: ethers.parseEther('0.01')
    });
    console.log(tx.hash);
    await tx.wait();
}

main().catch(console.error).finally(process.exit)