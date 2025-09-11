const { ethers } = require("hardhat");

// TagPoints 合约地址
const TAG_POINTS_ADDRESS = "0x661fC0a052d2A73da9E09a5C67AE6b9c1B5Eb352";

async function main() {
    console.log("开始批量铸造 TagPoints...");
    
    // 获取部署者账户
    const [deployer] = await ethers.getSigners();
    console.log("操作者地址:", deployer.address);
    console.log("操作者余额:", ethers.formatEther(await deployer.provider.getBalance(deployer.address)), "ETH");
    
    // 连接到已部署的合约
    const TagAIPoints = await ethers.getContractFactory("TagAIPoints");
    const tagPoints = TagAIPoints.attach(TAG_POINTS_ADDRESS);
    
    // 验证合约信息
    console.log("\n=== 合约信息 ===");
    console.log("合约地址:", TAG_POINTS_ADDRESS);
    console.log("代币名称:", await tagPoints.name());
    console.log("代币符号:", await tagPoints.symbol());
    console.log("当前总供应量:", ethers.formatEther(await tagPoints.totalSupply()), "TAG-POINTS");
    console.log("管理员地址:", await tagPoints.getAdmin());
    
    // 检查是否为管理员
    const isAdmin = await tagPoints.isAdmin(deployer.address);
    if (!isAdmin) {
        console.error("错误: 当前地址不是管理员，无法铸造代币");
        process.exit(1);
    }
    console.log("✓ 当前地址是管理员，可以铸造代币");
    
    // 定义要铸造的地址和数量
    const recipients = [
        "0xc64D28A9A694e6bC4142Ea43ee2C3c910F135a11",
        "0x1Ed682C307ccA4bDAEa4Adf887156E358b4eD564",
        "0x467af170e71a275e87a4d52f6d1e76ef5e60730b",
        "0x0751Dc13D40AC49C4543033651E548488b03588C",
        "0x8476db5ffe5e06b590b75ccad015a0ef70d8c405",
        "0xa7a8c7af341e620005ca4d179a89c2bbd9c2cf1c",
        "0x5fAe7087C91414c5cfCbd5A9A873317E9659Ae17",
        "0x898cd840f083fe679650c22e075b578adbc82e6d",
        "0xeaa2e9e74f4fd60a197cab3e01abdfafe584f141",
        "0xe851b1f4f99c1f758d74d9b29852d2ad80a3138a",
        "0xA5d970B9c5458Ac60807B3ac613321eA3BA22cbC",
        "0x1cfA05Bc0D83dc0064E6b8EE13d2Db42df2f27C8",
        "0x9de1C75539CE1290Ca8a3BE148041709acdC3E5e",
        "0xaE6C1e0F51AbDA73689A93e18de8c170a12684c6",
        "0xa5f504F3525FDd72F1732f3E3A664E3dc8163632",
        "0x6C152d4B4BcdF4581a5dB8F35D3BA020158B7ae3",
        "0x0acca56980f3b4b9f2dfdd5af45404e413391980",
        "0x68AFFCf58962be5d1E6e332a1B9a369762F1834B",
        "0x796c692D9315Ab5d0ed4206671ec6eb35DA2B954",
        "0x960223A03527DF3Df7b7bf92F9B4041304c97D44",
        "0x19575565297F07b2BAA8e8E4de663287Ec20824d",
        "0xE5c5e84488f87A1DF0Fa19e2263421A144F475BE",
        "0x83e9fc4f3ED63ec08aDb8FAe3CdD198a9D705ffA",
        "0x476FCB0E77bAEF581b0552A7062DEc1432e84ddE",
        "0x6fdf5278883331a8833d71a133d8df1c410dfbe0",
        "0x5119Da5d8763b48953a4b175361E03e6c69C8095",
        "0x979d24ace97500abf9c2c3723eff0fbc4818c959",
        "0x4Eed4F00540d0464022aE9bA05f61eC307b1c784",
        "0xEd0C2B01716C5279AB67bda24b0BDba05225307f",
        "0x0921C23F52C59eaad73332fC59aFC71c939fB96A",
        "0xe02ce48009e3cc1a9910025b5e9115c72fe54c47",
        "0x8bdb95786d269c6ee2c084d00a0ecf81475838ce",
        "0x559290b5D78618F42F15EaD9F1E592a63d27702b",
        "0xafe274b630a69dfafb39bc9fe6a789da494a8600",
        "0xdf5dBB8027eD58951e30805Aef115E7A110f34F7",
        "0xd8c275378A60124943287dC39E6FF438bAc96128",
        "0xD7Fa0B78cc5153f28B305869cC259A831F53bcf4",
        "0x75Debdd11Bc26D7e0822f37b99C229C4Dcb5f63D",
        "0x133fb4a7bd191517dcf97ed5a4c7656580ec460c",
        "0x1b9a2c3b411a7aad0fa8c3f475481ca913eb76a8",
        "0x54a689bd3f49d61bf2e5ed4c06dc55809e423701",
        "0x1E7be31304bc7928E8dee0b6b6ba717Eb41f9c75",
        "0x908B6651822a82E114288ed94F2e00a39Ad69a73",
        "0xa944d3b1a4a020cf42ba57ece587913c97f8aab3",
        "0xBa3BC17B9Dc856F1a62E7151027c892c29C28889",
        "0x4d7919fa37979ac4a742fb3a1428fc39fd66c94d",
        "0x95dabe6cd9a43b4b6bdd570545d8de295995987b",
        "0x4b40afe8f69f748e72d881144dabad49c3ebfb53",
        "0xda9b29a554810b41bbf2e56b67419dd77fe9b366",
        "0x603dc4cc45f76aa1fa5b71765893af21ef4c554b",
        "0x25F5a19Ab90e81Abb0969533f8c41C1483995ae0",
        "0xCeaB4E556BC5148A4288D4C3Cc8E973D286253cd",
        "0xB82aCC230931b72869552C45d08aF462b2d8C92c",
        "0xef0fbb755feed60366dd728bd872d22c0617fc05",
        "0x614dd387F78bC5565924Ca5f582Dd6C3223E4EE6",
        "0xD62997ba2e49869919D67823eDB1929FA1a5a166",
        "0x17FBEb26A9F3393760E3E164be8c45a09D4b83DA",
        "0x48049899020d57f3dcd5bb30ba5fe812ed077bc8",
        "0x3392AA40dB2a408677B034cbFaeB9E5ceB88d29B",
        "0x40dc5596fb2386dcf16411cc267c140493114d5f",
        "0xF8382842C702E8C2967D0e7d911B8f047d71B193",
        "0xD23cDd2267A26F8b8FE198D8054Ec395baffb347",
        "0x2b05dB8fc5268C61663c6841EB079e87Ed741759",
        "0x379C95e14aE2Ac3Ff0A32944147E8E2D9c2669c8",
        "0x9FBcaCd1b6a202AD6db95Bf2D881A302E0958ca0",
        "0x0593c5577F49f83d24479F2F8c1986c040f9CaAe",
        "0xea323DF61612fb3edcd5274c1F2903fd33FD2794",
        "0x9d392b4E01Dd507c6DB7ac6Ac43e2d1Ee3bfA356",
        "0x9DF881cEaDBa329f5be1020166E9b44216D83E00",
        "0xab1aD1C21369C8A2dDDdACF2ca398cc4d48bA045",
        "0x7394a7c1678201B40a3d8a3f3726bDA3373A30F8",
        "0x6c3E0DCc306BC4611942019F13f9A78A9973359a",
        "0x9cF825728488efEB83E009B532BB6Fa7d033C6Fa",
        "0x0Dd7CE0985CB036b742d7D1d88Da92dA94cB6359",
        "0xeC86357a64F5528EE944CC8Db6835c196fe41eD5",
        "0xeF8B8E3c516F7f2a34b59Ab633256DD09AcDda1d",
        "0xD88836A9E4467D84703275616aaB84484595434E",
        "0x5AeFd421716F175c97Ed8E9f84EF5b3A867cFde2",
        "0xE6FD9Ce71A4420584B921693b32f748BD8CEF18C",
        "0xB0BcA5c4C46B626BCAB7d37147b55Ad629d09A3b",
        "0xf9eDaB29a7eE9EB0e7844f1D0734193F8D1F322e",
        "0xE7E0DC167919eeC4857b3D2ED6A88c7F73Cf9588",
        "0x533877f496bdfE8135E3BA0004588Dd989a21380",
        "0x5cdfbf36eca9d86ef1d038f954c1efbb669a6429",
        "0x7f8bd3c2dab0fa4326e4528fb99290f0dc7518e4",
        "0xA2F3C6916ECF8AacB81f8EbcCE515C35F0ad14d2",
        "0x6c3c09f12fd17e2e870335193f5fed18fb16969e",
        "0x94dE98A218c0502B68F309144C42393D149630f4",
        "0x5739056e0501Cc8D7796276F5162BcDE3Dc18B82",
        "0xC3CAa17abf2526a64Dead8436f82f9CB13580409",
        "0xd0284D999985b4b014ffB3fd6b8E63ADE65D6464",
        "0x33BBBdff59CA035aeE3f7b2714847b53FDDB8703",
        "0x75FCe89c0bB82bdB5679Fa64E4b896562Fbf59BD",
        "0x8F3d7Ee05a6114A33116dc38A69B9d9773db0d81",
        "0x01091A1FBC0ff977d279e370Cc8B263De68775db",
        "0x98cE1fb61912Cf8767Bd5A2f7430f9BBa25bC3b4",
        "0xe0a630ca2fbb33cd0ae698f01b2587be278f5a04",
        "0xfcf0e37625cb87fb37eaf17768a45c6fa88464cc",
        "0xE121d71c197075D4e372db453831a8915AEa38Da",
        "0xcd759dc231059c30A27C3e6D0cEbaF11f9Ab836a",
        "0x41912d464060AB60a9FA1643C68C0471D740D9aD",
        "0x2Ed3DF906be89b540486579bD05B23385b31bD8d",
        "0x13143975e826f51963e8ce2416fcee3bac6c9a29",
        "0x3ce32984d94d4c5a47415e02451211a5e03a0576",
        "0x3940349FEBb8183E599836b0667B7B4Bba9722da",
        "0xD5Cad2336CE43055d4a8DbD05D8462287CAAFAbA",
        "0x2825015399419AE5c55D974638E6e45Fa6A74F10",
        "0xB347d10671315F9F9F38CB3a6c2F5908CDe96E28",
        "0x8396e36d84E763F8E0302E6cBb0f6B126f040F78",
        "0xEAa5dd28c4B963faA4bFa04d77ee34A376D85251",
        "0x28ee6D3158EFE109d8118e42E515a27Ac24E5A0f",
        "0xcB7aB7adC1c4701219C4A550452701e05cc248dc",
        "0xeDa4Be1b7a0C33F3C9e06f75cd86D4d829c9818A",
        "0xaF6E6F251B9d42b727856E2393d119404C58c9C9",
        "0x553003366Ea5Eb5585387B3B8DC2Aee0459a19c1",
        "0x9ca6716C04F049BDFB7ff9699a28AE9215bF1B7a",
        "0x3316555649C820062fCaa64d16585dB5431f6aAA",
        "0xebd868d339b875EE1ed14f6Ed88114eFe6253FbC",
        "0x53c236c1773caF96a6697Cef7023e6bc81Cc91B0",
        "0xE94AAa5BAd0751d4ba99480e759E40802F0650F4",
        "0xacee3b5D216926272EF2e51d9971C408d7A4018A",
        "0x24Fd85990a40D8835945beC6E658871AEF56372c",
        "0xd2D120e79aaEcb649F21CAa36Ba819ed171098Af",
        "0x96AAfDA31cF582c1198415aC340095F600791612",
        "0x24839d8eF6DfFc43c0cEe59129C07F79512d0645",
        "0xd07bf38283523B0cCD553FE6bb3CFad223aE6ba2",
        "0x93060F19D2D045c8EBf6ac1b1E9235335F9C0c1A",
        "0x774356798691a37Afe24996Df8069FCAad23980B",
        "0xBC26EDBc3838F6FE443436f50b11a5dA742C9686",
        "0xEaf2306bA3cDb768E11761B618B1aedbe0d3ec32",
        "0xcFE4fa1d01EE3d58F4eAea2dB50eD0364042A536",
        "0x6EcA24B23de8E005f83514Eb0EF246A60a95a749",
        "0xA2852b7ED6Ba0201bb8Da4E7E7dDc3D27fd17C9b",
        "0x1F9a96F59a7A86ee46AEDb7B37F2bD6Eb30495b8",
        "0x01D3A1853419B81c621C302Ec5aF042f82C45829",
        "0x91e5FFe65a0d0B5EAdb205e79139D804F3F86Bc1",
        "0x9B93Dd193FDB2CD8Aa0B8282905f2618674447D0",
        "0xae4901B16336166eB20FfE801B8Ea937fdb02514",
        "0x5153aB6E26bea51Bf80F0D5C7d64096de5e8747c",
        "0x38290AEa4dAfa1eAA7a0B7811C4951f2110650Bd",
        "0xdBD3B159E31818DAB18Db2Da19b8EDbf51D78e7e",
        "0x22a87892427C163eaDBF203b3Eb797AEbBa58Ae5",
        "0x83FA868b57608d7719F0D689dB90c5b83e091637",
        "0xd8AA147E9b455fbc6BCe9F51bF38a738093e0972",
        "0xaD210761bF416503D118F293B7369122dC936748",
        "0x5Ada0F501a8F5D0F6B74800FfB23AB75726A63D3",
        "0x67599d8f9a755e2a5aaFd0468469227af21Cb5c9",
        "0xA593d1113355Ba6135Ffd5998bD2017CA0b9C909",
        "0x7528dD2ad5D54B936516652e01061D9bC7339E7C",
        "0x3c8978F57C3858B1B20734b808a033843E59177D",
        "0xE587645fcb38ecE9418B9977bBcdA6ebE191B7E1",
        "0x89D26EF2C22C11148175f924CaeFBD64eE109CdD",
        "0x4bbde2e1b5adb2f0229136c3822a53e3434fdbd1",
        "0x5428f2E9f768115922F213D73D02209648B12495",
        "0xDF6ec92E450eB826Ca3b50Fb98a2dc8568d4902A",
        "0xe27175ae0eeF7a9dF856Eea194C6F02c705F14ae",
        "0x9797560d7ba5475db9fce8853fb5d0e4ed49bb22",
        "0xEca883F7De0eBc4126c212004D3858fd940d83b8",
        "0x9bdf9fa68b2ebF80851B3158023d84111F2ef9B1",
        "0x723A143543789a661b38DE6A1698C5a223e790aB",
        "0x3c0d93c77ac04824ba67fbb95613720bea4dc8bd",
        "0xddb1859d54e8f5da5da0a719620241a196e312f5",
        "0x3436D3E08f605181BA9C16EBcC625d7CBC37356B",
        "0x0e311c60C7A2a7Dd6193846c2F6eff72EA2235b6",
        "0x7B24039Cea483B05A217c2056e1e6957A9e9F8Bb",
        "0x7ccec7a85cd8e343adcd086dc1d587ed4df8a2b6",
        "0x05Cfee0c478bC24Ca56Bc5a61A014217180fda15",
        "0xBECc58eB2A60e4963ad681285436CC3c7F171322",
        "0x1ee8ae09C3F175948C5d7bDaba47F56c04413FF0",
        "0xb54f575a4e8D3A592B1bff8c9c944E542ebBAb1E",
        "0x9841b5f1318F3DfEA22cc971ae78d7CcC69f72Bb",
        "0xF3418f39d6234216F90b6D82FDB7a88bE8bb9420",
        "0x9E97d5cE664864700590eF45EE153B4557DDD4f5",
        "0xe8Da1Dc45eDaE18543Bf661f763CaF44b605E52d",
        "0xdeA0FE28206C5BAb3bD8689eE36BB029004C79BD",
        "0xB0B7f420A56b5106A8A5Ce1b9463c03d89A2dE4c",
        "0xB97bC50Aa5ae5ad7ff126B789c15C59DcdAb6fD3",
        "0x48746a9e092c369f3635eb007f7b78dF8c814D34",
        "0x0Ca31A41D4De12187aDAca7a44E5e2513e46Fa4E",
        "0x4878406bB236b16573F2509073143618F3ED5889",
        "0xf5a89916eF9e13440f8f81c513f1715200bd1da7",
        "0x24aea31Dd03Dda163e18c376774fFd468754d239",
        "0x73407a238b7D5700ed871235dE027c68ea75A289",
        "0x5D2B0A23eF13009BbF68dFfFF9177c66115DcCd4",
        "0xF1Feee2Be368733153770057285f0d963cbD2d1a",
        "0x65A5B1b7196df89e09C66A1311ed078Adc110D35",
        "0x652c950C2D78E1b1fdE434cF594277e78Be8d132",
        "0x35bb1D9eE0dB2E1075F5aD7a91fa28ff50A513dC",
        "0x18e196468b21bc5a89b66231be35632dc5c4e881",
        "0x060F1CdbC017aD79CFf5f200778867f25C2DaDc0",
        "0x08c7765329d81b57f55bbc3a68e280625d4dbb05",
        "0x74C644C99c80B035a11456dbFeAEa7C1b6e63bB5",
        "0x65506F86fae97D699D571BC1E131260c9CC1e056",
        "0x89b9f7c3C009F662CC04FC912Afd2B746FaF1ff1",
        "0xc4533B76EeDAF32069aE358847eDE144A48001Be",
        "0xAe68A624617E272bEB660b1d3c790D058aD9a776",
        "0x2a6715b79eA9b3617eFEBD5B22a81972026646Eb",
        "0xa7a63e7942fb7674707dfa844997d3886d19704c",
        "0x161f4c0b2942fee7b91bedc518e536c184719a89",
        "0x3c5f3cEc95D38c681C1E20aC7c9ee8B22f9F5880",
        "0x7c88642f2fcc19454fadeb769c52138bc9979ec9",
        "0xa908FCDfD5CEA02dE36200A546B04185740c7cDB",
        "0x0a9cca4f58159b00211e2bd318780fd138013ce8",
        "0x621FF3057dAC65fAF8baBD570218e34B8B41Bc85",
        "0xab1c8986db1942e693ebf7a3e3a14b6b2b3876a3",
        "0xf7b492d71925a89f404cdd6f42c2f349e29d63a9",
        "0x7cae836d7bdac25121b5c8e2c8191c2d5b455bbe",
        "0xab056ce272b3cbbe868750C60b06E230d5Af08F3",
        "0xeBF945BDFAF88DcB28185D6A54D2c14DB255eC97",
        "0x092D754171122Fd70f3AEb8762c368C7276775D0",
        "0x92a1790e0c3609F2D27dDce7342Da81b4bbEA5c3"
    ];
    
    const amounts = Array.from({ length: recipients.length }, () => ethers.parseEther("1718")) // 为每个接收者生成相同的铸造数量
    
    console.log("\n=== 批量铸造信息 ===");
    console.log("接收地址数量:", recipients.length);
    console.log("总铸造数量:", ethers.formatEther(amounts.reduce((sum, amount) => sum + amount, 0n)), "TAG-POINTS");
    
    
    // 执行批量铸造
    console.log("\n=== 开始批量铸造 ===");
    try {
        const tx = await tagPoints.batchMint(recipients, amounts);
        console.log("交易哈希:", tx.hash);
        console.log("等待交易确认...");
        
        const receipt = await tx.wait();
        console.log("交易确认! Gas 使用:", receipt.gasUsed.toString() / 1e18, "ETH");
        
        // 显示新的总供应量
        const newTotalSupply = await tagPoints.totalSupply();
        console.log("\n新的总供应量:", ethers.formatEther(newTotalSupply), "TAG-POINTS");
        
        console.log("\n✅ 批量铸造完成!");
        
    } catch (error) {
        console.error("❌ 批量铸造失败:", error.message);
        
        // 如果是特定错误，提供更详细的错误信息
        if (error.message.includes("OnlyAdmin")) {
            console.error("错误: 只有管理员可以铸造代币");
        } else if (error.message.includes("InvalidAddress")) {
            console.error("错误: 包含无效地址");
        } else if (error.message.includes("ArrayLengthMismatch")) {
            console.error("错误: 地址和数量数组长度不匹配");
        } else if (error.message.includes("ZeroAmount")) {
            console.error("错误: 包含零数量");
        } else if (error.message.includes("MaxSupplyReached")) {
            console.error("错误: 超过最大供应量限制");
        }
        
        process.exit(1);
    }
}

// 单个地址铸造函数
async function mintSingle(recipient, amount) {
    console.log(`\n开始单个铸造: ${recipient} - ${ethers.formatEther(amount)} TAG-POINTS`);
    
    const [deployer] = await ethers.getSigners();
    const TagAIPoints = await ethers.getContractFactory("TagAIPoints");
    const tagPoints = TagAIPoints.attach(TAG_POINTS_ADDRESS);
    
    try {
        const tx = await tagPoints.mint(recipient, amount);
        console.log("交易哈希:", tx.hash);
        
        const receipt = await tx.wait();
        console.log("交易确认! Gas 使用:", receipt.gasUsed.toString());
        
        const balance = await tagPoints.balanceOf(recipient);
        console.log(`铸造后余额: ${ethers.formatEther(balance)} TAG-POINTS`);
        
        console.log("✅ 单个铸造完成!");
        
    } catch (error) {
        console.error("❌ 单个铸造失败:", error.message);
        throw error;
    }
}

// 如果直接运行此脚本
if (require.main === module) {
    main()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error("脚本执行失败:", error);
            process.exit(1);
        });
}

module.exports = {
    main,
    mintSingle,
    TAG_POINTS_ADDRESS
};
