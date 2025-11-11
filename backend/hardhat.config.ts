// 1. Import the dotenv package to read your .env file
import "dotenv/config"; 

import { HardhatUserConfig } from "hardhat/config";

// 2. IMPORT the plugin object instead of using a string
import hardhatToolboxViem from "@nomicfoundation/hardhat-toolbox-viem";

// 3. Get your private key from the .env file
const privateKey = process.env.PRIVATE_KEY;
if (!privateKey) {
  console.warn("PRIVATE_KEY not found in .env file. Deployments will fail.");
}

const config: HardhatUserConfig = {
  // 4. Set the solidity version to match our contracts
  solidity: "0.8.20", 
  
  plugins: [
    // 5. USE the imported plugin object
    hardhatToolboxViem 
  ],
  
  networks: {
    // 6. Add the Somnia Testnet configuration
    somniaTestnet: {
      // 7. ADD the 'type' property
      type: "http", 
      url: process.env.SOMNIA_TESTNET_RPC || "https://dream-rpc.somnia.network/",
      accounts: privateKey ? [privateKey] : [],
      chainId: 50312 // Somnia Testnet Chain ID
    },
    
    // These other networks are fine to keep
    hardhatMainnet: {
        type: "edr-simulated",
        chainType: "l1",
    },
    hardhatOp: {
        type: "edr-simulated",
        chainType: "op",
    },
  },
};

export default config;