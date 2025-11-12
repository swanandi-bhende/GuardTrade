import { useState, useEffect, useCallback } from 'react';
// import { SDK } from '@somnia-chain/streams'; // We are NOT using the SDK
import { createPublicClient, http, defineChain, createWalletClient, custom } from 'viem';
import { ethers } from 'ethers';

// --- ABIs (Manually copy these from your artifacts/contracts/...) ---
// I've pasted them here for you to make the hackathon setup faster.

const PriceOracleABI = {
  abi: [{"inputs":[],"stateMutability":"nonpayable","type":"constructor"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"string","name":"asset","type":"string"},{"indexed":false,"internalType":"uint256","name":"price","type":"uint256"}],"name":"PriceUpdate","type":"event"},{"inputs":[{"internalType":"string","name":"","type":"string"}],"name":"assetPrices","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"string","name":"_asset","type":"string"}],"name":"getPrice","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"string","name":"_asset","type":"string"},{"internalType":"uint256","name":"_price","type":"uint256"}],"name":"setPrice","outputs":[],"stateMutability":"nonpayable","type":"function"}],

};
const LeverageManagerABI = {
abi: [{"inputs":[{"internalType":"address","name":"_oracleAddress","type":"address"}],"stateMutability":"nonpayable","type":"constructor"},{"inputs":[],"name":"ReentrancyGuardReentrantCall","type":"error"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"uint256","name":"positionId","type":"uint256"},{"indexed":false,"internalType":"address","name":"owner","type":"address"},{"indexed":false,"internalType":"uint256","name":"collateral","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"healthFactor","type":"uint256"}],"name":"PositionUpdate","type":"event"},{"inputs":[{"internalType":"uint256","name":"_positionId","type":"uint256"}],"name":"getHealthFactor","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"nextPositionId","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"_collateral","type":"uint256"},{"internalType":"uint256","name":"_leverage","type":"uint256"},{"internalType":"enum LeverageManager.PositionType","name":"_positionType","type":"uint8"}],"name":"openPosition","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256","name":"","type":"uint256"}],"name":"positions","outputs":[{"internalType":"uint256","name":"id","type":"uint256"},{"internalType":"address","name":"owner","type":"address"},{"internalType":"uint256","name":"collateral","type":"uint256"},{"internalType":"uint256","name":"leverage","type":"uint256"},{"internalType":"uint256","name":"entryPrice","type":"uint256"},{"internalType":"enum LeverageManager.PositionType","name":"positionType","type":"uint8"},{"internalType":"enum LeverageManager.PositionState","name":"state","type":"uint8"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"priceOracle","outputs":[{"internalType":"contract MockPriceOracle","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"_positionId","type":"uint256"}],"name":"updatePosition","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"","type":"address"},{"internalType":"uint256","name":"","type":"uint256"}],"name":"userPositions","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"}],
};
const GuardianABI = {
  abi: [{"inputs":[{"internalType":"address","name":"_manager","type":"address"},{"internalType":"address","name":"_oracle","type":"address"}],"stateMutability":"nonpayable","type":"constructor"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"uint256","name":"positionId","type":"uint256"},{"indexed":false,"internalType":"enum Guardian.RiskLevel","name":"riskLevel","type":"uint8"}],"name":"RiskThresholdBreach","type":"event"},{"inputs":[{"internalType":"uint256","name":"_positionId","type":"uint256"}],"name":"checkRisk","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"manager","outputs":[{"internalType":"contract LeverageManager","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"oracle","outputs":[{"internalType":"contract MockPriceOracle","name":"","type":"address"}],"stateMutability":"view","type":"function"}],
};
// --- END ABIs ---


// --- 1. CRITICAL: CONFIGURE YOUR CONTRACTS & NETWORK ---
const CONTRACT_ADDRESSES = {
  oracle: '0x01848F70e8D709891f960B7c7e7F62296CeFB7B5',    // <-- Your addresses are here
  manager: '0x57b26fFb2C9E1858088c2C6f75Bcd7389F7a3708', // <-- Your addresses are here
  guardian: '0x7D34EbDDea65ac01891DDd7bbce4A802a7982BF1'         // <-- Your addresses are here
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

// Create the Public Client *outside* the component.
const publicClient = createPublicClient({
  chain: somniaTestnet,
  transport: http(),
});

// Helper function to truncate wallet addresses
const truncateAddress = (address) => {
  if (!address) return '';
  return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
};

function App() {
  const [wallet, setWallet] = useState(null);
  const [account, setAccount] = useState(null);
  const [status, setStatus] = useState('Please connect your wallet.');

  // Live Data State
  const [livePrice, setLivePrice] = useState(3000);
  const [positions, setPositions] = useState({});
  const [alerts, setAlerts] = useState({});

  // --- 2. INITIALIZE PUBLIC DATA (No Wallet Needed) ---
  useEffect(() => {
    async function initPublicData() {
      try {
        const initialPrice = await publicClient.readContract({
          address: CONTRACT_ADDRESSES.oracle,
          abi: PriceOracleABI.abi,
          functionName: 'getPrice',
          args: ['ETH']
        });
        setLivePrice(Number(initialPrice) / 10**8);
        setStatus('Ready to connect.');
      } catch (err) {
        console.error("Public init error:", err);
        setStatus('Error loading public data. Check console.');
      }
    }
    initPublicData();
  }, []); // Runs once on load

  // --- 3. WALLET FUNCTIONS (Connect & Disconnect) ---
  const connectWallet = async () => {
    if (!window.ethereum) {
      setStatus('MetaMask not detected. Please install it.');
      return;
    }
    
    setStatus('Connecting to MetaMask...');
    try {
      const walletClient = createWalletClient({
        chain: somniaTestnet,
        transport: custom(window.ethereum),
      });

      // Force account selection
      await walletClient.requestPermissions({ eth_accounts: {} });
      const [accountAddress] = await walletClient.getAddresses();
      
      setAccount(accountAddress);
      setWallet(walletClient);
      
      setStatus('Wallet Connected! Subscribing to streams...');
    } catch (err) {
      console.error("Wallet connection error:", err);
      setStatus('Error connecting wallet. Check console.');
    }
  };

  const disconnectWallet = useCallback(() => {
    setWallet(null);
    setAccount(null);
    setPositions({});
    setAlerts({});
    setStatus('Wallet disconnected. Please connect again.');
  }, []);

  // Listen for account changes in MetaMask
  useEffect(() => {
    const { ethereum } = window;
    if (!ethereum) return; // No wallet

    const handleAccountsChanged = (accounts) => {
      if (accounts.length > 0) {
        if (account && accounts[0].toLowerCase() !== account.toLowerCase()) {
          console.log("MetaMask account switched to:", accounts[0]);
          setAccount(accounts[0]);
          const newWalletClient = createWalletClient({
            chain: somniaTestnet,
            transport: custom(window.ethereum),
            account: accounts[0],
          });
          setWallet(newWalletClient);
        }
      } else {
        if (account) {
          console.log("MetaMask user disconnected.");
          disconnectWallet();
        }
      }
    };

    ethereum.on('accountsChanged', handleAccountsChanged);
    return () => {
      ethereum.removeListener('accountsChanged', handleAccountsChanged);
    };
  }, [account, disconnectWallet]);

  // --- 4. SUBSCRIBE TO STREAMS (THE CORE!) ---
  useEffect(() => {
    if (!account) {
      setPositions({});
      setAlerts({});
      return;
    }
    
    // A. Price Stream
    const unsubPrice = publicClient.watchContractEvent({
      address: CONTRACT_ADDRESSES.oracle,
      abi: PriceOracleABI.abi,
      eventName: 'PriceUpdate',
      onLogs: (logs) => {
        logs.forEach(data => {
          if (data.args.asset === 'ETH') {
             console.log("Price Stream Event:", data);
             const newPrice = Number(data.args.price) / 10**8;
             setLivePrice(newPrice);
          }
        });
      }
    });

    // B. Position Stream
    const unsubPos = publicClient.watchContractEvent({
      address: CONTRACT_ADDRESSES.manager,
      abi: LeverageManagerABI.abi,
      eventName: 'PositionUpdate',
      onLogs: (logs) => {
        logs.forEach(data => {
          if (data.args.owner.toLowerCase() === account.toLowerCase()) {
            console.log("Position Stream Event:", data);
            const { positionId, collateral, healthFactor } = data.args;
            const posId = Number(positionId);
            setPositions(prev => ({
              ...prev,
              [posId]: {
                ...prev[posId], 
                id: posId,
                collateral: Number(collateral) / 10**8,
                healthFactor: Number(healthFactor) / 10**18,
              }
            }));
          }
        });
      }
    });

    // C. Risk Stream
    const unsubRisk = publicClient.watchContractEvent({
      address: CONTRACT_ADDRESSES.guardian,
      abi: GuardianABI.abi,
      eventName: 'RiskThresholdBreach',
      onLogs: (logs) => {
        logs.forEach(data => {
          console.log("Risk Stream Event:", data);
          const { positionId, riskLevel } = data.args;
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

    setStatus('Subscribed to real-time data streams.');

    // Cleanup subscriptions
    return () => {
      unsubPrice();
      unsubPos();
      unsubRisk();
    };

  }, [account]);

  // --- 5. CONTRACT INTERACTION FUNCTIONS ---

  const openPosition = async () => {
    if (!wallet || !account) return alert("Wallet not connected");
    setStatus("Opening position...");
    try {
      const { request } = await publicClient.simulateContract({
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
      const hash = await wallet.writeContract(request);
      setStatus("Transaction sent, awaiting confirmation...");
      await publicClient.waitForTransactionReceipt({ hash });
      setStatus("Position opened successfully. Dashboard will update.");
      
      const newPosId = (await publicClient.readContract({
        address: CONTRACT_ADDRESSES.manager,
        abi: LeverageManagerABI.abi,
        functionName: 'nextPositionId'
      })) - BigInt(1);

      const posData = await publicClient.readContract({
        address: CONTRACT_ADDRESSES.manager,
        abi: LeverageManagerABI.abi,
        functionName: 'positions',
        args: [newPosId]
      });

      setPositions(prev => ({
        ...prev,
        [Number(newPosId)]: {
          ...prev[Number(newPosId)],
          entryPrice: Number(posData.entryPrice) / 10**8,
          leverage: 3 // Hardcoding this as we know it from openPosition
        }
      }));

    } catch (err) { 
      console.error("Open position error:", err);
      setStatus("Error opening position. Check console.");
    }
  };

  const simulatePrice = async (newPrice) => {
    if (!wallet || !account) return alert("Wallet not connected");
    setStatus(`Simulating price change: $${newPrice}...`);
    try {
      const { request } = await publicClient.simulateContract({
        account,
        address: CONTRACT_ADDRESSES.oracle,
        abi: PriceOracleABI.abi,
        functionName: 'setPrice',
        args: ['ETH', BigInt(newPrice * 10**8)]
      });
      const hash = await wallet.writeContract(request);
      await publicClient.waitForTransactionReceipt({ hash });
      setStatus(`Price set to $${newPrice}. Streams will update dashboard.`);
    } catch (err) { 
      console.error("Simulate price error:", err);
      setStatus("Error setting price. Check console.");
    }
  };

  const checkRisk = async (positionId) => {
    if (!wallet || !account) return alert("Wallet not connected");
    setStatus(`Checking risk for position ${positionId}...`);
    try {
      const { request } = await publicClient.simulateContract({
        account,
        address: CONTRACT_ADDRESSES.guardian,
        abi: GuardianABI.abi,
        functionName: 'checkRisk',
        args: [BigInt(positionId)]
      });
      const hash = await wallet.writeContract(request);
      await publicClient.waitForTransactionReceipt({ hash });
      setStatus(`Risk check sent. Alert stream will update status.`);
    } catch (err) { 
      console.error("Check risk error:", err);
      setStatus("Error checking risk. Check console.");
    }
  };

  // --- 6. HELPER & RENDER FUNCTIONS ---
  
  const getPnl = (position) => {
    if (!position.entryPrice) return 0;
    const size = (position.collateral * position.leverage) / position.entryPrice;
    const pnl = (livePrice - position.entryPrice) * size;
    return pnl.toFixed(2);
  };
  
  // --- NEW: Calculate Liquidation Price ---
  const getLiqPrice = (position) => {
    if (!position.entryPrice || !position.leverage) return 0;
    // For Long: LP = EntryPrice * (1 - (1 / Leverage))
    const liqPrice = position.entryPrice - (position.entryPrice / position.leverage);
    return liqPrice.toFixed(2);
  };

  const getRiskBanner = (alert) => {
    if (alert === "Critical" || alert === "Immediate Risk") {
      return (
        <div className="p-3 text-center font-bold bg-red-600 text-white">
          RISK LEVEL: {alert.toUpperCase()}
        </div>
      );
    }
    if (alert === "Warning") {
      return (
        <div className="p-3 text-center font-bold bg-yellow-500 text-black">
          RISK LEVEL: {alert.toUpperCase()}
        </div>
      );
    }
    // Default "Safe" banner
    return (
      <div className="p-3 text-center font-bold bg-green-600 text-white">
        RISK LEVEL: SAFE
      </div>
    );
  };

  // --- RENDER: Connect Wallet Page ---
  if (!account) {
    return (
      <div className="min-h-screen bg-brand-darkest text-gray-200 flex items-center justify-center p-8 font-sans">
        <div className="max-w-xl w-full text-center bg-brand-dark p-10 rounded-lg shadow-2xl">
          {/* Use the logo here. Assumes logo is in /public/GuardTrade Logo.png */}
          <img src="/GuardTrade Logo.png" alt="GuardTrade Logo" className="h-16 mx-auto mb-6" />
          <p className="text-xl text-white mb-4">
            Imagine you're borrowing money to trade.
          </p>
          <p className="text-lg text-gray-200 mb-8">
            On most platforms, if the trade moves against you, they can suddenly close your position and take your money without warning. GuardTrade is a smart, hyper-vigilant co-pilot for your trades.
          </p>
          <div className="bg-brand-darkest p-6 rounded-lg text-left mb-8">
            <h2 className="text-2xl font-serif text-white mb-4">Core Innovation</h2>
            <p className="text-gray-300 text-base">
              Instead of just letting you crash, GuardTrade sees trouble coming and gives you warnings and options to protect your position *before* it's too late.
            </p>
            <ul className="list-disc list-inside text-gray-300 mt-4 space-y-2 text-base">
              <li><span className="text-white">Real-Time P&L</span> and Health Factor updates.</li>
              <li><span className="text-white">Proactive Liquidation Warnings</span> with sub-second latency.</li>
              <li><span className="text-white">Powered by Somnia</span> for high-speed, low-cost data.</li>
            </ul>
          </div>
          <p className="text-gray-400 mb-6 min-h-5 text-base">{status}</p>
          <button
            onClick={connectWallet}
            className="w-full bg-brand-lightest hover:bg-brand-light text-brand-darkest font-bold py-3 px-4 rounded-lg transition-transform transform hover:scale-105 text-lg"
          >
            Connect Wallet
          </button>
        </div>
      </div>
    );
  }

  // --- RENDER: Main App Dashboard ---
  return (
    <div className="min-h-screen bg-brand-darkest text-gray-200 font-sans p-6 sm:p-8">
      <div className="max-w-7xl mx-auto">
        
        {/* --- Header --- */}
        <header className="flex flex-col sm:flex-row justify-between items-center mb-8 pb-4 border-b border-brand-dark">
          {/* Use the logo here as well */}
          <img src="/GuardTrade Logo.png" alt="GuardTrade Logo" className="h-12" />
          <div className="flex flex-col sm:flex-row items-center gap-4 mt-4 sm:mt-0">
            <div className="text-right">
              <div className="text-base font-mono bg-brand-dark px-3 py-1 rounded-md text-white">
                {truncateAddress(account)}
              </div>
              <p className="text-sm text-gray-400 mt-1 hidden sm:block">{status}</p>
            </div>
            <button
              onClick={connectWallet}
              className="bg-brand-dark hover:bg-brand-gray-medium text-white text-base font-medium py-2 px-4 rounded-lg transition"
            >
              Switch Account
            </button>
            <button
              onClick={disconnectWallet}
              className="bg-brand-dark hover:bg-red-600 hover:text-white text-white text-base font-medium py-2 px-4 rounded-lg transition"
            >
              Disconnect
            </button>
          </div>
        </header>

        {/* --- Dashboard Grid --- */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* --- Left Column: Market & Actions --- */}
          <div className="lg:col-span-1 space-y-6">
            
            {/* Live Market Card */}
            <div className="bg-brand-dark p-6 rounded-lg shadow-lg">
              <h2 className="text-2xl font-serif mb-4 text-white">Live Market</h2>
              <p className="text-sm text-gray-300 uppercase">ETH-USD</p>
              <p className="text-5xl font-mono font-bold text-white">
                ${livePrice.toFixed(2)}
              </p>
              <p className="text-base text-gray-300 mt-2">Price updates are streamed in real-time from the Somnia network.</p>
            </div>
            
            {/* --- NEW: Proactive Protection Card --- */}
            <div className="bg-brand-dark p-6 rounded-lg shadow-lg">
              <h2 className="text-2xl font-serif mb-4 text-white">Proactive Protection</h2>
              <p className="text-base text-gray-300 mb-4">
                Automatically add collateral from a savings vault to prevent liquidation.
              </p>
              <div className="flex items-center justify-between bg-brand-darkest p-4 rounded-lg">
                <span className="text-lg font-bold text-white">Enable Auto-Protection</span>
                <span className="text-xs font-medium text-gray-400 bg-gray-600 px-2 py-1 rounded-full">
                  COMING SOON
                </span>
              </div>
            </div>

            {/* Actions Card */}
            <div className="bg-brand-dark p-6 rounded-lg shadow-lg">
              <h2 className="text-2xl font-serif mb-4 text-white">Actions</h2>
              <button
                onClick={openPosition}
                className="w-full bg-brand-lightest hover:bg-brand-light text-brand-darkest font-bold py-3 px-4 rounded-lg transition transform hover:scale-105 text-lg"
              >
                Open 3x Long ETH Position
              </button>
              <p className="text-base text-gray-300 mt-3 text-center">This will open a demo position with $1,000 in collateral.</p>
            </div>

            {/* Demo Card */}
            <div className="bg-brand-dark p-6 rounded-lg shadow-lg">
              <h2 className="text-2xl font-serif mb-4 text-white">Demo: Simulate Price</h2>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => simulatePrice(3000)}
                  className="bg-brand-gray-medium hover:bg-brand-light hover:text-brand-darkest text-white py-2 px-3 rounded-lg text-base transition"
                >
                  Stable
                </button>
                <button
                  onClick={() => simulatePrice(2500)}
                  className="bg-yellow-500 hover:bg-yellow-400 text-black py-2 px-3 rounded-lg text-base transition"
                >
                  Warning
                </button>
                <button
                  onClick={() => simulatePrice(2200)}
                  className="bg-red-600 hover:bg-red-500 text-white py-2 px-3 rounded-lg text-base transition"
                >
                  Critical
                </button>
              </div>
              <p className="text-base text-gray-300 mt-3 text-center">Manually trigger price changes to test your position's health.</p>
            </div>
          </div>

          {/* --- Right Column: Positions --- */}
          <div className="lg:col-span-2">
            <h2 className="text-3xl font-serif mb-4 text-white">Your Active Positions</h2>
            
            {Object.keys(positions).length === 0 ? (
              // No Positions State
              <div className="bg-brand-dark p-10 rounded-lg shadow-lg text-center">
                <p className="text-xl text-white">No active positions.</p>
                <p className="text-base text-gray-300 mt-2">
                  Click the "Open 3x Long ETH Position" button on the left to create one and see the real-time data streams in action.
                </p>
              </div>
            ) : (
              // Positions Grid
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {Object.values(positions).map((pos) => {
                  const pnl = getPnl(pos);
                  const alert = alerts[pos.id];
                  const liqPrice = getLiqPrice(pos);
                  return (
                    <div key={pos.id} className="bg-brand-dark rounded-lg shadow-lg overflow-hidden flex flex-col">
                      
                      {/* --- Risk Alert Banner --- */}
                      {getRiskBanner(alert)}

                      {/* --- Position Header --- */}
                      <div className="p-5 border-b border-brand-darkest">
                        <h3 className="text-xl font-serif font-bold text-white">Position #{pos.id}</h3>
                        <p className="text-base text-white">3x ETH-USD LONG</p>
                      </div>
                      
                      {/* --- Position Body (Stats) --- */}
                      <div className="p-5 grid grid-cols-2 gap-5 grow">
                        <div>
                          <p className="text-sm text-gray-300 uppercase">Live P&L</p>
                          <p className={`text-2xl font-mono font-bold ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            ${pnl}
                          </p>
                          <p className="text-sm text-gray-300">Your current profit or loss, updating live.</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-300 uppercase">Health Factor</p>
                          <p className="text-2xl font-mono font-bold text-white">
                            {Math.max(0, pos.healthFactor * 100).toFixed(1)}%
                          </p>
                          <p className="text-sm text-gray-300">Like a fuel gauge. If it reaches 0%, you are liquidated.</p>
                        </div>
                        <div className="col-span-2">
                          {/* Health Bar */}
                          <div className="w-full bg-brand-darkest rounded-full h-4">
                            <div
                              className="bg-linear-to-r from-red-500 via-yellow-500 to-green-500 h-4 rounded-full"
                              style={{ width: `${Math.max(0, pos.healthFactor) * 100}%` }}
                            ></div>
                          </div>
                        </div>
                        <div>
                          <p className="text-sm text-gray-300 uppercase">Collateral</p>
                          <p className="text-lg font-mono text-white">${pos.collateral?.toFixed(2)}</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-300 uppercase">Entry Price</p>
                          <p className="text-lg font-mono text-white">${pos.entryPrice?.toFixed(2)}</p>
                        </div>
                        {/* --- NEW: Liquidation Price --- */}
                        <div className="col-span-2">
                          <p className="text-sm text-gray-300 uppercase">Liquidation Price</p>
                          <p className="text-lg font-mono text-red-400">${liqPrice}</p>
                          <p className="text-sm text-gray-300">The price at which your position will be closed.</p>
                        </div>
                        
                      </div>
                      
                      {/* --- Position Footer (Actions) --- */}
                      <div className="p-4 bg-brand-darkest mt-auto">
                        <button 
                          onClick={() => checkRisk(pos.id)}
                          className="w-full text-base bg-brand-gray-medium hover:bg-brand-light hover:text-brand-darkest text-white py-2 px-3 rounded transition"
                        >
                          Manually Check Position Health
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;