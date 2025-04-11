const hh = require('hardhat');
const { ethers } = require("ethers");
const { ArgumentParser } = require('argparse');

const parser = new ArgumentParser({
    description: 'Deploy ERC20 Token'
});
parser.add_argument('-N', '--name', { help: 'Token name', type: "str", default: "Test" });
parser.add_argument('-S', '--symbol', { help: 'Token symbol', type: "str", default: "T1" });
parser.add_argument('-W', '--network', { help: 'network', type: "str", default: "hardhat" });
let args = parser.parse_args();

console.log(`The token will be deployed:`, args.name, args.symbol)

async function main() {
    const netConf = hh.config.networks[args.network];
    if (!netConf) throw new Error(`Unknown network: ${args.network}`);

    const provider = new ethers.JsonRpcProvider(netConf.url);
    let wallet;
    if (Array.isArray(netConf.accounts)) {
        wallet = new ethers.Wallet(netConf.accounts[0], provider);
    } else {
        [wallet] = await hh.ethers.getSigners()
    }


    console.log("deployer:", wallet.address, 'balance:', await wallet.provider.getBalance(wallet.address), '\n', await wallet.provider.getFeeData())

    const TokenFactory = await hh.ethers.getContractFactory("TestERC20", wallet);
    const token = await TokenFactory.deploy(args.name, args.symbol);
    console.log("Token contract:", token.target)
}

main().catch(error => {
    console.error(error)
}).finally(process.exit)