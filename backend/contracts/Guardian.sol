// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./LeverageManager.sol";
import "./MockPriceOracle.sol";

/**
 * @title Guardian
 * @dev Monitors position health and emits risk events.
 */
contract Guardian {
    LeverageManager public manager;
    MockPriceOracle public oracle;

    enum RiskLevel { Safe, Warning, Critical, ImmediateRisk }

    /**
     * @dev Emitted when a position's risk level changes.
     * This will be our `riskStream`.
     */
    event RiskThresholdBreach(uint positionId, RiskLevel riskLevel);

    constructor(address _manager, address _oracle) {
        manager = LeverageManager(_manager);
        oracle = MockPriceOracle(_oracle);
    }

    /**
     * @dev Checks the risk for a specific position.
     * The frontend will call this to trigger the event for the demo.
     */
    function checkRisk(uint _positionId) external {
        uint healthFactor = manager.getHealthFactor(_positionId);
        
        // Health Factor from LeverageManager is a % (18 decimals)
        // 1.0 (1 * 10**18) = at entry price
        // 0.0 (0) = at liquidation
        // PRD's levels:
        // 🔴 Immediate Risk (<5% from liq) -> Health < 0.05
        // 🟠 Critical (5-10% from liq) -> Health < 0.10
        // 🟡 Warning (10-20% from liq) -> Health < 0.20
        // ⚪ Safe (> 20% from liq) -> Health >= 0.20

        RiskLevel level;

        if (healthFactor < (5 * 10**16)) { // 0.05 * 10**18
            level = RiskLevel.ImmediateRisk;
        } else if (healthFactor < (10 * 10**16)) { // 0.10 * 10**18
            level = RiskLevel.Critical;
        } else if (healthFactor < (20 * 10**16)) { // 0.20 * 10**18
            level = RiskLevel.Warning;
        } else {
            level = RiskLevel.Safe;
        }

        emit RiskThresholdBreach(_positionId, level);
    }
}