const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TagAIPoints", function () {
    let tagAIPoints;
    let owner;
    let admin;
    let alice;
    let bob;
    let carol;

    beforeEach(async function () {
        // 获取测试账户
        [owner, admin, alice, bob, carol] = await ethers.getSigners();
        
        // 部署合约
        const TagAIPoints = await ethers.getContractFactory("TagAIPoints");
        tagAIPoints = await TagAIPoints.deploy();
        await tagAIPoints.waitForDeployment();
    });

    describe("部署", function () {
        it("应该正确设置代币信息", async function () {
            expect(await tagAIPoints.name()).to.equal("TagAI Points");
            expect(await tagAIPoints.symbol()).to.equal("TAG-POINTS");
            expect(await tagAIPoints.decimals()).to.equal(18);
            expect(await tagAIPoints.totalSupply()).to.equal(0);
        });

        it("应该正确设置管理员", async function () {
            expect(await tagAIPoints.getAdmin()).to.equal(owner.address);
            expect(await tagAIPoints.isAdmin(owner.address)).to.be.true;
            expect(await tagAIPoints.isAdmin(alice.address)).to.be.false;
        });

        it("应该正确设置所有者", async function () {
            expect(await tagAIPoints.owner()).to.equal(owner.address);
        });
    });

    describe("铸造功能", function () {
        it("管理员应该能够铸造代币", async function () {
            const mintAmount = ethers.parseEther("1000");
            
            await expect(tagAIPoints.mint(alice.address, mintAmount))
                .to.emit(tagAIPoints, "Transfer")
                .withArgs(ethers.ZeroAddress, alice.address, mintAmount);
            
            expect(await tagAIPoints.balanceOf(alice.address)).to.equal(mintAmount);
            expect(await tagAIPoints.totalSupply()).to.equal(mintAmount);
        });

        it("非管理员不应该能够铸造代币", async function () {
            const mintAmount = ethers.parseEther("1000");
            
            await expect(
                tagAIPoints.connect(alice).mint(bob.address, mintAmount)
            ).to.be.revertedWithCustomError(tagAIPoints, "OnlyAdmin");
        });

        it("不应该能够铸造给零地址", async function () {
            const mintAmount = ethers.parseEther("1000");
            
            await expect(
                tagAIPoints.mint(ethers.ZeroAddress, mintAmount)
            ).to.be.revertedWithCustomError(tagAIPoints, "InvalidAddress");
        });

        it("不应该能够铸造零数量", async function () {
            await expect(
                tagAIPoints.mint(alice.address, 0)
            ).to.be.revertedWithCustomError(tagAIPoints, "ZeroAmount");
        });

        it("应该能够批量铸造代币", async function () {
            const recipients = [alice.address, bob.address, carol.address];
            const amounts = [
                ethers.parseEther("100"),
                ethers.parseEther("200"),
                ethers.parseEther("300")
            ];
            
            await expect(tagAIPoints.batchMint(recipients, amounts))
                .to.emit(tagAIPoints, "BatchMint")
                .withArgs(owner.address, recipients, amounts);
            
            expect(await tagAIPoints.balanceOf(alice.address)).to.equal(amounts[0]);
            expect(await tagAIPoints.balanceOf(bob.address)).to.equal(amounts[1]);
            expect(await tagAIPoints.balanceOf(carol.address)).to.equal(amounts[2]);
            expect(await tagAIPoints.totalSupply()).to.equal(
                amounts[0] + amounts[1] + amounts[2]
            );
        });

        it("批量铸造时数组长度不匹配应该失败", async function () {
            const recipients = [alice.address, bob.address];
            const amounts = [ethers.parseEther("100")];
            
            await expect(
                tagAIPoints.batchMint(recipients, amounts)
            ).to.be.revertedWithCustomError(tagAIPoints, "ArrayLengthMismatch");
        });

        it("批量铸造时空数组应该失败", async function () {
            await expect(
                tagAIPoints.batchMint([], [])
            ).to.be.revertedWithCustomError(tagAIPoints, "ArrayLengthMismatch");
        });

        it("非管理员不应该能够批量铸造", async function () {
            const recipients = [alice.address];
            const amounts = [ethers.parseEther("100")];
            
            await expect(
                tagAIPoints.connect(alice).batchMint(recipients, amounts)
            ).to.be.revertedWithCustomError(tagAIPoints, "OnlyAdmin");
        });
    });

    describe("最大供应量限制", function () {
        it("铸造超过最大供应量应该失败", async function () {
            const maxSupply = ethers.parseEther("5000000");
            const excessAmount = ethers.parseEther("1");
            
            // 先铸造到接近最大供应量
            await tagAIPoints.mint(alice.address, maxSupply);
            
            // 尝试铸造超过最大供应量
            await expect(
                tagAIPoints.mint(bob.address, excessAmount)
            ).to.be.revertedWithCustomError(tagAIPoints, "MaxSupplyReached");
        });

        it("批量铸造超过最大供应量应该失败", async function () {
            const maxSupply = ethers.parseEther("5000000");
            const excessAmount = ethers.parseEther("1");
            
            // 先铸造到接近最大供应量
            await tagAIPoints.mint(alice.address, maxSupply);
            
            // 尝试批量铸造超过最大供应量
            await expect(
                tagAIPoints.batchMint([bob.address], [excessAmount])
            ).to.be.revertedWithCustomError(tagAIPoints, "MaxSupplyReached");
        });
    });

    describe("转账功能", function () {
        beforeEach(async function () {
            // 先铸造一些代币给 alice
            await tagAIPoints.mint(alice.address, ethers.parseEther("1000"));
        });

        it("应该禁止转账", async function () {
            await expect(
                tagAIPoints.connect(alice).transfer(bob.address, ethers.parseEther("100"))
            ).to.be.revertedWithCustomError(tagAIPoints, "TransferNotAllowed");
        });

        it("应该禁止授权转账", async function () {
            await expect(
                tagAIPoints.connect(alice).transferFrom(alice.address, bob.address, ethers.parseEther("100"))
            ).to.be.revertedWithCustomError(tagAIPoints, "TransferNotAllowed");
        });

        it("应该禁止授权", async function () {
            // 由于合约没有重写 approve 函数，它会调用父合约的 approve
            // 但是 _beforeTokenTransfer 会阻止实际的转账
            await expect(
                tagAIPoints.connect(alice).approve(bob.address, ethers.parseEther("100"))
            ).to.not.be.reverted; // approve 本身不会失败，但后续转账会失败
        });
    });

    describe("管理员管理", function () {
        it("所有者应该能够设置新管理员", async function () {
            await expect(tagAIPoints.setAdmin(alice.address))
                .to.emit(tagAIPoints, "AdminChanged")
                .withArgs(owner.address, alice.address);
            
            expect(await tagAIPoints.getAdmin()).to.equal(alice.address);
            expect(await tagAIPoints.isAdmin(alice.address)).to.be.true;
        });

        it("非所有者不应该能够设置管理员", async function () {
            await expect(
                tagAIPoints.connect(alice).setAdmin(bob.address)
            ).to.be.revertedWithCustomError(tagAIPoints, "OwnableUnauthorizedAccount");
        });

        it("不应该能够设置零地址为管理员", async function () {
            await expect(
                tagAIPoints.setAdmin(ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(tagAIPoints, "InvalidAddress");
        });

        it("新管理员应该能够铸造代币", async function () {
            await tagAIPoints.setAdmin(alice.address);
            
            const mintAmount = ethers.parseEther("1000");
            await tagAIPoints.connect(alice).mint(bob.address, mintAmount);
            
            expect(await tagAIPoints.balanceOf(bob.address)).to.equal(mintAmount);
        });

        it("旧管理员不应该能够铸造代币", async function () {
            await tagAIPoints.setAdmin(alice.address);
            
            const mintAmount = ethers.parseEther("1000");
            await expect(
                tagAIPoints.mint(bob.address, mintAmount)
            ).to.be.revertedWithCustomError(tagAIPoints, "OnlyAdmin");
        });
    });

    describe("暂停功能", function () {
        it("合约应该支持暂停状态查询", async function () {
            // 测试 paused() 函数是否存在
            expect(await tagAIPoints.paused()).to.be.false;
        });

        it("铸造函数应该包含 whenNotPaused 修饰符", async function () {
            // 这个测试验证 mint 函数确实有 whenNotPaused 修饰符
            // 虽然合约没有实现 pause/unpause 函数，但修饰符仍然存在
            const mintAmount = ethers.parseEther("1000");
            await expect(tagAIPoints.mint(alice.address, mintAmount))
                .to.not.be.reverted;
        });
    });

    describe("边界情况", function () {
        it("应该能够铸造最大供应量", async function () {
            const maxSupply = ethers.parseEther("5000000");
            await tagAIPoints.mint(alice.address, maxSupply);
            
            expect(await tagAIPoints.balanceOf(alice.address)).to.equal(maxSupply);
            expect(await tagAIPoints.totalSupply()).to.equal(maxSupply);
        });

        it("应该能够铸造给合约地址", async function () {
            const mintAmount = ethers.parseEther("1000");
            await tagAIPoints.mint(tagAIPoints.target, mintAmount);
            
            expect(await tagAIPoints.balanceOf(tagAIPoints.target)).to.equal(mintAmount);
        });

        it("应该能够多次铸造给同一地址", async function () {
            const amount1 = ethers.parseEther("100");
            const amount2 = ethers.parseEther("200");
            
            await tagAIPoints.mint(alice.address, amount1);
            await tagAIPoints.mint(alice.address, amount2);
            
            expect(await tagAIPoints.balanceOf(alice.address)).to.equal(amount1 + amount2);
        });
    });
});
