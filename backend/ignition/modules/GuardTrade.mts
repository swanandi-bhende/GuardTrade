import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const GuardTradeModule = buildModule("GuardTradeModule", (m) => {
  // Deploy the MockPriceOracle first
  const oracle = m.contract("MockPriceOracle", []);

  // Deploy the LeverageManager, passing the oracle's address to its constructor
  const manager = m.contract("LeverageManager", [oracle]);

  // Deploy the Guardian, passing both manager and oracle addresses
  const guardian = m.contract("Guardian", [manager, oracle]);

  // Return all deployed contracts
  return { oracle, manager, guardian };
});

export default GuardTradeModule;