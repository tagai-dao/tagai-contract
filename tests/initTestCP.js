const { ethers } = require('hardhat');

async function main() {
    const addr1Key = "0x4aabefb62aef210fc6f90394018301e68dbc74f57ac176489846849a617bfc23" // 0x6f0Def5929EAf5f11d6A9A064f388cA14AA28707
    const addr2Key = "0x8dfdc8ade38476e838049d8cccb2b1c032fa51455a36c4da9fd9b252662249d4" // 0x8F3245A0bD40ca4985D7Cc9f0cF82771B58b99a7
    const testToken = "0xcB855C87bbF3A4853720578C67edf265856FA026"
    const coinPurseAddr = "0xf29BB860d5067a848Aed3cFdba1d7DC68BaBD23c"
    const WBNBAddr = "0xae13d989dac2f0debff460ac112a837c89baa7cd"

    const addr1Wallet = new ethers.Wallet(addr1Key, ethers.provider)
    const addr2Wallet = new ethers.Wallet(addr2Key, ethers.provider)

    console.log('start')
    const [signer] = await ethers.getSigners();
    console.log("deployer:", signer.address, 'balance:', await signer.provider.getBalance(signer.address), '\n', await signer.provider.getFeeData())

    const token = await ethers.getContractAt("TestERC20", testToken, signer)
    const coinPurse = await ethers.getContractAt("CoinPurse", coinPurseAddr, signer)
    const WBNB = await ethers.getContractAt("WETH9", WBNBAddr, signer)

    // set operator
    await coinPurse.connect(signer).setOperator(signer.address)
    // set wbnb
    await coinPurse.connect(signer).setWBNB(WBNB.target)

    // sent test token
    await token.connect(signer).transfer(addr1Wallet.address, ethers.parseEther("10000"))
    await token.connect(signer).transfer(addr2Wallet.address, ethers.parseEther("10000"))

    // sent gas
    await signer.sendTransaction({ to: addr1Wallet.address, value: ethers.parseEther("0.01") })
    const tx = await signer.sendTransaction({ to: addr2Wallet.address, value: ethers.parseEther("0.01") })
    await tx.wait()

    // deposit wbnb
    await addr1Wallet.sendTransaction({ to: WBNBAddr, value: ethers.parseEther("0.001") })
    await addr2Wallet.sendTransaction({ to: WBNBAddr, value: ethers.parseEther("0.001") })

    // approve token to coinPurse
    await token.connect(addr1Wallet).approve(coinPurse.target, ethers.parseEther("10000000"))
    await token.connect(addr2Wallet).approve(coinPurse.target, ethers.parseEther("10000000"))

    // approve wbnb to coinPurse
    await WBNB.connect(addr1Wallet).approve(coinPurse.target, ethers.parseEther("1"))
    await WBNB.connect(addr2Wallet).approve(coinPurse.target, ethers.parseEther("1"))

    // Authorized token amount
    await coinPurse.connect(addr1Wallet).setLimit(token.target, ethers.parseEther("10"), ethers.parseEther("100"))
    await coinPurse.connect(addr2Wallet).setLimit(token.target, ethers.parseEther("10"), ethers.parseEther("100"))

}

main().catch(error => {
    console.error(error)
}).finally(process.exit)