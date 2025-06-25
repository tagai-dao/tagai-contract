const { ethers } = require('hardhat');

async function main() {
    console.log('start')
    const [signer] = await ethers.getSigners();
    console.log("deployer:", signer.address, 'balance:', await signer.provider.getBalance(signer.address), '\n', await signer.provider.getFeeData())
    // return;
    const socialDistribution = await ethers.deployContract('SocialDistribution', [
        
    ]);
    console.log(1, socialDistribution.target)

    // const pump = await ethers.deployContract('Pump', [ipshare.target])
    // console.log(2, pump.target)

    // const wrappUni = await ethers.deployContract('WrappedUniV2ForTipTag', 
    //     ['0xb6eec8EaEAEd773F47265f743Db607eb547BD2Dc', 
    //         '0x06Deb72b2e156Ddd383651aC3d2dAb5892d9c048', 
    //         100, 
    //         0]);
    // console.log(3, wrappUni.target);
}

main().catch(error => {
    console.error(error)
}).finally(process.exit)