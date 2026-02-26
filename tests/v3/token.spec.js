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
});
