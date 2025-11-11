// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./MockPriceOracle.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title LeverageManager
 * @dev Manages basic leverage positions.
 * Emits events about position health.
 */
contract LeverageManager is ReentrancyGuard {
    MockPriceOracle public priceOracle;

    enum PositionState { Open, Closed }
    enum PositionType { Long, Short }

    struct Position {
        uint id;
        address owner;
        uint collateral; // 8 decimals
        uint leverage; // e.g., 3x = 3
        uint entryPrice; // 8 decimals
        PositionType positionType;
        PositionState state;
    }

    uint public nextPositionId;
    mapping(uint => Position) public positions;
    mapping(address => uint[]) public userPositions;

    /**
     * @dev Emitted when a position is updated (created, closed, collateral added).
     * This will be our `positionStream`.
     */
    event PositionUpdate(
        uint positionId,
        address owner,
        uint collateral,
        uint healthFactor // 18 decimals
    );

    constructor(address _oracleAddress) {
        priceOracle = MockPriceOracle(_oracleAddress);
    }

    /**
     * @dev Opens a new position.
     * Super simplified for MVP. Assumes collateral (e.g., USDC) is already approved.
     */
    function openPosition(
        uint _collateral,
        uint _leverage,
        PositionType _positionType
    ) external nonReentrant {
        // In a real app, you would pull collateral tokens here.
        // For the MVP, we just record it.

        uint currentPrice = priceOracle.getPrice("ETH");
        require(currentPrice > 0, "Invalid price");

        uint positionId = nextPositionId;
        positions[positionId] = Position({
            id: positionId,
            owner: msg.sender,
            collateral: _collateral,
            leverage: _leverage,
            entryPrice: currentPrice,
            positionType: _positionType,
            state: PositionState.Open
        });

        userPositions[msg.sender].push(positionId);
        nextPositionId++;

        uint health = getHealthFactor(positionId);
        emit PositionUpdate(positionId, msg.sender, _collateral, health);
    }

    /**
     * @dev Calculates the health factor of a position.
     * Simplified for MVP.
     * Health Factor = (CurrentPrice - LiqPrice) / (EntryPrice - LiqPrice)
     */
    function getHealthFactor(uint _positionId) public view returns (uint) {
        Position storage pos = positions[_positionId];
        if (pos.state == PositionState.Closed) return 0;

        uint currentPrice = priceOracle.getPrice("ETH");
        if (currentPrice == 0 || pos.entryPrice == 0) return 1 * 10**18;
        
        uint liqPrice;
        if (pos.positionType == PositionType.Long) {
            // For Long: LP = EntryPrice * (1 - (1 / Leverage))
            liqPrice = pos.entryPrice - (pos.entryPrice / pos.leverage);
        } else {
            // For Short: LP = EntryPrice * (1 + (1 / Leverage))
            liqPrice = pos.entryPrice + (pos.entryPrice / pos.leverage);
        }

        // Health Factor = % distance from liquidation
        int health;
        if (pos.positionType == PositionType.Long) {
            if (currentPrice < liqPrice) return 0;
            // Handle division by zero if entryPrice == liqPrice (e.g., 1x leverage)
            if (int(pos.entryPrice) == int(liqPrice)) return 100 * 10**18; // Infinite health
            health = (int(currentPrice) - int(liqPrice)) * 10**18 / (int(pos.entryPrice) - int(liqPrice));
        } else {
            if (currentPrice > liqPrice) return 0;
            // Handle division by zero
            if (int(liqPrice) == int(pos.entryPrice)) return 100 * 10**18; // Infinite health
            health = (int(liqPrice) - int(currentPrice)) * 10**18 / (int(liqPrice) - int(pos.entryPrice));
        }

        return uint(health);
    }

    /**
     * @dev A function to force-emit a position update.
     */
    function updatePosition(uint _positionId) external {
        Position storage pos = positions[_positionId];
        require(pos.owner == msg.sender, "Not owner");

        uint health = getHealthFactor(_positionId);
        emit PositionUpdate(_positionId, msg.sender, pos.collateral, health);
    }
}