// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MockPriceOracle
 * @dev A simple mock oracle for the hackathon.
 * It allows anyone to set the price of an asset and emits an event.
 * This event will be picked up by the `priceStream`.
 */
contract MockPriceOracle {
    // We'll just track one asset (e.g., ETH) for the MVP
    // Prices are stored with 8 decimals (e.g., $3,000.00 = 3000 * 10**8)
    mapping(string => uint256) public assetPrices;

    /**
     * @dev Emitted when a price is updated.
     * Somnia Data Streams will listen for this.
     */
    event PriceUpdate(string asset, uint256 price);

    constructor() {
        // Set an initial price for ETH
        assetPrices["ETH"] = 3000 * 10**8;
    }

    /**
     * @dev Sets the price of an asset.
     * In a real app, this would be secured (e.g., `onlyOwner`).
     * For the hackathon, we leave it open to simulate price changes from the frontend.
     */
    function setPrice(string memory _asset, uint256 _price) external {
        assetPrices[_asset] = _price;
        emit PriceUpdate(_asset, _price);
    }

    /**
     * @dev Public function to get the price.
     */
    function getPrice(string memory _asset) public view returns (uint256) {
        return assetPrices[_asset];
    }
}