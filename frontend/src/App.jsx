import { useState, useEffect } from 'react';
import { SDK } from '@somnia-chain/streams';
import { createPublicClient, http, defineChain, createWalletClient, custom } from 'viem';
import { ethers } from 'ethers';

// --- ABIs (Manually copy these from your artifacts/contracts/...) ---
// I've pasted them here for you to make the hackathon setup faster.

const PriceOracleABI = {
  abi: [{"inputs":[],"stateMutability":"nonpayable","type":"constructor"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"string","name":"asset","type":"string"},{"indexed":false,"internalType":"uint256","name":"price","type":"uint256"}],"name":"PriceUpdate","type":"event"},{"inputs":[{"internalType":"string","name":"","type":"string"}],"name":"assetPrices","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"string","name":"_asset","type":"string"}],"name":"getPrice","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"string","name":"_asset","type":"string"},{"internalType":"uint256","name":"_price","type":"uint256"}],"name":"setPrice","outputs":[],"stateMutability":"nonpayable","type":"function"}]
};
const LeverageManagerABI = {
  abi: [{"inputs":[{"internalType":"address","name":"_oracleAddress","type":"address"}],"stateMutability":"nonpayable","type":"constructor"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"uint256","name":"positionId","type":"uint256"},{"indexed":false,"internalType":"address","name":"owner","type":"address"},{"indexed":false,"internalType":"uint256","name":"collateral","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"healthFactor","type":"uint256"}],"name":"PositionUpdate","type":"event"},{"inputs":[{"internalType":"uint256","name":"_positionId","type":"uint256"}],"name":"getHealthFactor","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"nextPositionId","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"_collateral","type":"uint256"},{"internalType":"uint256","name":"_leverage","type":"uint256"},{"internalType":"enum LeverageManager.PositionType","name":"_positionType","type":"uint8"}],"name":"openPosition","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256","name":"","type":"uint256"}],"name":"positions","outputs":[{"internalType":"uint256","name":"id","type":"uint256"},{"internalType":"address","name":"owner","type":"address"},{"internalType":"uint256","name":"collateral","type":"uint256"},{"internalType":"uint256","name":"leverage","type":"uint256"},{"internalType":"uint256","name":"entryPrice","type":"uint256"},{"internalType":"enum LeverageManager.PositionType","name":"positionType","type":"uint8"},{"internalType":"enum LeverageManager.PositionState","name":"state","type":"uint8"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"priceOracle","outputs":[{"internalType":"contract MockPriceOracle","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"_positionId","type":"uint256"}],"name":"updatePosition","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"","type":"address"},{"internalType":"uint256","name":"","type":"uint256"}],"name":"userPositions","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"}]
};
const GuardianABI = {
  abi: [{"inputs":[{"internalType":"address","name":"_manager","type":"address"},{"internalType":"address","name":"_oracle","type":"address"}],"stateMutability":"nonpayable","type":"constructor"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"uint256","name":"positionId","type":"uint256"},{"indexed":false,"internalType":"enum Guardian.RiskLevel","name":"riskLevel","type":"uint8"}],"name":"RiskThresholdBreach","type":"event"},{"inputs":[{"internalType":"uint256","name":"_positionId","type":"uint256"}],"name":"checkRisk","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"manager","outputs":[{"internalType":"contract LeverageManager","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"oracle","outputs":[{"internalType":"contract MockPriceOracle","name":"","type":"address"}],"stateMutability":"view","type":"function"}]
};
// --- END ABIs ---


// --- 1. CRITICAL: CONFIGURE YOUR CONTRACTS & NETWORK ---
const CONTRACT_ADDRESSES = {
  oracle: 'YOUR_MockPriceOracle_ADDRESS_HERE',   // <-- PASTE YOUR ADDRESS
  manager: 'YOUR_LeverageManager_ADDRESS_HERE', // <-- PASTE YOUR ADDRESS
  guardian: 'YOUR_Guardian_ADDRESS_HERE'        // <-- PASTE YOUR ADDRESS
};

// Somnia Testnet Configuration (from docs)
const somniaTestnet = defineChain({
  id: 50312,
  name: 'Somnia Testnet',
  nativeCurrency: { name: 'STT', symbol: 'STT', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://dream-rpc.somnia.network/'] },
  },
  blockExplorers: {
    default: { name: 'Explorer', url: 'https://shannon-explorer.somnia.network/' },
  },
});
// --- END CONFIGURATION ---

// Risk Level Enum for display
const RISK_LEVELS = ["Safe", "Warning", "Critical", "Immediate Risk"];

function App() {
  const [sdk, setSdk] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [account, setAccount] = useState(null);
  const [status, setStatus] = useState('Connecting to Somnia...');

  // Live Data State
  const [livePrice, setLivePrice] = useState(3000);
  const [positions, setPositions] = useState({}); // { id: { ...positionData } }
  const [alerts, setAlerts] = useState({}); // { positionId: "RiskLevel" }

  // --- 2. INITIALIZE SDK & WALLET ---
  useEffect(() => {
    async function init() {
      try {
        // A. Setup Browser Wallet (MetaMask)
        if (!window.ethereum) {
          setStatus('MetaMask not detected. Please install it.');
          return;
        }
        const walletClient = createWalletClient({
          chain: somniaTestnet,
          transport: custom(window.ethereum),
        });
        const [accountAddress] = await walletClient.requestAddresses();
        setAccount(accountAddress);
        setWallet(walletClient);

        // B. Setup Viem Public Client (for reading)
        const publicClient = createPublicClient({
          chain: somniaTestnet,
          transport: http(),
        });

        // C. Initialize Somnia SDK
        const somniaSdk = new SDK({
          public: publicClient,
          // We pass the wallet client for write operations
          wallet: walletClient, 
        });
        setSdk(somniaSdk);
        setStatus('Somnia SDK Initialized. Subscribing to streams...');

        // D. Get initial data
        const initialPrice = await publicClient.readContract({
          address: CONTRACT_ADDRESSES.oracle,
          abi: PriceOracleABI.abi,
          functionName: 'getPrice',
          args: ['ETH']
        });
        setLivePrice(Number(initialPrice) / 10**8);

      } catch (err) {
        console.error("Initialization error:", err);
        setStatus('Error connecting. Check console.');
      }
    }
    init();
  }, []);

  // --- 3. SUBSCRIBE TO STREAMS (THE CORE!) ---
  useEffect(() => {
    if (!sdk || !account) return;
    
    const publicClient = sdk.public; // Get client from SDK

    // A. Price Stream (from PRD)
    // We use viem's watchContractEvent, which is powered by Somnia's fast nodes
    const unsubPrice = publicClient.watchContractEvent({
      address: CONTRACT_ADDRESSES.oracle,
      abi: PriceOracleABI.abi,
      eventName: 'PriceUpdate',
      onLogs: (logs) => {
        logs.forEach(data => {
          if (data.args.asset === 'ETH') {
             console.log("🔥 Price Stream Event:", data);
             const newPrice = Number(data.args.price) / 10**8;
             setLivePrice(newPrice);
          }
        });
      }
    });

    // B. Position Stream (from PRD)
    const unsubPos = publicClient.watchContractEvent({
      address: CONTRACT_ADDRESSES.manager,
      abi: LeverageManagerABI.abi,
      eventName: 'PositionUpdate',
      onLogs: (logs) => {
        logs.forEach(data => {
          // Check if the event is for us
          if (data.args.owner.toLowerCase() === account.toLowerCase()) {
            console.log("🔥 Position Stream Event:", data);
            const { positionId, collateral, healthFactor } = data.args;
            const posId = Number(positionId);
            setPositions(prev => ({
              ...prev,
              [posId]: {
                ...prev[posId], // Keep existing data like entryPrice
                id: posId,
                collateral: Number(collateral) / 10**8,
                healthFactor: Number(healthFactor) / 10**18,
              }
            }));
          }
        });
      }
    });

    // C. Risk Stream (from PRD)
    const unsubRisk = publicClient.watchContractEvent({
      address: CONTRACT_ADDRESSES.guardian,
      abi: GuardianABI.abi,
      eventName: 'RiskThresholdBreach',
      onLogs: (logs) => {
        logs.forEach(data => {
          console.log("🔥 Risk Stream Event:", data);
          const { positionId, riskLevel } = data.args;
          // Check if this alert is for one of our positions
          setPositions(prev => {
            if (prev[Number(positionId)]) {
              setAlerts(prevAlerts => ({
                ...prevAlerts,
                [Number(positionId)]: RISK_LEVELS[Number(riskLevel)]
              }));
            }
            return prev;
          });
        });
      }
    });

    setStatus('✅ Subscribed to Price, Position, and Risk streams!');

    // Cleanup subscriptions
    return () => {
      unsubPrice();
      unsubPos();
      unsubRisk();
    };

  }, [sdk, account]);

  // --- 4. CONTRACT INTERACTION FUNCTIONS ---

  const openPosition = async () => {
    if (!wallet || !account || !sdk) return alert("Wallet not connected");
    setStatus("Opening position...");
    try {
      // 1. Simulate the contract call
      const { request } = await sdk.public.simulateContract({
        account,
        address: CONTRACT_ADDRESSES.manager,
        abi: LeverageManagerABI.abi,
        functionName: 'openPosition',
        args: [
          BigInt(1000 * 10**8), // $1000 collateral
          BigInt(3), // 3x leverage
          0 // PositionType.Long
        ]
      });
      
      // 2. Send the transaction
      const hash = await wallet.writeContract(request);
      setStatus("Transaction sent, awaiting confirmation...");
      
      // 3. Wait for it to be mined
      await sdk.public.waitForTransactionReceipt({ hash });
      
      // We don't need to update state here.
      // The `PositionUpdate` event will fire and our stream will catch it!
      setStatus("Position opened! Stream will update dashboard.");
      
      // As a fallback, let's grab the entry price
      const newPosId = (await sdk.public.readContract({
        address: CONTRACT_ADDRESSES.manager,
        abi: LeverageManagerABI.abi,
        functionName: 'nextPositionId'
      })) - BigInt(1);

      const posData = await sdk.public.readContract({
        address: CONTRACT_ADDRESSES.manager,
        abi: LeverageManagerABI.abi,
        functionName: 'positions',
        args: [newPosId]
      });

      setPositions(prev => ({
        ...prev,
        [Number(newPosId)]: {
          ...prev[Number(newPosId)],
          entryPrice: Number(posData.entryPrice) / 10**8
        }
      }));

    } catch (err) {
      console.error("Open position error:", err);
      setStatus("Error opening position. Check console.");
    }
  };

  const simulatePrice = async (newPrice) => {
    if (!wallet || !account || !sdk) return alert("Wallet not connected");
    setStatus(`Simulating price: $${newPrice}...`);
    try {
      const { request } = await sdk.public.simulateContract({
        account,
        address: CONTRACT_ADDRESSES.oracle,
        abi: PriceOracleABI.abi,
        functionName: 'setPrice',
        args: ['ETH', BigInt(newPrice * 10**8)]
      });
      const hash = await wallet.writeContract(request);
      await sdk.public.waitForTransactionReceipt({ hash });
      
      // The `PriceUpdate` stream will handle the state change.
      setStatus(`Price set to $${newPrice}. Stream will update P&L.`);
    } catch (err) {
      console.error("Simulate price error:", err);
      setStatus("Error setting price. Check console.");
    }
  };

  const checkRisk = async (positionId) => {
    if (!wallet || !account || !sdk) return alert("Wallet not connected");
    setStatus(`Checking risk for position ${positionId}...`);
    try {
      const { request } = await sdk.public.simulateContract({
        account,
        address: CONTRACT_ADDRESSES.guardian,
        abi: GuardianABI.abi,
        functionName: 'checkRisk',
        args: [BigInt(positionId)]
      });
      const hash = await wallet.writeContract(request);
      await sdk.public.waitForTransactionReceipt({ hash });
      
      // The `RiskThresholdBreach` stream will handle the state change.
      setStatus(`Risk check sent. Stream will update alerts.`);
    } catch (err) {
      console.error("Check risk error:", err);
      setStatus("Error checking risk. Check console.");
    }
  };

  // --- 5. HELPER & RENDER FUNCTIONS ---
  
  const getPnl = (position) => {
    if (!position.entryPrice) return 0;
    // PnL = (CurrentPrice - EntryPrice) * Size
    // Size = (Collateral * Leverage) / EntryPrice
    const size = (position.collateral * 3) / position.entryPrice;
    const pnl = (livePrice - position.entryPrice) * size;
    return pnl.toFixed(2);
  };

  const getRiskColor = (level) => {
    if (level === "Critical" || level === "Immediate Risk") return 'bg-red-500 text-white';
    if (level === "Warning") return 'bg-yellow-400 text-black';
    return 'bg-green-500 text-white';
  };

  // You will also need to install Tailwind for this UI
  // Run: `npm install -D tailwindcss postcss autoprefixer`
  // And: `npx tailwindcss init -p`
  // Then configure `tailwind.config.js`
  // For the hackathon, you can skip this and it will be unstyled but functional.
  // Or, for a quick fix, add this to `index.css`:
  /*
  @tailwind base;
  @tailwind components;
  @tailwind utilities;
  */

  return (
    <div className="min-h-screen bg-gray-900 text-white font-sans p-8">
      <div className="max-w-7xl mx-auto">
        <header className="flex justify-between items-center mb-8">
          <h1 className="text-4xl font-bold text-cyan-400">GuardTrade</h1>
          <div className="text-right">
            <p className="text-sm text-gray-400">{status}</p>
            <p className="text-xs text-gray-500 truncate w-64">Account: {account}</p>
          </div>
        </header>

        {/* --- ACTIONS --- */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div className="bg-gray-800 p-6 rounded-lg shadow-lg">
            <h2 className="text-2xl font-semibold mb-4">Actions</h2>
            <button
              onClick={openPosition}
              className="w-full bg-cyan-500 hover:bg-cyan-400 text-black font-bold py-3 px-4 rounded-lg transition"
            >
              Open 3x Long ETH Position ($1000)
            </button>
          </div>

          <div className="bg-gray-800 p-6 rounded-lg shadow-lg">
            <h2 className="text-2xl font-semibold mb-4">Demo: Simulate Market</h2>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => simulatePrice(3000)}
                className="bg-gray-600 hover:bg-gray-500 py-2 px-3 rounded-lg text-sm"
              >
                Set Price (Stable) $3000
              </button>
              <button
                onClick={() => simulatePrice(2500)}
                className="bg-yellow-600 hover:bg-yellow-500 py-2 px-3 rounded-lg text-sm"
              >
                Set Price (Warning) $2500
              </button>
              <button
                onClick={() => simulatePrice(2200)}
                className="bg-red-600 hover:bg-red-500 py-2 px-3 rounded-lg text-sm"
              >
                Set Price (CRITICAL) $2200
              </button>
            </div>
          </div>
        </div>

        {/* --- DASHBOARD --- */}
        <div>
          <h2 className="text-3xl font-semibold mb-4">Real-Time Dashboard</h2>
          <div className="bg-gray-800 p-6 rounded-lg shadow-lg mb-8">
            <h3 className="text-2xl mb-4">Live Market</h3>
            <p className="text-5xl font-mono font-bold text-cyan-400">
              ETH: ${livePrice.toFixed(2)}
            </p>
          </div>

          <h3 className="text-2xl font-semibold mb-4">Active Positions</h3>
          <div className="space-y-4">
            {Object.keys(positions).length === 0 && (
              <p className="text-gray-400">No open positions. Open one to start.</p>
            )}

            {Object.values(positions).map((pos) => {
              const pnl = getPnl(pos);
              const alert = alerts[pos.id];
              return (
                <div key={pos.id} className="bg-gray-800 rounded-lg shadow-lg overflow-hidden">
                  {alert && (
                    <div className={`p-3 text-center font-bold ${getRiskColor(alert)}`}>
                      🔥 RISK ALERT: {alert.toUpperCase()}
                    </div>
                  )}
                  <div className="p-6 grid grid-cols-1 md:grid-cols-5 gap-4 items-center">
                    <div>
                      <div className="text-xs text-gray-400">Position ID</div>
                      <div className="text-lg font-bold">#{pos.id} (3x LONG)</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-400">Entry Price</div>
                      <div className="text-lg font-mono">${pos.entryPrice?.toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-400">Collateral</div>
                      <div className="text-lg font-mono">${pos.collateral?.toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-400">Live P&L</div>
                      <div classNameclassName={`text-lg font-mono font-bold ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        ${pnl}
                      </div>
                    </div>
                    <div className="flex flex-col items-start md:items-end">
                      <div className="text-xs text-gray-400 mb-1">Health Factor</div>
                      <div className="w-full bg-gray-700 rounded-full h-4 mb-2">
                        <div
                          className="bg-linear-to-r from-red-500 via-yellow-500 to-green-500 h-4 rounded-full"
                          style={{ width: `${pos.healthFactor * 100}%` }}
                        ></div>

                      </div>
                      <span className="text-sm font-mono">{Math.max(0, pos.healthFactor * 100).toFixed(1)}%</span>
                      <button 
                        onClick={() => checkRisk(pos.id)}
                        className="mt-2 text-xs bg-cyan-700 hover:bg-cyan-600 py-1 px-2 rounded"
                      >
                        Check Risk
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;