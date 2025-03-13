const { ethers } = require('hardhat');

async function main() {
    console.log('start')
    const [signer] = await ethers.getSigners();
    console.log("deployer:", signer.address, 'balance:', await signer.provider.getBalance(signer.address), '\n', await signer.provider.getFeeData())
    // return;
    const warpUniv2 = await ethers.deployContract('WrappedUniV2ForTagAI');
    console.log(1, warpUniv2.target)
}

main().catch(error => {
    console.error(error)
}).finally(process.exit)