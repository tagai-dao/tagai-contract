const { ethers } = require('hardhat');

async function main() {
    console.log('start')
    const [signer] = await ethers.getSigners();
    console.log("deployer:", signer.address, 'balance:', await signer.provider.getBalance(signer.address), '\n', await signer.provider.getFeeData())

    const coinPurse = await ethers.deployContract('CoinPurse')
    console.log(2, coinPurse.target)
}

main().catch(error => {
    console.error(error)
}).finally(process.exit)