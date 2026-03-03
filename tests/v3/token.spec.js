const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { deployCoreFixture, toWei, saltFromNumber, createTokenByEvent } = require("./fixtures/deploy");

function parseTradeEvent(receipt, token) {
  const parsed = receipt.logs
    .map((log) => {
      try {
        return token.interface.parseLog(log);
      } catch (e) {
        return null;
      }
    })
    .find((eventLog) => eventLog && eventLog.name === "Trade");

  if (!parsed) {
    throw new Error("Trade event not found");
  }

  return parsed.args;
}

describe("Token (v3)", function () {
  async function deployTokenFixture() {
    const fixture = await deployCoreFixture();
    const salt = saltFromNumber(1);
    const createFee = await fixture.pump.createFee();
    const { token } = await createTokenByEvent(fixture.pump, fixture.creator, "FEE", salt, createFee);
    return {
      ...fixture,
      token,
    };
  }

  async function deployListedTokenFixture() {
    const fixture = await deployCoreFixture();
    const { owner, creator, pump } = fixture;

    const Vault = await ethers.getContractFactory("TestVault");
    const vault = await Vault.deploy();

    const CLPoolManager = await ethers.getContractFactory("TestCLPoolManager");
    const clPoolManager = await CLPoolManager.deploy(vault.target);
    await vault.connect(owner).registerApp(clPoolManager.target);

    await pump.connect(owner).adminSetPoolManager(clPoolManager.target);
    await pump.connect(owner).adminSetVault(vault.target);

    const TipTagSwapHook = await ethers.getContractFactory("TipTagSwapHook");
    const hook = await TipTagSwapHook.deploy(clPoolManager.target, vault.target, pump.target);
    await pump.connect(owner).adminSetHookAddress(hook.target);

    const salt = saltFromNumber(9);
    const createFee = await pump.createFee();
    const { token } = await createTokenByEvent(pump, creator, "LST", salt, createFee);

    const capAmount = toWei(650000000);
    const needEth = await pump.getBuyPriceAfterFee(0, capAmount);
    await token.connect(creator).buyToken(0, ethers.ZeroAddress, 0, { value: needEth + 10_000_000_000n });

    return {
      ...fixture,
      vault,
      clPoolManager,
      hook,
      token,
    };
  }

  it("should use static fee ratio on the first buy", async function () {
    const { token, pump, buyer } = await loadFixture(deployTokenFixture);
    const buyValue = toWei(1);

    const feeRatio = await pump.getFeeRatio();
    const tx = await token.connect(buyer).buyToken(0, ethers.ZeroAddress, 0, { value: buyValue });
    const receipt = await tx.wait();
    const tradeArgs = parseTradeEvent(receipt, token);

    const expectedTiptagFee = (buyValue * feeRatio[0]) / 10000n;
    const expectedSellsmanFee = (buyValue * feeRatio[1]) / 10000n;

    expect(tradeArgs.isBuy).to.equal(true);
    expect(tradeArgs.tiptagFee).to.equal(expectedTiptagFee);
    expect(tradeArgs.sellsmanFee).to.equal(expectedSellsmanFee);
  });

  it("should apply dynamic buy fee before 15 seconds and fallback after window", async function () {
    const { token, pump, buyer } = await loadFixture(deployTokenFixture);
    const feeRatio = await pump.getFeeRatio();

    // First buy sets bondingCurveSupply > 0, dynamic fee applies afterwards.
    await token.connect(buyer).buyToken(0, ethers.ZeroAddress, 0, { value: toWei(1) });

    const createdAt = await token.createdAt();

    await time.increaseTo(createdAt + 2n);
    let ratios = await token.getBuyFeeRatios();
    const expectedAt1 =
      feeRatio[1] + ((8000n - feeRatio[1]) * (13n * 13n)) / 225n;
    expect(ratios[0]).to.equal(feeRatio[0]);
    expect(ratios[1]).to.equal(expectedAt1);
    expect(ratios[1]).to.be.gt(feeRatio[1]);

    await time.increaseTo(createdAt + 14n);
    ratios = await token.getBuyFeeRatios();
    const expectedAt14 =
      feeRatio[1] + ((8000n - feeRatio[1]) * (1n * 1n)) / 225n;
    expect(ratios[1]).to.equal(expectedAt14);
    expect(ratios[1]).to.be.gt(feeRatio[1]);

    await time.increaseTo(createdAt + 16n);
    ratios = await token.getBuyFeeRatios();
    expect(ratios[0]).to.equal(feeRatio[0]);
    expect(ratios[1]).to.equal(feeRatio[1]);
  });

  it("should keep sell fee static before listed", async function () {
    const { token, pump, buyer } = await loadFixture(deployTokenFixture);
    const feeRatio = await pump.getFeeRatio();

    await token.connect(buyer).buyToken(0, ethers.ZeroAddress, 0, { value: toWei(1) });

    const supplyBefore = await token.bondingCurveSupply();
    const sellAmount = (await token.balanceOf(buyer.address)) / 2n;

    await time.increase(8);

    const tx = await token.connect(buyer).sellToken(sellAmount, 0, ethers.ZeroAddress, 0);
    const receipt = await tx.wait();
    const tradeArgs = parseTradeEvent(receipt, token);

    const afterSupply = supplyBefore - sellAmount;
    const price = await pump.getPrice(afterSupply, sellAmount);
    const expectedTiptagFee = (price * feeRatio[0]) / 10000n;
    const expectedSellsmanFee = (price * feeRatio[1]) / 10000n;

    expect(tradeArgs.isBuy).to.equal(false);
    expect(tradeArgs.tiptagFee).to.equal(expectedTiptagFee);
    expect(tradeArgs.sellsmanFee).to.equal(expectedSellsmanFee);
  });

  it("should revert buy and sell on bonding curve after listed", async function () {
    const { token, creator } = await loadFixture(deployListedTokenFixture);
    expect(await token.listed()).to.equal(true);

    await expect(token.connect(creator).buyToken(0, ethers.ZeroAddress, 0, { value: toWei(1) })).to.be.revertedWithCustomError(
      token,
      "TokenListed"
    );
    await expect(token.connect(creator).sellToken(1n, 0, ethers.ZeroAddress, 0)).to.be.revertedWithCustomError(
      token,
      "TokenListed"
    );
  });

  it("should revert when non-zero sellsman has no ipshare", async function () {
    const { token, buyer, alice } = await loadFixture(deployTokenFixture);

    await expect(token.connect(buyer).buyToken(0, alice.address, 0, { value: toWei(1) })).to.be.revertedWithCustomError(
      token,
      "IPShareNotCreated"
    );

    await token.connect(buyer).buyToken(0, ethers.ZeroAddress, 0, { value: toWei(1) });
    const sellAmount = (await token.balanceOf(buyer.address)) / 2n;
    await expect(token.connect(buyer).sellToken(sellAmount, 0, alice.address, 0)).to.be.revertedWithCustomError(
      token,
      "IPShareNotCreated"
    );
  });

  it("should revert tiny buy and tiny sell with DustIssue", async function () {
    const { token, buyer } = await loadFixture(deployTokenFixture);

    await expect(token.connect(buyer).buyToken(0, ethers.ZeroAddress, 0, { value: 1_000_000_000n })).to.be.revertedWithCustomError(
      token,
      "DustIssue"
    );

    await token.connect(buyer).buyToken(0, ethers.ZeroAddress, 0, { value: toWei(1) });
    await expect(token.connect(buyer).sellToken(1n, 0, ethers.ZeroAddress, 0)).to.be.revertedWithCustomError(
      token,
      "DustIssue"
    );
  });

  it("should auto-buy on receive() before listed", async function () {
    const { token, buyer } = await loadFixture(deployTokenFixture);
    const before = await token.balanceOf(buyer.address);
    await buyer.sendTransaction({ to: token.target, value: toWei(1) });
    const after = await token.balanceOf(buyer.address);
    expect(after).to.be.gt(before);
  });

  it("should block external transfer to vault before listed", async function () {
    const { token, buyer, pump } = await loadFixture(deployTokenFixture);
    await token.connect(buyer).buyToken(0, ethers.ZeroAddress, 0, { value: toWei(1) });
    const vaultAddress = await pump.getVault();

    await expect(token.connect(buyer).transfer(vaultAddress, 1n)).to.be.revertedWithCustomError(token, "TokenNotListed");
  });

  describe("anti-MEV: fee recipient during dynamic window (15s)", function () {
    it("should use ipshareSubject as fee recipient for buy within 15s even when custom sellsman passed", async function () {
      const { token, pump, buyer, creator, alice } = await loadFixture(deployTokenFixture);
      // 让 alice 拥有 IPShare（通过创建 token）
      const aliceSalt = saltFromNumber(99);
      const createFee = await pump.createFee();
      await createTokenByEvent(pump, alice, "ALICE", aliceSalt, createFee);

      // 首笔 buy 使 bondingCurveSupply > 0，触发动态费用
      await token.connect(buyer).buyToken(0, ethers.ZeroAddress, 0, { value: toWei(1) });

      await time.increase(3); // 仍在 15s 内

      // 传入 alice 为 sellsman，但 15s 内应强制归 creator（ipshareSubject）
      const tx = await token.connect(buyer).buyToken(0, alice.address, 0, { value: toWei(0.5) });
      const receipt = await tx.wait();
      const tradeArgs = parseTradeEvent(receipt, token);

      expect(tradeArgs.sellsman).to.equal(creator.address);
      expect(tradeArgs.sellsman).to.not.equal(alice.address);
    });

    it("should use ipshareSubject as fee recipient for sell within 15s even when custom sellsman passed", async function () {
      const { token, pump, buyer, creator, alice } = await loadFixture(deployTokenFixture);
      const aliceSalt = saltFromNumber(98);
      const createFee = await pump.createFee();
      await createTokenByEvent(pump, alice, "ALC2", aliceSalt, createFee);

      await token.connect(buyer).buyToken(0, ethers.ZeroAddress, 0, { value: toWei(1) });
      const sellAmount = (await token.balanceOf(buyer.address)) / 2n;

      const createdAt = await token.createdAt();
      await time.increaseTo(createdAt + 3n); // 仍在 15s 内

      const tx = await token.connect(buyer).sellToken(sellAmount, 0, alice.address, 0);
      const receipt = await tx.wait();
      const tradeArgs = parseTradeEvent(receipt, token);

      expect(tradeArgs.sellsman).to.equal(creator.address);
      expect(tradeArgs.sellsman).to.not.equal(alice.address);
    });

    it("should use passed sellsman as fee recipient after 15s window", async function () {
      const { token, pump, buyer, creator, alice } = await loadFixture(deployTokenFixture);
      const aliceSalt = saltFromNumber(97);
      const createFee = await pump.createFee();
      await createTokenByEvent(pump, alice, "ALC3", aliceSalt, createFee);

      await token.connect(buyer).buyToken(0, ethers.ZeroAddress, 0, { value: toWei(1) });

      const createdAt = await token.createdAt();
      await time.increaseTo(createdAt + 16n); // 超过 15s

      const tx = await token.connect(buyer).buyToken(0, alice.address, 0, { value: toWei(0.5) });
      const receipt = await tx.wait();
      const tradeArgs = parseTradeEvent(receipt, token);

      expect(tradeArgs.sellsman).to.equal(alice.address);
    });

    it("should use passed sellsman as fee recipient for sell after 15s window", async function () {
      const { token, pump, buyer, creator, alice } = await loadFixture(deployTokenFixture);
      const aliceSalt = saltFromNumber(96);
      const createFee = await pump.createFee();
      await createTokenByEvent(pump, alice, "ALC4", aliceSalt, createFee);

      await token.connect(buyer).buyToken(0, ethers.ZeroAddress, 0, { value: toWei(1) });

      const createdAt = await token.createdAt();
      await time.increaseTo(createdAt + 16n);

      const sellAmount = (await token.balanceOf(buyer.address)) / 2n;
      const tx = await token.connect(buyer).sellToken(sellAmount, 0, alice.address, 0);
      const receipt = await tx.wait();
      const tradeArgs = parseTradeEvent(receipt, token);

      expect(tradeArgs.sellsman).to.equal(alice.address);
    });
  });
});
