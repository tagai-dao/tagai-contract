const { ethers } = require('hardhat');

async function main() {
    console.log('Starting deployment of OracleDistribution...');
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with the account:", deployer.address);
    console.log("Account balance:", (await deployer.provider.getBalance(deployer.address)).toString());

    const OracleDistribution = await ethers.getContractFactory("OracleDistribution");
    const oracleDistribution = await OracleDistribution.deploy();

    await oracleDistribution.waitForDeployment();

    console.log("OracleDistribution deployed to:", oracleDistribution.target);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
