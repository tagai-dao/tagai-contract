# Sample Hardhat Project

This project demonstrates a basic Hardhat use case. It comes with a sample contract, a test for that contract, and a Hardhat Ignition module that deploys that contract.

Try running some of the following tasks:

```shell
npx hardhat help
npx hardhat test
REPORT_GAS=true npx hardhat test
npx hardhat node
npx hardhat ignition deploy ./ignition/modules/Lock.js
```

新增用于空投的合约PopUp
逻辑类似Pump合约的领取方式
用户奖励中心化记录，由Tagai和用于共同签名领取
支持链原生代币的空投

### Contract
```javascript
IPShare:0x7B0ddC305C32AAEbabc0FE372a4460e9903e95D0
Pump:0xa77253Ac630502A35A6FcD210A01f613D33ba7cD
PopUp:0xA3951BcEc6018CAAE34dCEA722858a7dc3177Ed2
```
