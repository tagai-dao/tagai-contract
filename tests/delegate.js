const { expect } = require("chai");
const { ethers } = require("hardhat");


let Delegate;
let delegate;
let owner;
let delegate1;
let delegate2;
let token;

describe("Delegate", function () {
    beforeEach(async function () {
        [owner, delegate1, delegate2] = await ethers.getSigners();

        // 部署测试代币合约
        const Token = await ethers.getContractFactory("TestERC20");
        token = await Token.deploy();
        console.log("deploy token:", token.target);

        // 部署Delegate合约
        Delegate = await ethers.getContractFactory("Delegate");
        delegate = await Delegate.deploy();
        console.log("deploy delegate:", delegate.target);
        // 给测试账户分配代币
        await token.transfer(delegate1.address, ethers.parseEther("1000"));
    });


    describe("createDelegate", function () {
        it("Should create a new delegate", async function () {
            const commissionRate = 1000; // 佣金比例（例如：1000 表示 10%）
            const tokenAddress = token.target; // 代币地址

            await expect(delegate.connect(delegate1).createDelegate(commissionRate, tokenAddress))
                .to.emit(delegate, "DelegateCreated")
                .withArgs(delegate1.address, commissionRate, tokenAddress);

            const delegateInfo = await delegate.delegates(delegate1.address);
            expect(delegateInfo.commissionRate).to.equal(commissionRate);
            expect(delegateInfo.token).to.equal(tokenAddress);
            expect(delegateInfo.delegateAddress).to.equal(delegate1.address);
            expect(delegateInfo.exists).to.equal(true);
        });
    });

    describe("Delegation", function () {
        it("Should allow delegating tokens", async function () {
            const amount = ethers.parseEther("100");

            await expect(delegate.connect(delegate1).createDelegate(1000, token.target))
                .to.emit(delegate, "DelegateCreated")
                .withArgs(delegate1.address, 1000, token.target);

            // 授权Delegate合约可以转移代币
            await token.connect(owner).approve(delegate.target, amount);

            console.log("delegate1:", delegate1.address, "token.target:", token.target);
            // 执行委托
            await expect(delegate.connect(owner).delegate(delegate1.address, token.target, amount))
                .to.emit(delegate, "Delegated")
                .withArgs(owner.address, delegate1.address, token.target, amount);

            // 验证委托记录
            const delegations = await delegate.getDelegationsByDelegate(delegate1.address, token.target);
            expect(delegations[0].delegator).to.equal(owner.address);
            expect(delegations[0].delegate).to.equal(delegate1.address);
            expect(delegations[0].token).to.equal(token.target);
            expect(delegations[0].amount).to.equal(amount);
        });
    });

    describe("Cancel Delegation", function () {
        it("Should allow canceling delegation", async function () {
            const amount = ethers.parseEther("100");

            await expect(delegate.connect(delegate1).createDelegate(1000, token.target))
                .to.emit(delegate, "DelegateCreated")
                .withArgs(delegate1.address, 1000, token.target);

            // 先创建委托
            await token.connect(owner).approve(delegate.target, amount);
            await delegate.connect(owner).delegate(delegate1.address, token.target, amount);

            // 取消委托
            await expect(delegate.connect(owner).cancelDelegation(delegate1.address, token.target, amount))
                .to.emit(delegate, "DelegationCanceled")
                .withArgs(owner.address, delegate1.address, token.target, amount);

            // 验证取消状态
            const delegations = await delegate.getDelegationsByDelegate(delegate1.address, token.target);
            expect(delegations[0].canceledAmount).to.equal(amount);
            expect(delegations[0].cancelTimestamp).to.be.gt(0);
        });
    });

    describe("Claim Canceled Delegation", function () {
        it("Should allow claiming canceled tokens", async function () {
            const amount = ethers.parseEther("100");

            await expect(delegate.connect(delegate1).createDelegate(1000, token.target))
                .to.emit(delegate, "DelegateCreated")
                .withArgs(delegate1.address, 1000, token.target);

            // 创建并取消委托
            await token.connect(owner).approve(delegate.target, amount);
            await delegate.connect(owner).delegate(delegate1.address, token.target, amount);
            await delegate.connect(owner).cancelDelegation(delegate1.address, token.target, amount);

            // 修改块时间
            await network.provider.send("evm_increaseTime", [37 * 60 * 60]);
            // 领取取消的代币
            const initialBalance = await token.balanceOf(owner.address);
            await delegate.connect(owner).claimCanceledDelegation(delegate1.address, token.target);

            // 验证余额变化
            const finalBalance = await token.balanceOf(owner.address);
            expect(finalBalance-initialBalance).to.equal(amount);
        });
    });
});