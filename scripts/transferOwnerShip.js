const { ethers } = require('hardhat');

async function main() {
    console.log('start')
    const IPShareContract1 = "0x7B0ddC305C32AAEbabc0FE372a4460e9903e95D0";
    const IPShareContract2 = "0x24328DccA1bA54EeE82e2993F021802e64290486";
    const [signer] = await ethers.getSigners();
    console.log("deployer:", signer.address, 'balance:', await signer.provider.getBalance(signer.address), '\n', await signer.provider.getFeeData())

    const ipshare1 = await ethers.getContractAt('IPShare', IPShareContract1);
    console.log(1, ipshare1.target)

    const ipshare2 = await ethers.getContractAt('IPShare', IPShareContract2);
    console.log(2, ipshare2.target)

    let tx = await ipshare1.transferOwnership('0x871fb7006C5964B21695Ba20006021777A26146C');
    await tx.wait();
    tx = await ipshare2.transferOwnership('0x871fb7006C5964B21695Ba20006021777A26146C');
    await tx.wait();

    const owner1 = await ipshare1.owner();
    const owner2 = await ipshare2.owner();
    console.log(3, owner1, owner2)
}

main().catch(error => {
    console.error(error)
}).finally(process.exit)