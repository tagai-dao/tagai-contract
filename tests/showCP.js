const { ethers } = require('hardhat');

const coinPurseAddr = "0xf29BB860d5067a848Aed3cFdba1d7DC68BaBD23c"
const addr1 = "0x6f0Def5929EAf5f11d6A9A064f388cA14AA28707"
const addr2 = "0x8F3245A0bD40ca4985D7Cc9f0cF82771B58b99a7"
const testToken = "0xcB855C87bbF3A4853720578C67edf265856FA026"
const WBNBAddr = "0xae13d989dac2f0debff460ac112a837c89baa7cd"
const operator = "0x000000422a69dfB418c7D4093ad50f154325F5f8"

async function show() {
    const [signer] = await ethers.getSigners();
    const coinPurse = await ethers.getContractAt("CoinPurse", coinPurseAddr, signer)
    const token = await ethers.getContractAt("TestERC20", testToken, signer)
    const WBNB = await ethers.getContractAt("WETH9", WBNBAddr, signer)

    console.log("addr1:", addr1)
    const b1 = await token.balanceOf(addr1)
    const wb1 = await WBNB.balanceOf(addr1)
    const r1 = await coinPurse.userLimits(addr1, testToken)
    const a1 = await WBNB.allowance(addr1, coinPurseAddr)
    console.log("\tlimits:", r1)
    console.log("\ttoken balance:", ethers.formatEther(b1))
    console.log("\twbnb balance:", ethers.formatEther(wb1))
    console.log("\twbnb allowance:", ethers.formatEther(a1))

    console.log("addr2:", addr2)
    const b2 = await token.balanceOf(addr2)
    const wb2 = await WBNB.balanceOf(addr2)
    const r2 = await coinPurse.userLimits(addr2, testToken)
    const a2 = await WBNB.allowance(addr2, coinPurseAddr)
    console.log("\tlimits:", r2)
    console.log("\ttoken balance:", ethers.formatEther(b2))
    console.log("\twbnb balance:", ethers.formatEther(wb2))
    console.log("\twbnb allowance:", ethers.formatEther(a2))

    // const err = coinPurse.interface.parseError("0x7939f424")
    // console.log(err)

    const err = await coinPurse.orderIdError("0xadaba0dad6ff3e99f7ece16ecb187839")
    console.log(err)
}

show()
