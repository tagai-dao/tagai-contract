const { ethers } = require('hardhat');

async function main() {
    console.log('start')
    const [signer] = await ethers.getSigners();
    console.log("deployer:", signer.address, 'balance:', (await signer.provider.getBalance(signer.address)).toString() / 1e18, '\n', await signer.provider.getFeeData())
   
    const popup = await ethers.deployContract('PopUp');
    console.log(1, popup.target)
}

main().catch(error => {
    console.error(error)
}).finally(process.exit)