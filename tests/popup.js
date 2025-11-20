const { expect } = require("chai");
const { ethers } = require("hardhat");
const { parseAmount, getEthBalance } = require("./helper");

describe("PopUp Contract", function () {
    let PopUp;
    let popUp;
    let TestERC20;
    let token;
    let owner;
    let feeReceiver;
    let claimSigner;
    let user;
    let otherAccount;
    let chainId;

    const CLAIM_FEE = parseAmount(0.0005);

    beforeEach(async function () {
        [owner, feeReceiver, claimSigner, user, otherAccount] = await ethers.getSigners();

        // Deploy PopUp contract
        PopUp = await ethers.getContractFactory("PopUp");
        popUp = await PopUp.deploy();
        await popUp.waitForDeployment(); // Ethers v6

        // Configure PopUp
        await popUp.adminChangeFeeAddress(feeReceiver.address);
        await popUp.adminChangeClaimSigner(claimSigner.address);

        // Deploy TestERC20 token
        TestERC20 = await ethers.getContractFactory("TestERC20");
        token = await TestERC20.deploy();
        await token.waitForDeployment();

        // Fund PopUp contract with tokens
        await token.transfer(popUp.target, parseAmount(10000));

        // Get Chain ID
        const network = await ethers.provider.getNetwork();
        chainId = network.chainId;
    });

    async function getSignature(signer, tokenAddr, orderId, userAddr, amount) {
        const messageHash = ethers.solidityPackedKeccak256(
            ['uint256', 'address', 'uint256', 'address', 'uint256'],
            [chainId, tokenAddr, orderId, userAddr, amount]
        );
        return await signer.signMessage(ethers.getBytes(messageHash));
    }

    describe("Configuration", function () {
        it("Should set the correct initial values", async function () {
            expect(await popUp.feeReceiver()).to.equal(feeReceiver.address);
            expect(await popUp.claimSigner()).to.equal(claimSigner.address);
            expect(await popUp.claimFee()).to.equal(CLAIM_FEE);
        });

        it("Should allow owner to change claim fee", async function () {
            const newFee = parseAmount(0.001);
            await popUp.adminSetClaimFee(newFee);
            expect(await popUp.claimFee()).to.equal(newFee);
        });
    });

    describe("User Claim", function () {
        const orderId = 12345;
        const amount = parseAmount(100);

        it("Should allow user to claim tokens with valid signature and fee", async function () {
            const signature = await getSignature(claimSigner, token.target, orderId, user.address, amount);
            
            const initialUserBalance = await token.balanceOf(user.address);
            const initialFeeReceiverBalance = await getEthBalance(feeReceiver.address);

            await expect(popUp.connect(user).userClaim(token.target, orderId, amount, signature, { value: CLAIM_FEE }))
                .to.emit(popUp, "UserClaimReward")
                .withArgs(token.target, orderId, user.address, amount);

            // Check token balance
            expect(await token.balanceOf(user.address)).to.equal(initialUserBalance + amount);

            // Check fee receiver ETH balance
            expect(await getEthBalance(feeReceiver.address)).to.equal(initialFeeReceiverBalance + CLAIM_FEE);

            // Check order status
            expect(await popUp.claimedOrder(token.target, orderId)).to.be.true;
        });

        it("Should refund excess ETH fee", async function () {
            const signature = await getSignature(claimSigner, token.target, orderId, user.address, amount);
            const excessAmount = parseAmount(1); // Send 1 ETH, fee is 0.0005
            
            const initialUserEth = await getEthBalance(user.address);
            
            const tx = await popUp.connect(user).userClaim(token.target, orderId, amount, signature, { value: excessAmount });
            const receipt = await tx.wait();
            
            const gasUsed = receipt.gasUsed * receipt.gasPrice;
            const finalUserEth = await getEthBalance(user.address);

            // User spent: fee + gas. Should get back (excessAmount - fee)
            // Final = Initial - fee - gas
            // Or: Final = Initial - excessAmount + (excessAmount - fee) - gas = Initial - fee - gas
            expect(finalUserEth).to.closeTo(initialUserEth - CLAIM_FEE - gasUsed, parseAmount("0.0000001"));
            
            // Check fee receiver only got the fee
            // We rely on the previous test for fee receiver check, but let's verify contract doesn't keep the rest
            expect(await getEthBalance(popUp.target)).to.equal(0);
        });

        it("Should fail with invalid signature", async function () {
            // Sign with wrong signer (owner instead of claimSigner)
            const signature = await getSignature(owner, token.target, orderId, user.address, amount);
            
            await expect(popUp.connect(user).userClaim(token.target, orderId, amount, signature, { value: CLAIM_FEE }))
                .to.be.revertedWithCustomError(popUp, "InvalidSignature");
        });

        it("Should fail if fee is insufficient", async function () {
            const signature = await getSignature(claimSigner, token.target, orderId, user.address, amount);
            
            await expect(popUp.connect(user).userClaim(token.target, orderId, amount, signature, { value: parseAmount(0.0001) }))
                .to.be.revertedWithCustomError(popUp, "CostFeeFail");
        });

        it("Should fail if order is already claimed", async function () {
            const signature = await getSignature(claimSigner, token.target, orderId, user.address, amount);
            
            await popUp.connect(user).userClaim(token.target, orderId, amount, signature, { value: CLAIM_FEE });

            await expect(popUp.connect(user).userClaim(token.target, orderId, amount, signature, { value: CLAIM_FEE }))
                .to.be.revertedWithCustomError(popUp, "ClaimOrderExist");
        });

        it("Should fail if parameters mismatch signature", async function () {
            const signature = await getSignature(claimSigner, token.target, orderId, user.address, amount);
            
            // Wrong amount
            await expect(popUp.connect(user).userClaim(token.target, orderId, parseAmount(200), signature, { value: CLAIM_FEE }))
                .to.be.revertedWithCustomError(popUp, "InvalidSignature");
                
            // Wrong orderId
            await expect(popUp.connect(user).userClaim(token.target, orderId + 1, amount, signature, { value: CLAIM_FEE }))
                .to.be.revertedWithCustomError(popUp, "InvalidSignature");
                
            // Wrong token
            await expect(popUp.connect(user).userClaim(otherAccount.address, orderId, amount, signature, { value: CLAIM_FEE }))
                .to.be.revertedWithCustomError(popUp, "InvalidSignature");

            // Wrong user (msg.sender mismatch)
            await expect(popUp.connect(otherAccount).userClaim(token.target, orderId, amount, signature, { value: CLAIM_FEE }))
                .to.be.revertedWithCustomError(popUp, "InvalidSignature");
        });
    });

    describe("Emergency Withdraw", function () {
        it("Should allow owner to withdraw ETH", async function () {
            // Send some ETH to contract
            const sendAmount = parseAmount(1);
            await owner.sendTransaction({ to: popUp.target, value: sendAmount });
            
            const initialOwnerBalance = await getEthBalance(owner.address);
            
            const tx = await popUp.withdrawETH(owner.address, sendAmount);
            const receipt = await tx.wait();
            const gasUsed = receipt.gasUsed * receipt.gasPrice;

            const finalOwnerBalance = await getEthBalance(owner.address);
            
            expect(finalOwnerBalance).to.equal(initialOwnerBalance + sendAmount - gasUsed);
            expect(await getEthBalance(popUp.target)).to.equal(0);
        });

        it("Should allow owner to withdraw Tokens", async function () {
            const initialOwnerTokenBalance = await token.balanceOf(owner.address);
            const contractTokenBalance = await token.balanceOf(popUp.target);
            
            await popUp.withdrawToken(token.target, owner.address, contractTokenBalance);
            
            expect(await token.balanceOf(popUp.target)).to.equal(0);
            expect(await token.balanceOf(owner.address)).to.equal(initialOwnerTokenBalance + contractTokenBalance);
        });

        it("Should fail if non-owner tries to withdraw", async function () {
            await expect(popUp.connect(user).withdrawETH(user.address, parseAmount(0.1)))
                .to.be.revertedWithCustomError(popUp, "OwnableUnauthorizedAccount");
                
            await expect(popUp.connect(user).withdrawToken(token.target, user.address, parseAmount(100)))
                .to.be.revertedWithCustomError(popUp, "OwnableUnauthorizedAccount");
        });
    });
});

