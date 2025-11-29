# GuardTrade: Automated Risk-Protected Leverage Trading
---

## ✨ Overview

GuardTrade is a decentralized application built on the Somnia Testnet that facilitates leveraged trading with a unique focus on capital preservation. 

Unlike traditional margin trading platforms, GuardTrade incorporates a "Guardian" system—a smart contract layer that monitors position health in real-time. 

It integrates an automated protection mechanism and an Insurance Vault designed to prevent liquidations by injecting collateral or adjusting positions when critical risk thresholds are breached.



### 👉🏻 Website Link
Try out the website here: https://guardtrade.vercel.app/


### 👉🏻 Demo Video
Watch the full demo here: https://youtu.be/HTlahrVWK6U

---

## ✨ Key Features

- **Guardian Protection System:** Automated smart contract monitoring that tracks position health factors and triggers alerts.
- **Leveraged Trading:** Support for Long and Short positions on assets (e.g., ETH, BTC) with adjustable leverage (1x to 10x).
- **Insurance Vault:** A specialized liquidity pool utilized to auto-inject collateral into positions nearing liquidation.
- **Real-Time Analytics:** Live PnL calculations, dynamic health factor visualization, and sparkline charts for price history.
- **Demo Simulation:** Integrated tools to simulate market price movements and test risk protocol responses in a sandbox environment.

---

## ✨ Key Integrations

| Integration | Description |
|--------------|-------------|
| **Somnia Testnet** | High-performance blockchain infrastructure (Chain ID: 50312) |
| **Viem** | TypeScript interface for Ethereum interactions |
| **Tailwind CSS** | Utility-first CSS framework for styling |
| **Guardian Contract** | Custom smart contract for risk monitoring |

---

## ✨ Prerequisites

Before running this project, ensure you have:

- **Node.js 18+** installed
- **npm** or **yarn** package manager
- **MetaMask** browser extension installed
- **Somnia Testnet** network configured in your wallet

---

## ✨ Quick Start

### 1️. Clone the Repository

```bash
git clone <repository_url>
cd GuardTrade
```

### 2️. Install Dependencies
```bash
npm install
```

### 3. Application Configuration
The smart contract addresses are currently pre-configured for the Somnia Testnet within App.jsx. If deploying custom contracts, update the CONTRACT_ADDRESSES object in the source code.

### 4. Run the Application
```bash
npm run dev
```

Open http://localhost:5173 (or the port specified in your console) in your browser.

---

## ✨ How to Use
### Connectivity
1. Launch the application.
2. Enter a username for the session.
3. Click Connect Wallet. Ensure your MetaMask is set to the Somnia Testnet.

### Opening a Position

1. Click Open Protected Position.
2. Setup: Select the Asset (ETH/BTC), Position Type (Long/Short), Leverage (1x-10x), and Collateral amount.
3. Protection: Configure the Guardian settings (Auto-Add Collateral, Emergency Close, Insurance Vault access).
4. Confirm: Review the Liquidation Price and approve the transaction.

### Monitoring and Management

- Active Positions: View real-time PnL, Health Factor, and Liquidation distance in the dashboard table.
- Risk Alerts: The sidebar displays active alerts (Warning/Critical) triggered by the Guardian contract.
- Closing Positions: Manually close positions to realize profits or losses. Closed positions are moved to the History tab.

### Simulation Tools

Use the Demo Controls in the sidebar to simulate price changes for the underlying asset (e.g., simulate ETH dropping to $2,400). This allows you to observe how the Guardian contract reacts to sudden market drops or spikes without waiting for actual market data.

---

## ✨ Development Scripts

```bash
npm run dev      # Start development server
npm run build    # Build for production
npm run preview  # Preview production build
```

---

## ✨ Technology Stack

### Frontend
- React.js
- Tailwind CSS
- Viem (Blockchain Interaction)
- Custom SVG Sparklines

### Blockchain
- Somnia Testnet
- Solidity Smart Contracts (MockPriceOracle, LeverageManager, Guardian)

---

## ✨ Future Improvements
### User Experience
- Integration with TradingView for advanced technical analysis
- Multi-asset support (ERC-20 tokens)
- Mobile-responsive design improvements

### Governance
- Implementation of a DAO for managing Insurance Vault parameters
- Community voting on risk thresholds

### Deployment
- Migration from Somnia Testnet to Mainnet
- Smart Contract Audits

---

## ✨ License
This project is licensed under the MIT License — see the LICENSE file for details.
