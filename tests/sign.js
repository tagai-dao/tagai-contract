import { keccak256, AbiCoder, toBigInt, getAddress, toUtf8Bytes } from "ethers";
import pkg from 'hardhat'

const { ethers } = pkg;
// 假设数据
const token = getAddress("0x8e11E90B463bf521382E2B88539F053270a3848c");
const orderId = toBigInt("13114017398451541991");
const amount = toBigInt("113340895344498030000000");
const user = getAddress("0x76B713f30734450CE566C170Fda27E8dce63b1F6")
const chainId = 97

// 正确的 encode（对应 Solidity 的 abi.encode）
const abiCoder = new AbiCoder();
const encoded = abiCoder.encode(
    ['uint256', 'address', 'uint256', 'address', 'uint256'],
    [chainId, token, orderId, user, amount]
);

const encoded2 = ethers.solidityPackedKeccak256(
    ['uint256', 'address', 'uint256', 'address', 'uint256'],
    [chainId, token, orderId, user, amount]
);

async function main() {

    const [signer] = await ethers.getSigners();
    console.log("signer:", signer.address)
    const hash = keccak256(encoded); // 和 Solidity 中 keccak256(abi.encode(...)) 完全一致

    // 然后签名这个 hash
    const signature = await signer.signMessage(ethers.getBytes(hash)); // 注意 hash 是 0x 开头的 hex
    console.log(signature)
}
main()