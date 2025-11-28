import { useState, useEffect, useCallback } from 'react';
// We use ESM imports for viem since local packages aren't available
import { createPublicClient, http, defineChain, createWalletClient, custom, formatEther } from 'https://esm.sh/viem';

// --- ABIs (Manually copy these from your artifacts/contracts/...) ---
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

// --- MOCK DATA FOR GLOBAL PORTFOLIO ---
const MOCK_WALLET_BALANCE = 5000; // $5,000 in "Idle Funds"
const MOCK_INSURANCE_VAULT = 2500; // $2,500 in "Insurance Vault"
// ----------------------------------------

// OpenPositionModal Component
const OpenPositionModal = ({ isOpen, onClose, onPositionOpened, livePrice }) => {
  const [step, setStep] = useState(1); // 1: Setup, 2: Protection, 3: Confirmation
  const [selectedAsset, setSelectedAsset] = useState('ETH');
  const [leverage, setLeverage] = useState(3);
  const [collateral, setCollateral] = useState(1000);
  const [protectionSettings, setProtectionSettings] = useState({
    autoAddCollateral: true,
    partialReduce: false,
    emergencyClose: true,
    insuranceVault: true
  });

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setStep(1);
      setSelectedAsset('ETH');
      setLeverage(3);
      setCollateral(1000);
      setProtectionSettings({
        autoAddCollateral: true,
        partialReduce: false,
        emergencyClose: true,
        insuranceVault: true
      });
    }
  }, [isOpen]);

  // Calculate real-time values
  const positionSize = collateral * leverage;
  const liquidationPrice = selectedAsset === 'ETH' ? livePrice * (1 - (1 / leverage)) : livePrice * 0.95; // Simplified for BTC
  const distanceToLiquidation = ((livePrice - liquidationPrice) / livePrice) * 100;

  const riskLevel = distanceToLiquidation > 20 ? 'Safe' : 
                   distanceToLiquidation > 10 ? 'Warning' : 
                   distanceToLiquidation > 5 ? 'Critical' : 'Immediate Risk';

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-brand-dark rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-brand-darkest">
          <h2 className="text-2xl font-serif text-white">Open New Position</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl">×</button>
        </div>

        {/* Progress Steps */}
        <div className="flex justify-center py-4 border-b border-brand-darkest">
          <div className="flex items-center space-x-8">
            {[1, 2, 3].map((stepNum) => (
              <div key={stepNum} className="flex items-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  step >= stepNum ? 'bg-brand-lightest text-brand-darkest' : 'bg-brand-darkest text-gray-400'
                } font-bold`}>
                  {stepNum}
                </div>
                <span className={`ml-2 ${
                  step >= stepNum ? 'text-white' : 'text-gray-400'
                }`}>
                  {stepNum === 1 && 'Setup'}
                  {stepNum === 2 && 'Protection'}
                  {stepNum === 3 && 'Confirm'}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="p-6">
          {/* Step 1: Position Setup */}
          {step === 1 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Left Column - Inputs */}
              <div className="space-y-6">
                {/* Asset Selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-3">Select Asset</label>
                  <div className="grid grid-cols-2 gap-3">
                    {['ETH', 'BTC'].map(asset => (
                      <button
                        key={asset}
                        onClick={() => setSelectedAsset(asset)}
                        className={`p-4 rounded-lg border-2 text-center transition-all ${
                          selectedAsset === asset 
                            ? 'border-brand-lightest bg-brand-lightest bg-opacity-10 text-white' 
                            : 'border-brand-darkest bg-brand-darkest text-gray-400 hover:border-brand-gray-medium'
                        }`}
                      >
                        <div className="text-lg font-bold">{asset}</div>
                        <div className="text-sm text-gray-400">Current: {formatCurrency(livePrice)}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Leverage Selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-3">
                    Leverage: {leverage}x
                  </label>
                  <div className="space-y-2">
                    <input
                      type="range"
                      min="1"
                      max="10"
                      step="1"
                      value={leverage}
                      onChange={(e) => setLeverage(Number(e.target.value))}
                      className="w-full h-2 bg-brand-darkest rounded-lg appearance-none cursor-pointer slider"
                    />
                    <div className="flex justify-between text-xs text-gray-400">
                      {[1, 3, 5, 7, 10].map(val => (
                        <span key={val} className="cursor-pointer" onClick={() => setLeverage(val)}>
                          {val}x
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Collateral Input */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-3">
                    Collateral Amount
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-3 text-gray-400">$</span>
                    <input
                      type="number"
                      value={collateral}
                      onChange={(e) => setCollateral(Number(e.target.value))}
                      className="w-full bg-brand-darkest border border-brand-gray-medium rounded-lg py-3 pl-8 pr-4 text-white focus:outline-none focus:ring-2 focus:ring-brand-lightest"
                      placeholder="0.00"
                    />
                  </div>
                  <div className="flex gap-2 mt-2">
                    {[500, 1000, 2500, 5000].map(amount => (
                      <button
                        key={amount}
                        onClick={() => setCollateral(amount)}
                        className="text-xs bg-brand-darkest hover:bg-brand-gray-medium text-gray-400 py-1 px-2 rounded transition"
                      >
                        ${amount}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Right Column - Live Preview */}
              <div className="bg-brand-darkest rounded-lg p-6">
                <h3 className="text-lg font-semibold text-white mb-4">Position Preview</h3>
                
                <div className="space-y-4">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Position Size</span>
                    <span className="text-white font-mono">{formatCurrency(positionSize)}</span>
                  </div>
                  
                  <div className="flex justify-between">
                    <span className="text-gray-400">Liquidation Price</span>
                    <span className="text-red-400 font-mono font-bold">{formatCurrency(liquidationPrice)}</span>
                  </div>
                  
                  <div className="flex justify-between">
                    <span className="text-gray-400">Distance to Liq.</span>
                    <span className={`font-mono font-bold ${
                      riskLevel === 'Safe' ? 'text-green-400' :
                      riskLevel === 'Warning' ? 'text-yellow-400' :
                      riskLevel === 'Critical' ? 'text-orange-400' : 'text-red-400'
                    }`}>
                      {distanceToLiquidation.toFixed(1)}%
                    </span>
                  </div>

                  {/* Risk Level Indicator */}
                  <div className="mt-4 p-4 rounded-lg border-2 border-brand-gray-medium">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-gray-400">Risk Level</span>
                      <span className={`px-3 py-1 rounded-full text-sm font-bold ${
                        riskLevel === 'Safe' ? 'bg-green-500 text-white' :
                        riskLevel === 'Warning' ? 'bg-yellow-500 text-black' :
                        riskLevel === 'Critical' ? 'bg-orange-500 text-white' : 'bg-red-500 text-white'
                      }`}>
                        {riskLevel}
                      </span>
                    </div>
                    <div className="w-full bg-gray-700 rounded-full h-2">
                      <div 
                        className={`h-2 rounded-full transition-all duration-300 ${
                          riskLevel === 'Safe' ? 'bg-green-500' :
                          riskLevel === 'Warning' ? 'bg-yellow-500' :
                          riskLevel === 'Critical' ? 'bg-orange-500' : 'bg-red-500'
                        }`}
                        style={{ width: `${Math.max(5, 100 - distanceToLiquidation)}%` }}
                      ></div>
                    </div>
                  </div>

                  {/* Mini Chart Visualization */}
                  <div className="mt-4 bg-black rounded p-3">
                    <div className="flex justify-between text-xs text-gray-400 mb-1">
                      <span>Current: {formatCurrency(livePrice)}</span>
                      <span>Liq: {formatCurrency(liquidationPrice)}</span>
                    </div>
                    <div className="relative h-16 bg-gray-900 rounded">
                      {/* Simple visualization */}
                      <div className="absolute left-0 top-0 bottom-0 w-1/2 bg-linear-to-r from-green-500 to-yellow-500 opacity-20"></div>
                      <div className="absolute right-0 top-0 bottom-0 w-1/2 bg-linear-to-r from-yellow-500 to-red-500 opacity-20"></div>
                      <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">
                        <div className="text-center">
                          <div>Price: {formatCurrency(livePrice)}</div>
                          <div className="text-red-400">Liq: {formatCurrency(liquidationPrice)}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Protection Settings */}
          {step === 2 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="space-y-6">
                <h3 className="text-xl font-serif text-white mb-4">Protection Features</h3>
                
                {[
                  {
                    key: 'autoAddCollateral',
                    title: 'Auto-Add Collateral',
                    description: 'Automatically add funds from your Insurance Vault when position is at risk',
                    enabled: protectionSettings.autoAddCollateral
                  },
                  {
                    key: 'partialReduce',
                    title: 'Partial Position Reduction',
                    description: 'Reduce position size automatically to maintain safe health factor',
                    enabled: protectionSettings.partialReduce
                  },
                  {
                    key: 'emergencyClose',
                    title: 'Emergency Close',
                    description: 'Close position automatically at better prices before liquidation',
                    enabled: protectionSettings.emergencyClose
                  },
                  {
                    key: 'insuranceVault',
                    title: 'Use Insurance Vault',
                    description: 'Enable access to Insurance Vault funds for protection',
                    enabled: protectionSettings.insuranceVault
                  }
                ].map(setting => (
                  <div key={setting.key} className="flex items-start space-x-4 p-4 bg-brand-darkest rounded-lg">
                    <div className="flex items-center h-6">
                      <input
                        type="checkbox"
                        checked={protectionSettings[setting.key]}
                        onChange={(e) => setProtectionSettings(prev => ({
                          ...prev,
                          [setting.key]: e.target.checked
                        }))}
                        className="w-4 h-4 text-brand-lightest bg-gray-700 border-gray-600 rounded focus:ring-brand-lightest"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="text-white font-medium">{setting.title}</label>
                      <p className="text-sm text-gray-400 mt-1">{setting.description}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="bg-brand-darkest rounded-lg p-6">
                <h3 className="text-lg font-semibold text-white mb-4">Protection Summary</h3>
                <div className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Auto-Protection</span>
                    <span className={protectionSettings.autoAddCollateral ? "text-green-400" : "text-red-400"}>
                      {protectionSettings.autoAddCollateral ? "Enabled" : "Disabled"}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Insurance Vault Access</span>
                    <span className={protectionSettings.insuranceVault ? "text-green-400" : "text-red-400"}>
                      {protectionSettings.insuranceVault ? "Enabled" : "Disabled"}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Emergency Protocols</span>
                    <span className={protectionSettings.emergencyClose ? "text-green-400" : "text-red-400"}>
                      {protectionSettings.emergencyClose ? "Active" : "Inactive"}
                    </span>
                  </div>
                  
                  <div className="mt-6 p-4 bg-green-500 bg-opacity-10 border border-green-500 rounded-lg">
                    <div className="text-green-400 text-sm">
                      <strong>Your position will be actively monitored</strong> by GuardTrade's real-time protection system. You'll receive instant alerts and automated protection when needed.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Confirmation */}
          {step === 3 && (
            <div className="text-center space-y-6">
              <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mx-auto">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
                </svg>
              </div>
              
              <h3 className="text-2xl font-serif text-white">Ready to Open Position</h3>
              
              <div className="bg-brand-darkest rounded-lg p-6 max-w-md mx-auto">
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Asset</span>
                    <span className="text-white">{selectedAsset}/USD</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Leverage</span>
                    <span className="text-white">{leverage}x</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Collateral</span>
                    <span className="text-white">{formatCurrency(collateral)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Position Size</span>
                    <span className="text-white">{formatCurrency(positionSize)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Liquidation Price</span>
                    <span className="text-red-400">{formatCurrency(liquidationPrice)}</span>
                  </div>
                </div>
              </div>

              <div className="text-gray-400 text-sm max-w-md mx-auto">
                Your position will be actively monitored by GuardTrade's real-time protection system. You can modify protection settings anytime from the dashboard.
              </div>
            </div>
          )}
        </div>

        {/* Footer Navigation */}
        <div className="flex justify-between p-6 border-t border-brand-darkest">
          <button
            onClick={() => step > 1 ? setStep(step - 1) : onClose()}
            className="px-6 py-3 border border-gray-600 text-gray-300 rounded-lg hover:bg-gray-800 transition"
          >
            {step === 1 ? 'Cancel' : 'Back'}
          </button>
          
          <button
            onClick={() => {
              if (step < 3) {
                setStep(step + 1);
              } else {
                onPositionOpened({
                  asset: selectedAsset,
                  leverage,
                  collateral,
                  protectionSettings
                });
                onClose();
              }
            }}
            className="px-6 py-3 bg-brand-lightest text-brand-darkest font-bold rounded-lg hover:bg-brand-light transition transform hover:scale-105"
          >
            {step === 3 ? 'Open Position' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
};

// Helper function to format currency
const formatCurrency = (value) => {
  if (typeof value !== 'number') value = 0;
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
};

function App() {
  const [wallet, setWallet] = useState(null);
  const [account, setAccount] = useState(null);
  const [status, setStatus] = useState('Please connect your wallet.');
  const [userName, setUserName] = useState('');
  const [balance, setBalance] = useState(0);

  // New state to hold the "detected" wallet address before login completes
  const [detectedAddress, setDetectedAddress] = useState(null);

  // Live Data State
  const [livePrice, setLivePrice] = useState(3000);
  const [positions, setPositions] = useState({});
  const [alerts, setAlerts] = useState({});
  const [selectedPosition, setSelectedPosition] = useState(null);
  const [isOpenPositionModal, setIsOpenPositionModal] = useState(false);
  const [protectionSettings, setProtectionSettings] = useState({});

  // --- NEW: Calculate Global Portfolio Values ---
  const activeCollateral = Object.values(positions).reduce((acc, pos) => acc + pos.collateral, 0);
  const totalPortfolioValue = balance + MOCK_INSURANCE_VAULT + activeCollateral;

  // Calculate portfolio health score (0-100)
  const calculatePortfolioHealth = () => {
    if (Object.keys(positions).length === 0) return 95;
    
    const avgHealth = Object.values(positions).reduce((acc, pos) => {
      const health = Math.max(0, pos.healthFactor || 0) * 100;
      return acc + health;
    }, 0) / Object.keys(positions).length;
    
    return Math.min(95, Math.max(60, avgHealth));
  };

  const portfolioHealth = calculatePortfolioHealth();

  // --- 2. INITIALIZE AND AUTO-CONNECT ---
  useEffect(() => {
    async function tryAutoConnect() {
      if (!window.ethereum) {
        setStatus('MetaMask not detected. Please install it.');
        return;
      }
      
      try {
        // Fetch initial price data
        const initialPrice = await publicClient.readContract({
          address: CONTRACT_ADDRESSES.oracle,
          abi: PriceOracleABI.abi,
          functionName: 'getPrice',
          args: ['ETH']
        });
        setLivePrice(Number(initialPrice) / 10**8);

        // Check for already connected accounts without prompting
        const accounts = await window.ethereum.request({ method: 'eth_accounts' });
        
        if (accounts && accounts.length > 0) {
          const accountAddress = accounts[0];
          setDetectedAddress(accountAddress); // Store detected address

          const savedName = localStorage.getItem(accountAddress);

          if (savedName) {
            // If we have a name for this account, let's auto-connect
            setStatus('Restoring session...');
            const { walletClient, accountAddress: connectedAddress } = await connectWallet(false); // false = don't prompt
            setAccount(connectedAddress);
            setWallet(walletClient);
            setUserName(savedName);
            setStatus('Wallet Connected! Subscribing to streams...');
          } else {
            // We have an account but no name, so just wait on the login page
            setStatus('Wallet detected. Please enter a name to continue.');
            setAccount(null); // Ensure we are in "Logged Out" state
            setUserName('');
          }
        } else {
          // No accounts found, user needs to connect manually
          setStatus('Please connect your wallet.');
        }
      } catch (err) {
        console.error("Auto-connect error:", err);
        setStatus('Error during auto-connect. Please connect manually.');
      }
    }
    tryAutoConnect();
  }, []); // Runs once on load


  const handleConnect = async () => {
    if (!userName.trim()) {
      setStatus("Please enter a name to continue.");
      return;
    }
    
    try {
        let walletClient, accountAddress;

        // If we already detected an address, just connect to that one specifically
        if (detectedAddress) {
             walletClient = createWalletClient({
                chain: somniaTestnet,
                transport: custom(window.ethereum),
                account: detectedAddress
            });
            accountAddress = detectedAddress;
        } else {
            // Otherwise, prompt user to connect/select
            const result = await connectWallet(true); 
            walletClient = result.walletClient;
            accountAddress = result.accountAddress;
        }

        // Save the mapping: Address -> Name
        localStorage.setItem(accountAddress, userName);
        
        setAccount(accountAddress);
        setWallet(walletClient);
        setStatus('Wallet Connected! Subscribing to streams...');
    } catch(err) {
        console.error("Login failed", err);
        setStatus("Connection failed. Please try again.");
    }
  };

  const handleSwitchAccount = async () => {
      if(!window.ethereum) return;

      try {
          // Force MetaMask to open the account picker
          await window.ethereum.request({
            method: 'wallet_requestPermissions',
            params: [{ eth_accounts: {} }],
          });
          
          // The 'accountsChanged' event listener will handle the rest
      } catch (err) {
          console.error("Switch account cancelled or failed", err);
      }
  };

  // --- 3. WALLET CONNECTION LOGIC ---
  const connectWallet = async (promptUser = false) => {
    if (!window.ethereum) {
      const err = 'MetaMask not detected. Please install it.';
      setStatus(err);
      throw new Error(err);
    }
    
    setStatus('Connecting to MetaMask...');
    try {
      const walletClient = createWalletClient({
        chain: somniaTestnet,
        transport: custom(window.ethereum),
      });

      let accounts;
      if (promptUser) {
        accounts = await walletClient.requestAddresses();
      } else {
        accounts = await walletClient.getAddresses();
      }

      if (!accounts || accounts.length === 0) {
        const err = 'Could not connect to account. Please try again.';
        setStatus(err);
        throw new Error(err);
      }
      
      return { walletClient, accountAddress: accounts[0] };
    } catch (err) {
      console.error("Wallet connection error:", err);
      setStatus('Error connecting wallet. Check console.');
      throw err;
    }
  };

  const disconnectWallet = useCallback(() => {
    setWallet(null);
    setAccount(null);
    setUserName('');
    setDetectedAddress(null);
    setBalance(0);
    setPositions({});
    setAlerts({});
    setSelectedPosition(null);
    setStatus('Wallet disconnected. Please connect again.');
  }, []);

  // Listen for account changes in MetaMask
  useEffect(() => {
    const { ethereum } = window;
    if (!ethereum) return; // No wallet

    const handleAccountsChanged = (accounts) => {
      if (accounts.length > 0) {
        const newAccount = accounts[0];
        console.log("MetaMask account switched to:", newAccount);
        
        setDetectedAddress(newAccount); // Always update detected address

        const savedName = localStorage.getItem(newAccount);

        if (savedName) {
            // Known account: Switch automatically
            const newWalletClient = createWalletClient({
                chain: somniaTestnet,
                transport: custom(window.ethereum),
                account: newAccount,
            });
            setWallet(newWalletClient);
            setAccount(newAccount);
            setUserName(savedName);
        } else {
            // Unknown account: Force Logout to Login Screen
            console.log("New account detected without name. Redirecting to login.");
            setWallet(null);
            setAccount(null);
            setUserName(''); // Clear name so user must enter new one
            setStatus('New account detected. Please enter a name.');
        }

      } else {
        console.log("MetaMask user disconnected.");
        disconnectWallet();
      }
    };

    ethereum.on('accountsChanged', handleAccountsChanged);
    return () => {
      ethereum.removeListener('accountsChanged', handleAccountsChanged);
    };
  }, [disconnectWallet]);

  useEffect(() => {
    if (!account) return;

    const fetchBalance = async () => {
      try {
        const balanceWei = await publicClient.getBalance({ address: account });
        // Use viem's formatEther instead of ethers
        const balanceEth = Number(formatEther(balanceWei));
        setBalance(balanceEth);
      } catch (err) {
        console.error("Failed to fetch balance:", err);
        setBalance(0); // Reset on error
      }
    };

    fetchBalance();
  }, [account]);

  // --- 4. SUBSCRIBE TO STREAMS (THE CORE!) ---
  useEffect(() => {
    if (!account) {
      setPositions({});
      setAlerts({});
      setSelectedPosition(null);
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
                [positionId]: {
                  level: RISK_LEVELS[Number(riskLevel)],
                  time: new Date().toLocaleTimeString()
                }
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

  const openPosition = async (positionData) => {
    if (!wallet || !account) return alert("Wallet not connected");
    
    const { collateral, leverage, asset, protectionSettings } = positionData;
    
    setStatus("Opening position...");
    try {
      const { request } = await publicClient.simulateContract({
        account,
        address: CONTRACT_ADDRESSES.manager,
        abi: LeverageManagerABI.abi,
        functionName: 'openPosition',
        args: [
          BigInt(collateral * 10**8), // Use the collateral from modal
          BigInt(leverage), // Use the leverage from modal
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

      const newPosition = {
        entryPrice: Number(posData.entryPrice) / 10**8,
        leverage: leverage,
        collateral: Number(posData.collateral) / 10**8,
        healthFactor: 1,
        id: Number(newPosId),
        asset: asset
      };

      setPositions(prev => ({
        ...prev,
        [Number(newPosId)]: newPosition
      }));

      // Store protection settings for this position
      setProtectionSettings(prev => ({
        ...prev,
        [Number(newPosId)]: protectionSettings
      }));

      // Auto-select the new position
      setSelectedPosition(Number(newPosId));

      // Manually add a "Safe" alert for the new position
      setAlerts(prev => ({...prev, [Number(newPosId)]: {level: "Safe", time: new Date().toLocaleTimeString()}}))

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
      
      // --- NEW: Automatically check risk on all positions after price change ---
      Object.keys(positions).forEach(posId => {
        checkRisk(posId, true); // Pass true for a silent check
      });

    } catch (err) { 
      console.error("Simulate price error:", err);
      setStatus("Error setting price. Check console.");
    }
  };

  const checkRisk = async (positionId, silent = false) => {
    if (!wallet || !account) return alert("Wallet not connected");
    if (!silent) setStatus(`Checking risk for position ${positionId}...`);
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
      if (!silent) setStatus(`Risk check sent. Alert stream will update status.`);
    } catch (err) { 
      console.error("Check risk error:", err);
      if (!silent) setStatus("Error checking risk. Check console.");
    }
  };

  // --- 6. HELPER & RENDER FUNCTIONS ---
  
  const getPnl = (position) => {
    if (!position.entryPrice) return 0;
    const size = (position.collateral * position.leverage) / position.entryPrice;
    const pnl = (livePrice - position.entryPrice) * size;
    return pnl;
  };
  
  const getLiqPrice = (position) => {
    if (!position.entryPrice || !position.leverage) return 0;
    // For Long: LP = EntryPrice * (1 - (1 / Leverage))
    const liqPrice = position.entryPrice - (position.entryPrice / position.leverage);
    return liqPrice;
  };
  
  // --- Get color class for risk ---
  const getRiskColor = (level) => {
    if (level === "Critical" || level === "Immediate Risk") return 'text-red-500';
    if (level === "Warning") return 'text-yellow-500';
    return 'text-green-500';
  };
  
  const getRiskBgColor = (level) => {
    if (level === "Critical" || level === "Immediate Risk") return 'bg-red-500 text-white';
    if (level === "Warning") return 'bg-yellow-500 text-black';
    return 'bg-green-600 text-white';
  };

  const getHealthColor = (health) => {
    if (health >= 80) return 'text-green-400';
    if (health >= 60) return 'text-yellow-400';
    if (health >= 40) return 'text-orange-400';
    return 'text-red-400';
  };

  const getHealthBgColor = (health) => {
    if (health >= 80) return 'bg-green-500';
    if (health >= 60) return 'bg-yellow-500';
    if (health >= 40) return 'bg-orange-500';
    return 'bg-red-500';
  };

  // Get selected position data
  const selectedPositionData = selectedPosition ? positions[selectedPosition] : null;

  // --- RENDER: Connect Wallet Page ---
  if (!account) {
    return (
      <div className="min-h-screen bg-brand-darkest text-gray-200 flex items-center justify-center p-8 font-sans">
        <div className="max-w-xl w-full text-center bg-brand-dark p-10 rounded-lg shadow-2xl">
          {/* Use the logo here. Assumes logo is in /public/GuardTrade Logo.png */}
          <img src="/GuardTrade Logo.png" alt="GuardTrade Logo" className="h-16 mx-auto mb-6" />
          <p className="text-xl text-white mb-4">
            Welcome to your hyper-vigilant co-pilot for leveraged trading.
          </p>
          <p className="text-gray-300 text-base mb-8">
            GuardTrade monitors your positions in real-time, providing proactive warnings and automated protection to prevent liquidation before it's too late.
          </p>
          
          {/* --- NEW: Name Input --- */}
          <div className="mb-6">
            <label htmlFor="userName" className="block text-sm font-medium text-gray-300 mb-2">
              Enter Name for this Account
            </label>
            
            {detectedAddress && (
                <div className="mb-4 p-3 bg-brand-darkest rounded border border-brand-gray-medium text-xs font-mono text-gray-400">
                    Target Wallet: {detectedAddress}
                </div>
            )}

            <input
              id="userName"
              type="text"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              placeholder="e.g., Vitalik Buterin"
              className="w-full bg-brand-darkest border border-brand-gray-medium rounded-lg py-3 px-4 text-white focus:outline-none focus:ring-2 focus:ring-brand-lightest"
            />
          </div>
          
          <p className="text-gray-400 mb-6 min-h-5 text-base">{status}</p>
          
          <div className="space-y-3">
            <button
                onClick={handleConnect}
                disabled={!userName.trim()}
                className="w-full bg-brand-lightest hover:bg-brand-light text-brand-darkest font-bold py-3 px-4 rounded-lg transition-transform transform hover:scale-105 text-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {detectedAddress ? "Save Name & Enter" : "Connect Wallet & Enter"}
            </button>
            
            <button
                onClick={handleSwitchAccount}
                className="w-full bg-transparent border border-gray-600 hover:bg-gray-800 text-gray-300 font-medium py-3 px-4 rounded-lg transition"
            >
                Switch Wallet
            </button>
          </div>

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
              {/* --- NEW: Display User Name --- */}
              <div className="text-lg font-semibold text-white">{userName}</div>
              <div className="text-base font-mono bg-brand-dark px-3 py-1 rounded-md text-gray-300">
                {truncateAddress(account)}
              </div>
            </div>
            <button
              onClick={handleSwitchAccount}
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

        {/* --- Section 1: Global Portfolio Health --- */}
        <section className="mb-8">
          <h2 className="text-3xl font-serif mb-4 text-white">Global Portfolio</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            
            {/* Card 1: Total Value & Health */}
            <div className="bg-brand-dark p-6 rounded-lg shadow-lg">
              <p className="text-sm text-gray-300 uppercase">Total Portfolio Value</p>
              <p className="text-4xl font-mono font-bold text-white">
                {formatCurrency(totalPortfolioValue)}
              </p>
              <div className="flex items-center mt-3">
                <div className="w-full bg-brand-darkest rounded-full h-3 mr-3">
                  <div
                    className={`h-3 rounded-full ${getHealthBgColor(portfolioHealth)}`}
                    style={{ width: `${portfolioHealth}%` }}
                  ></div>
                </div>
                <span className={`text-sm font-bold ${getHealthColor(portfolioHealth)}`}>
                  {portfolioHealth.toFixed(0)}/100
                </span>
              </div>
              <p className="text-sm text-gray-300 mt-2">Global Health Score</p>
            </div>

            {/* Card 2: Funds Allocation Visual */}
            <div className="bg-brand-dark p-6 rounded-lg shadow-lg">
              <p className="text-sm text-gray-300 uppercase mb-3">Funds Allocation</p>
              {/* Visual representation of fund allocation */}
              <div className="flex w-full h-8 rounded-full overflow-hidden mb-3">
                <div 
                  className="bg-green-500 transition-all duration-500" 
                  style={{width: `${(balance / totalPortfolioValue) * 100}%`}}
                  title={`Idle Funds: ${formatCurrency(balance)}`}
                ></div>
                <div 
                  className="bg-blue-500 transition-all duration-500" 
                  style={{width: `${(activeCollateral / totalPortfolioValue) * 100}%`}}
                  title={`Active Collateral: ${formatCurrency(activeCollateral)}`}
                ></div>
                <div 
                  className="bg-brand-light transition-all duration-500" 
                  style={{width: `${(MOCK_INSURANCE_VAULT / totalPortfolioValue) * 100}%`}}
                  title={`Insurance Vault: ${formatCurrency(MOCK_INSURANCE_VAULT)}`}
                ></div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="text-center">
                  <div className="w-3 h-3 bg-green-500 rounded-full mx-auto mb-1"></div>
                  <div className="text-green-400 font-medium">Idle</div>
                  <div className="text-gray-400">{formatCurrency(balance)}</div>
                </div>
                <div className="text-center">
                  <div className="w-3 h-3 bg-blue-500 rounded-full mx-auto mb-1"></div>
                  <div className="text-blue-400 font-medium">Active</div>
                  <div className="text-gray-400">{formatCurrency(activeCollateral)}</div>
                </div>
                <div className="text-center">
                  <div className="w-3 h-3 bg-brand-light rounded-full mx-auto mb-1"></div>
                  <div className="text-brand-lightest font-medium">Vault</div>
                  <div className="text-gray-400">{formatCurrency(MOCK_INSURANCE_VAULT)}</div>
                </div>
              </div>
            </div>

            {/* Card 3: Risk Overview */}
            <div className="bg-brand-dark p-6 rounded-lg shadow-lg">
              <p className="text-sm text-gray-300 uppercase">Risk Overview</p>
              <div className="mt-3 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-gray-300">Active Positions:</span>
                  <span className="text-white font-bold">{Object.keys(positions).length}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-300">At Risk:</span>
                  <span className="text-red-400 font-bold">
                    {Object.values(alerts).filter(alert => alert.level !== "Safe").length}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-300">Protected:</span>
                  <span className="text-green-400 font-bold">
                    {Object.values(alerts).filter(alert => alert.level === "Safe").length}
                  </span>
                </div>
              </div>
            </div>
            
            {/* Card 4: Quick Actions */}
            <div className="bg-brand-dark p-6 rounded-lg shadow-lg flex flex-col justify-center">
              <button
                onClick={() => setIsOpenPositionModal(true)}
                className="w-full bg-brand-lightest hover:bg-brand-light text-brand-darkest font-bold py-3 px-4 rounded-lg transition transform hover:scale-105 text-lg mb-3"
              >
                🛡️ Open Protected Position
              </button>
              <p className="text-sm text-gray-300 text-center">Custom leverage & protection</p>
            </div>

          </div>
        </section>

        {/* --- Dashboard Layout (Main + Sidebar) --- */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* --- Section 2: Active Positions (Main Column) --- */}
          <main className="lg:col-span-2 space-y-6">
            
            {/* Positions Table */}
            <div>
              <h2 className="text-3xl font-serif mb-4 text-white">Active Positions</h2>
              <div className="bg-brand-dark rounded-lg shadow-lg overflow-hidden">
                <table className="w-full text-left">
                  <thead className="border-b border-brand-darkest">
                    <tr className="text-sm text-gray-300 uppercase">
                      <th className="p-4">Pair / Direction</th>
                      <th className="p-4">Size / Entry</th>
                      <th className="p-4">Live P&L</th>
                      <th className="p-4">Liq. Price</th>
                      <th className="p-4">Health Factor</th>
                      <th className="p-4">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.keys(positions).length === 0 ? (
                      <tr>
                        <td colSpan="6" className="p-10 text-center text-gray-400">
                          <p className="text-xl">No active positions.</p>
                          <p className="text-base mt-2">
                            Click "Open Protected Position" above to get started.
                          </p>
                        </td>
                      </tr>
                    ) : (
                      Object.values(positions).map(pos => {
                        const pnl = getPnl(pos);
                        const liqPrice = getLiqPrice(pos);
                        const size = pos.collateral * pos.leverage;
                        const alert = alerts[pos.id] || {level: "Safe"};
                        const healthPercent = Math.max(0, pos.healthFactor * 100);
                        const isSelected = selectedPosition === pos.id;
                        const posProtection = protectionSettings[pos.id];
                        
                        return (
                          <tr 
                            key={pos.id} 
                            className={`border-b border-brand-darkest hover:bg-brand-darkest transition cursor-pointer ${
                              isSelected ? 'bg-brand-darkest ring-2 ring-brand-lightest' : ''
                            }`}
                            onClick={() => setSelectedPosition(pos.id)}
                          >
                            <td className="p-4">
                              <div className="font-bold text-white">{pos.asset || 'ETH'}/USD</div>
                              <div className="text-sm text-green-400">{pos.leverage}x LONG</div>
                              {posProtection?.autoAddCollateral && (
                                <div className="text-xs text-brand-lightest mt-1">🛡️ Protected</div>
                              )}
                            </td>
                            <td className="p-4 font-mono">
                              <div className="text-white">{formatCurrency(size)}</div>
                              <div className="text-sm text-gray-400">@{formatCurrency(pos.entryPrice)}</div>
                            </td>
                            <td className={`p-4 font-mono font-bold ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                              {pnl >= 0 ? '+' : ''}{formatCurrency(pnl)}
                              <div className="text-xs text-gray-400">
                                {((pnl / (pos.collateral)) * 100).toFixed(1)}%
                              </div>
                            </td>
                            <td className="p-4 font-mono text-red-400 font-bold">
                              {formatCurrency(liqPrice)}
                            </td>
                            <td className="p-4">
                              <div className="w-full bg-brand-darkest rounded-full h-4 mb-2">
                                <div
                                  className="h-4 rounded-full transition-all duration-300"
                                  style={{ 
                                    width: `${Math.min(100, healthPercent)}%`,
                                    background: healthPercent >= 70 ? 'linear-gradient(90deg, #10B981, #22C55E)' : 
                                               healthPercent >= 40 ? 'linear-gradient(90deg, #F59E0B, #EAB308)' : 
                                               'linear-gradient(90deg, #EF4444, #DC2626)'
                                  }}
                                ></div>
                              </div>
                              <div className={`text-sm font-mono ${getRiskColor(alert.level)}`}>
                                {healthPercent.toFixed(1)}%
                              </div>
                            </td>
                            <td className="p-4">
                              <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold ${getRiskBgColor(alert.level)}`}>
                                {alert.level}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Position Details & Chart Section */}
            {selectedPositionData && (
              <div className="bg-brand-dark p-6 rounded-lg shadow-lg">
                <h2 className="text-2xl font-serif mb-4 text-white">
                  Position Details #{selectedPosition}
                  {protectionSettings[selectedPosition]?.autoAddCollateral && (
                    <span className="ml-3 text-sm bg-green-500 text-white px-2 py-1 rounded-full">🛡️ Protected</span>
                  )}
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  
                  {/* Chart Placeholder */}
                  <div className="bg-brand-darkest p-4 rounded-lg">
                    <h3 className="text-lg font-semibold text-white mb-3">Live Price Chart</h3>
                    <div className="h-48 flex items-center justify-center bg-brand-dark rounded">
                      <div className="text-center text-gray-400">
                        <div className="text-2xl mb-2">📊</div>
                        <p>Live chart for {selectedPositionData.asset || 'ETH'}/USD</p>
                        <p className="text-sm mt-1">Current: {formatCurrency(livePrice)}</p>
                        <p className="text-sm">Entry: {formatCurrency(selectedPositionData.entryPrice)}</p>
                        <p className="text-sm text-red-400">
                          Liquidation: {formatCurrency(getLiqPrice(selectedPositionData))}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Position Metrics */}
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold text-white">Key Metrics</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-brand-darkest p-3 rounded">
                        <p className="text-sm text-gray-400">Collateral</p>
                        <p className="text-lg font-bold text-white">
                          {formatCurrency(selectedPositionData.collateral)}
                        </p>
                      </div>
                      <div className="bg-brand-darkest p-3 rounded">
                        <p className="text-sm text-gray-400">Leverage</p>
                        <p className="text-lg font-bold text-yellow-400">
                          {selectedPositionData.leverage}x
                        </p>
                      </div>
                      <div className="bg-brand-darkest p-3 rounded">
                        <p className="text-sm text-gray-400">Position Size</p>
                        <p className="text-lg font-bold text-white">
                          {formatCurrency(selectedPositionData.collateral * selectedPositionData.leverage)}
                        </p>
                      </div>
                      <div className="bg-brand-darkest p-3 rounded">
                        <p className="text-sm text-gray-400">Distance to Liq.</p>
                        <p className="text-lg font-bold text-red-400">
                          {((livePrice - getLiqPrice(selectedPositionData)) / livePrice * 100).toFixed(1)}%
                        </p>
                      </div>
                    </div>
                    
                    {/* Protection Settings */}
                    {protectionSettings[selectedPosition] && (
                      <div className="bg-brand-darkest p-4 rounded">
                        <p className="text-sm text-gray-400 mb-2">Protection Settings</p>
                        <div className="flex flex-wrap gap-2">
                          {protectionSettings[selectedPosition].autoAddCollateral && (
                            <span className="text-xs bg-green-500 text-white px-2 py-1 rounded">Auto-Collateral</span>
                          )}
                          {protectionSettings[selectedPosition].emergencyClose && (
                            <span className="text-xs bg-blue-500 text-white px-2 py-1 rounded">Emergency Close</span>
                          )}
                          {protectionSettings[selectedPosition].insuranceVault && (
                            <span className="text-xs bg-brand-light text-brand-darkest px-2 py-1 rounded">Vault Access</span>
                          )}
                        </div>
                      </div>
                    )}
                    
                    <div className="bg-brand-darkest p-4 rounded">
                      <p className="text-sm text-gray-400 mb-2">Current Status</p>
                      <div className="flex items-center justify-between">
                        <span className={`text-lg font-bold ${getRiskColor(alerts[selectedPosition]?.level || "Safe")}`}>
                          {alerts[selectedPosition]?.level || "Safe"}
                        </span>
                        <button
                          onClick={() => checkRisk(selectedPosition)}
                          className="bg-brand-gray-medium hover:bg-brand-light hover:text-brand-darkest text-white py-2 px-4 rounded transition"
                        >
                          Check Risk
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </main>
          
          {/* --- Sidebar --- */}
          <aside className="lg:col-span-1 space-y-6">
            
            {/* Live Market Card */}
            <div className="bg-brand-dark p-6 rounded-lg shadow-lg">
              <h2 className="text-2xl font-serif mb-4 text-white">Live Market</h2>
              <div className="text-center">
                <p className="text-sm text-gray-300 uppercase">ETH-USD</p>
                <p className="text-5xl font-mono font-bold text-white my-4">
                  {formatCurrency(livePrice)}
                </p>
                <div className="text-sm text-gray-400">
                  Real-time via Somnia Streams
                </div>
              </div>
            </div>
            
            {/* Insurance Vault Card */}
            <div className="bg-brand-dark p-6 rounded-lg shadow-lg">
              <h2 className="text-2xl font-serif mb-4 text-white">Insurance Vault</h2>
              <div className="text-center mb-4">
                <p className="text-sm text-gray-300 uppercase">Vault Balance</p>
                <p className="text-4xl font-mono font-bold text-white my-3">
                  {formatCurrency(MOCK_INSURANCE_VAULT)}
                </p>
                <div className="w-24 h-24 mx-auto mb-4 relative">
                  <svg className="w-full h-full" viewBox="0 0 36 36">
                    <path
                      d="M18 2.0845
                        a 15.9155 15.9155 0 0 1 0 31.831
                        a 15.9155 15.9155 0 0 1 0 -31.831"
                      fill="none"
                      stroke="#374151"
                      strokeWidth="3"
                    />
                    <path
                      d="M18 2.0845
                        a 15.9155 15.9155 0 0 1 0 31.831
                        a 15.9155 15.9155 0 0 1 0 -31.831"
                      fill="none"
                      stroke="#60A5FA"
                      strokeWidth="3"
                      strokeDasharray="70, 100"
                    />
                    <text x="18" y="20.5" textAnchor="middle" fill="#60A5FA" fontSize="8" fontWeight="bold">70%</text>
                  </svg>
                </div>
                <p className="text-sm text-gray-300">Protection Coverage</p>
              </div>
              <div className="flex gap-2">
                <button className="flex-1 bg-brand-gray-medium text-white py-2 px-3 rounded opacity-50 cursor-not-allowed text-sm">
                  Deposit
                </button>
                <button className="flex-1 bg-brand-gray-medium text-white py-2 px-3 rounded opacity-50 cursor-not-allowed text-sm">
                  Withdraw
                </button>
              </div>
            </div>
            
            {/* Alerts Panel */}
            <div className="bg-brand-dark p-6 rounded-lg shadow-lg">
              <h2 className="text-2xl font-serif mb-4 text-white">Active Alerts</h2>
              <div className="space-y-3 max-h-64 overflow-y-auto">
                {Object.keys(alerts).length === 0 ? (
                  <div className="text-center py-4">
                    <div className="text-2xl mb-2">✅</div>
                    <p className="text-base text-gray-400">No active alerts</p>
                    <p className="text-sm text-gray-500">All positions are safe</p>
                  </div>
                ) : (
                  Object.entries(alerts).map(([posId, alert]) => (
                    <div 
                      key={posId} 
                      className={`p-3 rounded-lg border-l-4 ${
                        alert.level === "Critical" || alert.level === "Immediate Risk" 
                          ? 'border-red-500 bg-red-500/10' 
                          : alert.level === "Warning" 
                          ? 'border-yellow-500 bg-yellow-500/10'
                          : 'border-green-500 bg-green-500/10'
                      }`}
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <div className={`font-bold ${
                            alert.level === "Critical" || alert.level === "Immediate Risk" 
                              ? 'text-red-400' 
                              : alert.level === "Warning" 
                              ? 'text-yellow-400'
                              : 'text-green-400'
                          }`}>
                            {alert.level.toUpperCase()}
                          </div>
                          <p className="text-sm text-gray-200 mt-1">Position #{posId}</p>
                        </div>
                        <span className="text-xs text-gray-400">{alert.time}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
            
            {/* Demo Controls */}
            <div className="bg-brand-dark p-6 rounded-lg shadow-lg">
              <h2 className="text-2xl font-serif mb-4 text-white">Demo Controls</h2>
              <p className="text-sm text-gray-300 mb-3">Simulate ETH Price Changes</p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => simulatePrice(3200)}
                  className="bg-green-600 hover:bg-green-500 text-white py-3 px-4 rounded-lg transition font-semibold"
                >
                  🚀 $3,200
                </button>
                <button
                  onClick={() => simulatePrice(3000)}
                  className="bg-brand-gray-medium hover:bg-brand-light hover:text-brand-darkest text-white py-3 px-4 rounded-lg transition font-semibold"
                >
                  ⚖️ $3,000
                </button>
                <button
                  onClick={() => simulatePrice(2700)}
                  className="bg-yellow-600 hover:bg-yellow-500 text-white py-3 px-4 rounded-lg transition font-semibold"
                >
                  ⚠️ $2,700
                </button>
                <button
                  onClick={() => simulatePrice(2400)}
                  className="bg-red-600 hover:bg-red-500 text-white py-3 px-4 rounded-lg transition font-semibold"
                >
                  🔴 $2,400
                </button>
              </div>
            </div>

          </aside>
        </div>
      </div>

      {/* Open Position Modal */}
      <OpenPositionModal
        isOpen={isOpenPositionModal}
        onClose={() => setIsOpenPositionModal(false)}
        onPositionOpened={openPosition}
        livePrice={livePrice}
      />
    </div>
  );
}

export default App;