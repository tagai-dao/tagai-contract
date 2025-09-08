const { ethers } = require('hardhat');

async function main() {
    console.log('start')
    const [signer] = await ethers.getSigners();
    console.log("deployer:", signer.address, 'balance:', await signer.provider.getBalance(signer.address), '\n', await signer.provider.getFeeData())
// return;
    // const coinPurse = await ethers.deployContract('CoinPurse');
    // console.log(1, coinPurse.target)
    // return;
    // const ipshare = await ethers.deployContract('IPShare');
    // console.log(1, ipshare.target)

    const pump = await ethers.deployContract('Pump', ['0x7B0ddC305C32AAEbabc0FE372a4460e9903e95D0'])
    console.log(2, pump.target)

    // const wrappUni = await ethers.deployContract('WrappedUniV2ForTagAI');
    // console.log(3, wrappUni.target);
}

main().catch(error => {
    console.error(error)
}).finally(process.exit)