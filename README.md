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

更换了bonding curve为y=a*exp(x/b)
list的dex换成uni v3


### Contract -- X-layer
```javascript
IPShare:0x7B0ddC305C32AAEbabc0FE372a4460e9903e95D0
Pump:0xa77253Ac630502A35A6FcD210A01f613D33ba7cD
WrppedUniV2ForTagAI: 0x0B6e5e9544DED2a3bB5be553E6b570E2eA97B77e
CoinPurse: 0xd64a6FA17AdcD5E1be23e1378E35F64f47926Dd7
Pump2: 0xfDd9846edE599283b9BFA6de4539D0D7d0eE6B78
```
