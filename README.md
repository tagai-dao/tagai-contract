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

可以支持外部导入代币进行社交分发
项目方随时向合约注入社交资金供用户领取
项目方可以多次设置阶段性分发策略


### Contract
```javascript
IPShare:0x7B0ddC305C32AAEbabc0FE372a4460e9903e95D0
Pump:0xa77253Ac630502A35A6FcD210A01f613D33ba7cD
SocialDistribution: 0x201308B193bC0Aa81Ac540A7D3B3ADb530a39861
```
