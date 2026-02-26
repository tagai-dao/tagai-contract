const { ethers } = require("hardhat");

function toWei(value) {
  return ethers.parseEther(value.toString());
}

function saltFromNumber(n) {
  return ethers.toBeHex(BigInt(n), 32);
}

async function deployCoreFixture() {
  const [owner, creator, buyer, feeReceiver, ipshareFeeDestination, alice, bob, carol] =
    await ethers.getSigners();

  const IPShare = await ethers.getContractFactory("IPShare");
  const ipshare = await IPShare.deploy(ipshareFeeDestination.address);

  const Token = await ethers.getContractFactory("Token");
  const tokenImplementation = await Token.deploy();

  const Pump = await ethers.getContractFactory("Pump");
  const pump = await Pump.deploy(ipshare.target, tokenImplementation.target, feeReceiver.address);

  return {
    owner,
    creator,
    buyer,
    feeReceiver,
    ipshareFeeDestination,
    alice,
    bob,
    carol,
    ipshare,
    tokenImplementation,
    pump,
  };
}

async function createTokenByEvent(pump, signer, tick, salt, value) {
  const tx = await pump.connect(signer).createToken(tick, salt, { value });
  const receipt = await tx.wait();
  const newTokenEvent = receipt.logs
    .map((log) => {
      try {
        return pump.interface.parseLog(log);
      } catch (e) {
        return null;
      }
    })
    .find((parsed) => parsed && parsed.name === "NewToken");

  if (!newTokenEvent) {
    throw new Error("NewToken event not found");
  }

  const tokenAddress = newTokenEvent.args.token;
  const token = await ethers.getContractAt("Token", tokenAddress);

  return {
    tx,
    receipt,
    tokenAddress,
    token,
  };
}

module.exports = {
  toWei,
  saltFromNumber,
  deployCoreFixture,
  createTokenByEvent,
};
