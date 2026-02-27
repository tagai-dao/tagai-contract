
require('@nomicfoundation/hardhat-toolbox')
require('hardhat-deploy')
require('hardhat-gas-reporter')
require('dotenv').config();

const enableFork = process.env.ENABLE_FORK === "1";
const forkBlockNumber = 83628324;

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity:
  {
    compilers: [
      {
        version: "0.8.26",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1000
          },
          viaIR: true,
          evmVersion: "cancun"
        }
      },
      {
        version: "0.8.20",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1000
          }
        }
      },
      {
        version: "0.8.13",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1000
          }
        }
      },
      {
        version: "0.5.0",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1000
          }
        }
      },
      {
        version: "0.6.12",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1000
          }
        }
      },
      {
        version: "0.7.6",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1000
          }
        }
      }
    ],
    overrides: {
      "contracts/UniswapV2/SushiswapFactoryV2.sol": {
        version: '0.6.12',
        settings: {
          optimizer: {
            enabled: true,
            runs: 1000
          }
        }
      },
      "contracts/UniswapV2/SushiswapV2Router02.sol": {
        version: '0.6.12',
        settings: {
          optimizer: {
            enabled: true,
            runs: 1000
          }
        }
      }
    }
  },
  namedAccounts: {
    deployer: 0,
    tokenOwner: 1
  },
  networks: {
    hardhat: {
      chainId: enableFork ? 56 : 97,
      hardfork: "cancun",
      forking: enableFork
        ? {
            url: process.env.BSC_RPC_URL || process.env.BSC,
            blockNumber: forkBlockNumber
          }
        : undefined
    },
    base: {
      url: process.env.BASE,
      chainId: 8453,
      accounts: [
        process.env.KEY
      ]
    },
    bitlayer: {
      url: 'https://rpc.bitlayer.org',
      chainId: 200901,
      accounts: [
        process.env.KEY
      ]
    },
    chapel: {
      url: process.env.CHAPEL,
      chainId: 97,
      accounts: [
        process.env.KEY
      ]
    },
    bsc: {
      url: process.env.BSC || process.env.BSC_RPC_URL,
      chainId: 56,
      accounts: [
        process.env.KEY
      ]
    }
  },
  etherscan: {
    apiKey: {
      base: process.env.BASE_API_KEY,
      bsc: process.env.BSC_API_KEY
    }
  },
  // flattenExporter: {
  //   src: "./contracts",
  //   path: "./flat",
  //   clear: true,
  // },
  paths: {
    tests: "./tests"
  },
  // contractSizer: {
  //   alphaSort: false,
  //   runOnCompile: false,
  //   disambiguatePaths: false
  // },
  // allowUnlimitedContractSize: false,
};
