import { useState, useEffect, useCallback } from 'react';
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

const CONTRACT_ADDRESSES = {
  oracle: '0x01848F70e8D709891f960B7c7e7F62296CeFB7B5',
  manager: '0x57b26fFb2C9E1858088c2C6f75Bcd7389F7a3708',
  guardian: '0x7D34EbDDea65ac01891DDd7bbce4A802a7982BF1'
};

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
const RISK_LEVELS = ["Safe", "Warning", "Critical", "Immediate Risk"];

const publicClient = createPublicClient({
  chain: somniaTestnet,
  transport: http(),
});

const truncateAddress = (address) => {
  if (!address) return '';
  return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
};

// --- PALETTE CONFIGURATION ---
const PALETTE = {
  background: '#1A1423',
  surface: '#2C2337',
  secondary: '#3D314A',
  muted: '#684756',
  accent1: '#7F5C59',
  accent2: '#96705B',
  primary: '#AB8476',
};

// --- MOCK DATA FOR GLOBAL PORTFOLIO ---
const MOCK_WALLET_BALANCE = 5000; // $5,000 in "Idle Funds"
const MOCK_INSURANCE_VAULT = 2500; // $2,500 in "Insurance Vault"
// ----------------------------------------

const OpenPositionModal = ({ isOpen, onClose, onPositionOpened, livePrice, priceHistory, initialData }) => {
  const [step, setStep] = useState(1); 
  const [selectedAsset, setSelectedAsset] = useState('ETH');
  const [leverage, setLeverage] = useState(3);
  const [collateral, setCollateral] = useState(1000);
  const [positionType, setPositionType] = useState(0); // 0 = Long, 1 = Short
  const [protectionSettings, setProtectionSettings] = useState({
    autoAddCollateral: true,
    partialReduce: false,
    emergencyClose: true,
    insuranceVault: true
  });

  useEffect(() => {
    if (isOpen) {
      setStep(1);
      // Use initialData if provided (for Re-opening previous positions), otherwise defaults
      setSelectedAsset(initialData?.asset || 'ETH');
      setLeverage(initialData?.leverage || 3);
      setCollateral(initialData?.collateral || 1000);
      // If initialData has type, use it, else default to 0 (Long)
      setPositionType(initialData?.positionType !== undefined ? initialData.positionType : 0);
      setProtectionSettings({
        autoAddCollateral: true,
        partialReduce: false,
        emergencyClose: true,
        insuranceVault: true
      });
    }
  }, [isOpen, initialData]);

  // --- KEY METRIC CALCULATIONS ---
  // 1. Position Size: The total value controlled by the user
  const positionSize = collateral * leverage;

  // 2. Liquidation Price: The price at which the position is wiped out.
  // Formula depends on Long vs Short.
  // Long: Entry * (1 - 1/Leverage)
  // Short: Entry * (1 + 1/Leverage)
  let liquidationPrice = 0;
  if (positionType === 0) { // Long
    liquidationPrice = livePrice * (1 - (1 / leverage));
  } else { // Short
    liquidationPrice = livePrice * (1 + (1 / leverage));
  }

  // 3. Distance to Liquidation: Percentage move required to hit liquidation.
  const distanceToLiquidation = Math.abs((livePrice - liquidationPrice) / livePrice) * 100;

  const riskLevel = distanceToLiquidation > 20 ? 'Safe' : 
                   distanceToLiquidation > 10 ? 'Warning' : 
                   distanceToLiquidation > 5 ? 'Critical' : 'Immediate Risk';

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
      <div className="bg-surface rounded-xl shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-y-auto border border-secondary">
        
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-secondary">
          <h2 className="text-2xl font-serif text-primary">
            {initialData ? "Reinvest: Open Position" : "Open New Position"}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-primary text-2xl transition-colors">×</button>
        </div>

        {/* Progress Steps */}
        <div className="flex justify-center py-4 border-b border-secondary bg-background/50">
          <div className="flex items-center space-x-8">
            {[1, 2, 3].map((stepNum) => (
              <div key={stepNum} className="flex items-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                  step >= stepNum ? 'bg-primary text-background' : 'bg-secondary text-gray-400'
                } font-bold`}>
                  {stepNum}
                </div>
                <span className={`ml-2 text-sm font-medium ${
                  step >= stepNum ? 'text-primary' : 'text-gray-500'
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
                
                {/* Asset & Type Selection */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Asset</label>
                    <div className="flex gap-2">
                      {['ETH', 'BTC'].map(asset => (
                        <button
                          key={asset}
                          onClick={() => setSelectedAsset(asset)}
                          className={`flex-1 p-3 rounded-lg border transition-all ${
                            selectedAsset === asset 
                              ? 'border-primary bg-primary/10 text-primary' 
                              : 'border-secondary bg-background text-gray-400 hover:border-primary/50'
                          }`}
                        >
                          <div className="font-bold">{asset}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Position Type</label>
                    <div className="flex gap-2">
                       <button
                          onClick={() => setPositionType(0)}
                          className={`flex-1 p-3 rounded-lg border transition-all ${
                            positionType === 0 
                              ? 'border-green-500 bg-green-500/10 text-green-500' 
                              : 'border-secondary bg-background text-gray-400 hover:border-gray-500'
                          }`}
                        >
                          <div className="font-bold">LONG</div>
                        </button>
                        <button
                          onClick={() => setPositionType(1)}
                          className={`flex-1 p-3 rounded-lg border transition-all ${
                            positionType === 1 
                              ? 'border-red-500 bg-red-500/10 text-red-500' 
                              : 'border-secondary bg-background text-gray-400 hover:border-gray-500'
                          }`}
                        >
                          <div className="font-bold">SHORT</div>
                        </button>
                    </div>
                  </div>
                </div>

                {/* Leverage Selection */}
                <div>
                  <div className="flex justify-between items-end mb-3">
                    <label className="block text-sm font-medium text-gray-300">
                      Leverage
                    </label>
                    <span className="text-primary font-bold text-xl">{leverage}x</span>
                  </div>
                  <div className="space-y-2">
                    <input
                      type="range"
                      min="1"
                      max="10"
                      step="1"
                      value={leverage}
                      onChange={(e) => setLeverage(Number(e.target.value))}
                      className="w-full h-2 bg-secondary rounded-lg appearance-none cursor-pointer accent-primary"
                    />
                    <div className="flex justify-between text-xs text-gray-400">
                      <span>1x</span>
                      <span>5x</span>
                      <span>10x</span>
                    </div>
                  </div>
                </div>

                {/* Collateral Input */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-3">
                    Collateral (Investment)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-3 text-gray-400">$</span>
                    <input
                      type="number"
                      value={collateral}
                      onChange={(e) => setCollateral(Number(e.target.value))}
                      className="w-full bg-background border border-secondary rounded-lg py-3 pl-8 pr-4 text-white focus:outline-none focus:ring-2 focus:ring-primary"
                      placeholder="0.00"
                    />
                  </div>
                  <div className="flex gap-2 mt-2">
                    {[500, 1000, 2500, 5000].map(amount => (
                      <button
                        key={amount}
                        onClick={() => setCollateral(amount)}
                        className="text-xs bg-secondary hover:bg-muted text-gray-300 py-1 px-3 rounded transition-colors"
                      >
                        ${amount}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Right Column - Live Metrics */}
              <div className="bg-background/50 rounded-lg p-6 border border-secondary flex flex-col justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-white mb-6">Trade Analysis</h3>
                  
                  <div className="space-y-6">
                    {/* Metric 1: Position Size */}
                    <div className="group relative">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-gray-400 border-b border-dashed border-gray-600 cursor-help">Position Size</span>
                        <span className="text-white font-mono text-lg">{formatCurrency(positionSize)}</span>
                      </div>
                      <p className="text-xs text-gray-500">
                        Total purchasing power controlled (Collateral × Leverage).
                      </p>
                    </div>
                    
                    {/* Metric 2: Leverage */}
                     <div className="group relative">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-gray-400 border-b border-dashed border-gray-600 cursor-help">Effective Leverage</span>
                        <span className="text-primary font-mono text-lg">{leverage}x</span>
                      </div>
                      <p className="text-xs text-gray-500">
                        Multiplies your profit and loss exposure. High leverage increases risk.
                      </p>
                    </div>

                    {/* Metric 3: Liquidation Price */}
                    <div className="group relative">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-gray-400 border-b border-dashed border-gray-600 cursor-help">Liquidation Price</span>
                        <span className="text-red-400 font-mono font-bold text-lg">{formatCurrency(liquidationPrice)}</span>
                      </div>
                      <p className="text-xs text-gray-500">
                        {positionType === 0 
                          ? `If price drops to this level, you lose your collateral.` 
                          : `If price rises to this level, you lose your collateral.`}
                      </p>
                    </div>
                    
                    {/* Metric 4: Distance to Liquidation */}
                    <div className="group relative bg-secondary/30 p-3 rounded-lg border border-secondary">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-gray-300 font-medium">Distance to Liq.</span>
                        <span className={`font-mono font-bold text-xl ${
                          riskLevel === 'Safe' ? 'text-green-400' :
                          riskLevel === 'Warning' ? 'text-yellow-400' :
                          riskLevel === 'Critical' ? 'text-orange-400' : 'text-red-400'
                        }`}>
                          {distanceToLiquidation.toFixed(2)}%
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 mb-2">
                        The {positionType === 0 ? "drop" : "rise"} in price required to trigger liquidation.
                      </p>
                      
                      {/* Visual Bar */}
                      <div className="w-full bg-secondary rounded-full h-2">
                        <div 
                          className={`h-2 rounded-full transition-all duration-300 ${
                            riskLevel === 'Safe' ? 'bg-green-500' :
                            riskLevel === 'Warning' ? 'bg-yellow-500' :
                            riskLevel === 'Critical' ? 'bg-orange-500' : 'bg-red-500'
                          }`}
                          style={{ width: `${Math.max(5, Math.min(100, 100 - (distanceToLiquidation * 3)))}%` }}
                        ></div>
                      </div>
                      <div className="flex justify-between text-[10px] text-gray-500 mt-1">
                        <span>Safe</span>
                        <span>Risk</span>
                      </div>
                    </div>

                  </div>
                </div>

                {/* Mini Chart Visualization */}
                <div className="mt-6 bg-background rounded p-3 border border-secondary">
                  <div className="flex justify-between text-xs text-gray-400 mb-1">
                    <span>Current: {formatCurrency(livePrice)}</span>
                    <span className="text-red-400">Liq: {formatCurrency(liquidationPrice)}</span>
                  </div>
                  <div className="relative h-20 bg-surface/30 rounded p-2 overflow-hidden">
                    <div className="absolute inset-0 p-1 opacity-50">
                      <Sparkline data={priceHistory?.ETH} height={70} width={300} />
                    </div>
                    {/* Liquidation Line Visualization */}
                    <div 
                        className="absolute w-full border-t border-red-500/50 border-dashed"
                        style={{ 
                            top: positionType === 0 
                                ? '80%' // Visual approximation for Long (Liq is below)
                                : '20%' // Visual approximation for Short (Liq is above)
                        }}
                    >
                        <span className="absolute right-0 -top-3 text-[10px] text-red-500 bg-background/80 px-1">LIQ LEVEL</span>
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
                  <div key={setting.key} className="flex items-start space-x-4 p-4 bg-background rounded-lg border border-secondary">
                    <div className="flex items-center h-6">
                      <input
                        type="checkbox"
                        checked={protectionSettings[setting.key]}
                        onChange={(e) => setProtectionSettings(prev => ({
                          ...prev,
                          [setting.key]: e.target.checked
                        }))}
                        className="w-4 h-4 text-primary bg-secondary border-secondary rounded focus:ring-primary accent-primary"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="text-white font-medium">{setting.title}</label>
                      <p className="text-sm text-gray-400 mt-1">{setting.description}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="bg-background/50 rounded-lg p-6 border border-secondary">
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
                  
                  <div className="mt-6 p-4 bg-green-900/10 border border-green-500/20 rounded-lg">
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
              <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto shadow-lg shadow-green-900/20 border border-green-500/50">
                <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
                </svg>
              </div>
              
              <h3 className="text-2xl font-serif text-white">Ready to Open Position</h3>
              
              <div className="bg-background rounded-lg p-6 max-w-md mx-auto border border-secondary">
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Asset Pair</span>
                    <span className="text-white font-bold">{selectedAsset}/USD</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Type</span>
                    <span className={positionType === 0 ? "text-green-400 font-bold" : "text-red-400 font-bold"}>
                      {positionType === 0 ? "LONG" : "SHORT"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Leverage</span>
                    <span className="text-primary font-bold">{leverage}x</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Collateral</span>
                    <span className="text-white">{formatCurrency(collateral)}</span>
                  </div>
                  <div className="border-t border-secondary my-2 pt-2"></div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Position Size</span>
                    <span className="text-white font-mono">{formatCurrency(positionSize)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Liquidation Price</span>
                    <span className="text-red-400 font-mono">{formatCurrency(liquidationPrice)}</span>
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
        <div className="flex justify-between p-6 border-t border-secondary bg-background rounded-b-xl">
          <button
            onClick={() => step > 1 ? setStep(step - 1) : onClose()}
            className="px-6 py-3 border border-secondary text-gray-300 rounded-lg hover:bg-secondary transition"
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
                  positionType,
                  protectionSettings
                });
                onClose();
              }
            }}
            className="px-6 py-3 bg-primary hover:bg-accent2 text-background font-bold rounded-lg transition transform hover:scale-105 shadow-lg shadow-primary/20"
          >
            {step === 3 ? 'Open Position' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
};

const formatCurrency = (value) => {
  // Guard against undefined, NaN, and non-finite values
  if (typeof value !== 'number' || !isFinite(value)) value = 0;
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
};

// Simple inline sparkline SVG component
const Sparkline = ({ data = [], width = 300, height = 64, stroke = 'var(--color-primary)', fill = 'var(--color-primary-alpha)' }) => {
  if (!data || data.length === 0) return (
    <svg width={width} height={height} className="w-full h-full" />
  );

  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;

  const points = data.map((v, i) => {
    const x = (i / (data.length - 1 || 1)) * width;
    const y = height - ((v - min) / range) * height;
    return [x, y];
  });

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(' ');
  const fillPathD = `${pathD} L ${width} ${height} L 0 ${height} Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="w-full h-full">
      <defs>
        <linearGradient id="gradient" x1="0" x2="0" y1="0" y2="1">
           <stop offset="0%" stopColor={stroke} stopOpacity="0.2"/>
           <stop offset="100%" stopColor={stroke} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <path d={fillPathD} fill="url(#gradient)" stroke="none" />
      <path d={pathD} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
};

function App() {
  const [wallet, setWallet] = useState(null);
  const [account, setAccount] = useState(null);
  const [status, setStatus] = useState('Please connect your wallet.');
  const [userName, setUserName] = useState('');
  const [balance, setBalance] = useState(0);

  const [detectedAddress, setDetectedAddress] = useState(null);

  const [livePrice, setLivePrice] = useState(3000);
  const [positions, setPositions] = useState({});
  const [history, setHistory] = useState([]); // State for closed positions
  const [activeTab, setActiveTab] = useState('active'); // 'active' or 'history'
  const [alerts, setAlerts] = useState({});
  const [selectedPosition, setSelectedPosition] = useState(null);
  const [isOpenPositionModal, setIsOpenPositionModal] = useState(false);
  const [modalInitialData, setModalInitialData] = useState(null); // Data for re-opening
  const [protectionSettings, setProtectionSettings] = useState({});

  // Maintain a small in-memory price history per asset for sparklines
  const [priceHistory, setPriceHistory] = useState({ ETH: [livePrice] });

  useEffect(() => {
    setPriceHistory(prev => {
      const list = (prev.ETH || []).concat([livePrice]).slice(-60); // keep last 60 samples
      return { ...prev, ETH: list };
    });
  }, [livePrice]);

  const activeCollateral = Object.values(positions).reduce((acc, pos) => acc + pos.collateral, 0);
  const totalPortfolioValue = balance + MOCK_INSURANCE_VAULT + activeCollateral;

  const calculatePortfolioHealth = () => {
    if (Object.keys(positions).length === 0) return 95;
    
    const avgHealth = Object.values(positions).reduce((acc, pos) => {
      const health = Math.max(0, pos.healthFactor || 0) * 100;
      return acc + health;
    }, 0) / Object.keys(positions).length;
    
    return Math.min(95, Math.max(60, avgHealth));
  };

  const portfolioHealth = calculatePortfolioHealth();

  useEffect(() => {
    async function tryAutoConnect() {
      if (!window.ethereum) {
        setStatus('MetaMask not detected. Please install it.');
        return;
      }
      
      try {
        const initialPrice = await publicClient.readContract({
          address: CONTRACT_ADDRESSES.oracle,
          abi: PriceOracleABI.abi,
          functionName: 'getPrice',
          args: ['ETH']
        });
        setLivePrice(Number(initialPrice) / 10**8);

        const accounts = await window.ethereum.request({ method: 'eth_accounts' });
        
        if (accounts && accounts.length > 0) {
          const accountAddress = accounts[0];
          setDetectedAddress(accountAddress); // Store detected address

          const savedName = localStorage.getItem(accountAddress);

          if (savedName) {
            setStatus('Restoring session...');
            const { walletClient, accountAddress: connectedAddress } = await connectWallet(false); // false = don't prompt
            setAccount(connectedAddress);
            setWallet(walletClient);
            setUserName(savedName);
            setStatus('Wallet Connected! Subscribing to streams...');
          } else {
            setStatus('Wallet detected. Please enter a name to continue.');
            setAccount(null); 
            setUserName('');
          }
        } else {
          setStatus('Please connect your wallet.');
        }
      } catch (err) {
        console.error("Auto-connect error:", err);
        setStatus('Error during auto-connect. Please connect manually.');
      }
    }
    tryAutoConnect();
  }, []); 
  const handleConnect = async () => {
    if (!userName.trim()) {
      setStatus("Please enter a name to continue.");
      return;
    }
    
    try {
        let walletClient, accountAddress;

        if (detectedAddress) {
             walletClient = createWalletClient({
                chain: somniaTestnet,
                transport: custom(window.ethereum),
                account: detectedAddress
            });
            accountAddress = detectedAddress;
        } else {
            const result = await connectWallet(true); 
            walletClient = result.walletClient;
            accountAddress = result.accountAddress;
        }

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
          await window.ethereum.request({
            method: 'wallet_requestPermissions',
            params: [{ eth_accounts: {} }],
          });
          
      } catch (err) {
          console.error("Switch account cancelled or failed", err);
      }
  };

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
    setHistory([]);
    setAlerts({});
    setSelectedPosition(null);
    setStatus('Wallet disconnected. Please connect again.');
  }, []);

  useEffect(() => {
    const { ethereum } = window;
    if (!ethereum) return; 

    const handleAccountsChanged = (accounts) => {
      if (accounts.length > 0) {
        const newAccount = accounts[0];
        console.log("MetaMask account switched to:", newAccount);
        
        setDetectedAddress(newAccount); 

        const savedName = localStorage.getItem(newAccount);

        if (savedName) {
            const newWalletClient = createWalletClient({
                chain: somniaTestnet,
                transport: custom(window.ethereum),
                account: newAccount,
            });
            setWallet(newWalletClient);
            setAccount(newAccount);
            setUserName(savedName);
        } else {
            console.log("New account detected without name. Redirecting to login.");
            setWallet(null);
            setAccount(null);
            setUserName(''); 
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
        
        const balanceEth = Number(formatEther(balanceWei));
        setBalance(balanceEth);
      } catch (err) {
        console.error("Failed to fetch balance:", err);
        setBalance(0); 
      }
    };

    fetchBalance();
  }, [account]);

  useEffect(() => {
    if (!account) {
      setPositions({});
      setAlerts({});
      setSelectedPosition(null);
      return;
    }
    
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

    return () => {
      unsubPrice();
      unsubPos();
      unsubRisk();
    };

  }, [account]);


  const openPosition = async (positionData) => {
    if (!wallet || !account) return alert("Wallet not connected");
    
    // Deconstruct with positionType
    const { collateral, leverage, asset, positionType, protectionSettings } = positionData;
    
    setStatus("Opening position...");
    try {
      const { request } = await publicClient.simulateContract({
        account,
        address: CONTRACT_ADDRESSES.manager,
        abi: LeverageManagerABI.abi,
        functionName: 'openPosition',
        args: [
          BigInt(Math.round(collateral * 10**8)), 
          BigInt(leverage), 
          positionType // Use the selected type (0 or 1)
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
        asset: asset,
        positionType: positionType, // Store type
        startDate: new Date().toLocaleString()
      };

      setPositions(prev => ({
        ...prev,
        [Number(newPosId)]: newPosition
      }));

      setProtectionSettings(prev => ({
        ...prev,
        [Number(newPosId)]: protectionSettings
      }));

      // Switch view back to active if opening a new one
      setActiveTab('active');
      setSelectedPosition(Number(newPosId));

      setAlerts(prev => ({...prev, [Number(newPosId)]: {level: "Safe", time: new Date().toLocaleTimeString()}}))

    } catch (err) { 
      console.log("Open position error:", err);
      alert("Error opening position: " + err.message);
      setStatus("Error opening position. Check console.");
    }
  };

  // Simulate Closing a Position and moving it to history
  const handleClosePosition = (posId, e) => {
    e.stopPropagation(); // Prevent row selection
    if (!confirm("Are you sure you want to close this position?")) return;

    const pos = positions[posId];
    if (!pos) return;

    const exitPrice = livePrice;
    const pnl = getPnl(pos);
    
    const historyItem = {
      ...pos,
      exitPrice: exitPrice,
      realizedPnl: pnl,
      closedAt: new Date().toLocaleString()
    };

    // 1. Add to history
    setHistory(prev => [historyItem, ...prev]);

    // 2. Remove from active positions
    setPositions(prev => {
      const newPos = { ...prev };
      delete newPos[posId];
      return newPos;
    });

    // 3. Update mock balance (return collateral + pnl)
    setBalance(prev => prev + pos.collateral + pnl);

    if (selectedPosition === posId) {
      setSelectedPosition(null);
    }

    setStatus(`Position #${posId} closed successfully.`);
  };

  // Prepare modal to reopen a position from history
  const handleReopenPosition = (historyItem, e) => {
    e.stopPropagation();
    setModalInitialData({
      asset: historyItem.asset,
      leverage: historyItem.leverage,
      collateral: historyItem.collateral,
      positionType: historyItem.positionType
    });
    setIsOpenPositionModal(true);
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
      
      Object.keys(positions).forEach(posId => {
        checkRisk(posId, true); 
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

  
  const getPnl = (position) => {
    if (!position.entryPrice) return 0;
    const size = (position.collateral * position.leverage) / position.entryPrice;
    
    // Logic for PnL depends on Long (0) or Short (1)
    if (position.positionType === 1) { // Short
       return (position.entryPrice - livePrice) * size;
    }
    // Default Long
    return (livePrice - position.entryPrice) * size;
  };
  
  const getLiqPrice = (position) => {
    if (!position.entryPrice || !position.leverage) return 0;
    
    // Logic for Liq depends on Long/Short
    if (position.positionType === 1) { // Short
        return position.entryPrice * (1 + (1 / position.leverage));
    }
    // Long
    return position.entryPrice * (1 - (1 / position.leverage));
  };
  
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

  const selectedPositionData = selectedPosition ? positions[selectedPosition] : null;

  return (
    <>
      <style>{`
        :root {
          --color-background: ${PALETTE.background};
          --color-surface: ${PALETTE.surface};
          --color-secondary: ${PALETTE.secondary};
          --color-muted: ${PALETTE.muted};
          --color-accent1: ${PALETTE.accent1};
          --color-accent2: ${PALETTE.accent2};
          --color-primary: ${PALETTE.primary};
          --color-text-main: #F3F4F6;
          --color-text-muted: #9CA3AF;
        }

        body {
          background-color: var(--color-background);
          color: var(--color-text-main);
        }

        .bg-background { background-color: var(--color-background) !important; }
        .bg-surface { background-color: var(--color-surface) !important; }
        .bg-secondary { background-color: var(--color-secondary) !important; }
        .bg-primary { background-color: var(--color-primary) !important; }
        .bg-muted { background-color: var(--color-muted) !important; }
        .bg-accent1 { background-color: var(--color-accent1) !important; }
        .bg-accent2 { background-color: var(--color-accent2) !important; }

        .text-primary { color: var(--color-primary) !important; }
        .text-secondary { color: var(--color-text-muted) !important; }
        .text-background { color: var(--color-background) !important; }
        .text-accent2 { color: var(--color-accent2) !important; }

        .border-secondary { border-color: var(--color-secondary) !important; }
        .border-primary { border-color: var(--color-primary) !important; }

        .hover\\:bg-secondary:hover { background-color: var(--color-secondary) !important; }
        .hover\\:bg-muted:hover { background-color: var(--color-muted) !important; }
        .hover\\:bg-accent2:hover { background-color: var(--color-accent2) !important; }

        .hover\\:text-primary:hover { color: var(--color-primary) !important; }

        /* Scrollbar */
        ::-webkit-scrollbar { width: 8px; }
        ::-webkit-scrollbar-track { background: var(--color-background); }
        ::-webkit-scrollbar-thumb { background: var(--color-secondary); border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: var(--color-muted); }
      `}</style>
      
      {!account ? (
        <div className="min-h-screen bg-background text-gray-200 flex items-center justify-center p-8 font-sans">
          <div className="max-w-xl w-full text-center bg-surface p-10 rounded-xl shadow-2xl border border-secondary">
            {/* Logo updated to valid web path */}
            <img src="/GuardTrade_logo.png" alt="GuardTrade Logo" className="h-20 mx-auto mb-6 drop-shadow-lg" />          
            <p className="text-2xl text-white font-serif mb-4">
              Welcome to GuardTrade
            </p>
            <p className="text-gray-400 text-base mb-8">
              GuardTrade is your hyper-vigilant co-pilot for leveraged trading. It monitors your positions in real-time, providing proactive warnings and automated protection to prevent liquidation before it's too late.
            </p>
            
            <div className="mb-6 text-left">
              <label htmlFor="userName" className="block text-sm font-medium text-primary mb-2">
                Enter Name for this Account
              </label>
              
              {detectedAddress && (
                  <div className="mb-4 p-3 bg-background rounded border border-secondary text-xs font-mono text-gray-400">
                      Target Wallet: {detectedAddress}
                  </div>
              )}

              <input
                id="userName"
                type="text"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder="e.g., Vitalik Buterin"
                className="w-full bg-background border border-secondary rounded-lg py-3 px-4 text-white focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            
            <p className="text-gray-400 mb-6 min-h-5 text-base">{status}</p>
            
            <div className="space-y-3">
              <button
                  onClick={handleConnect}
                  disabled={!userName.trim()}
                  className="w-full bg-primary hover:bg-accent2 text-background font-bold py-3 px-4 rounded-lg transition-transform transform hover:scale-105 text-lg disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
              >
                  {detectedAddress ? "Save Name & Enter" : "Connect Wallet & Enter"}
              </button>
              
              <button
                  onClick={handleSwitchAccount}
                  className="w-full bg-transparent border border-secondary hover:bg-secondary text-gray-300 font-medium py-3 px-4 rounded-lg transition"
              >
                  Switch Wallet
              </button>
            </div>

          </div>
        </div>
      ) : (
        <div className="min-h-screen bg-background text-gray-200 font-sans p-6 sm:p-8">
          <div className="max-w-7xl mx-auto">
            
            {/* --- Header --- */}
            <header className="flex flex-col sm:flex-row justify-between items-center mb-8 pb-4 border-b border-secondary">
              
              <div className="flex items-center gap-4">
                <img src="/GuardTrade_logo.png" alt="GuardTrade Logo" className="h-12 drop-shadow-md" />
                <h1 className="text-5xl font-serif text-white tracking-wide">GuardTrade</h1>
              </div>

              <div className="flex flex-col sm:flex-row items-center gap-4 mt-4 sm:mt-0">
                <div className="text-right">
                  {/* --- Display User Name --- */}
                  <div className="text-lg font-semibold text-primary">{userName}</div>
                  <div className="text-base font-mono bg-surface px-3 py-1 rounded-md text-gray-400 border border-secondary">
                    {truncateAddress(account)}
                  </div>
                </div>
                <button
                  onClick={handleSwitchAccount}
                  className="bg-surface hover:bg-secondary text-white text-base font-medium py-2 px-4 rounded-lg transition border border-secondary"
                >
                  Switch Account
                </button>
                <button
                  onClick={disconnectWallet}
                  className="bg-surface hover:bg-red-900/50 hover:text-red-200 hover:border-red-800 text-white text-base font-medium py-2 px-4 rounded-lg transition border border-secondary"
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
                <div className="bg-surface p-6 rounded-lg shadow-lg border border-secondary">
                  <p className="text-sm text-gray-400 uppercase tracking-wider">Total Portfolio Value</p>
                  <p className="text-4xl font-mono font-bold text-white mt-1">
                    {formatCurrency(totalPortfolioValue)}
                  </p>
                  <div className="flex items-center mt-3">
                    <div className="w-full bg-background rounded-full h-3 mr-3">
                      <div
                        className={`h-3 rounded-full ${getHealthBgColor(portfolioHealth)}`}
                        style={{ width: `${portfolioHealth}%` }}
                      ></div>
                    </div>
                    <span className={`text-sm font-bold ${getHealthColor(portfolioHealth)}`}>
                      {portfolioHealth.toFixed(0)}/100
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">Global Health Score</p>
                </div>

                {/* Card 2: Funds Allocation Visual */}
                <div className="bg-surface p-6 rounded-lg shadow-lg border border-secondary">
                  <p className="text-sm text-gray-400 uppercase mb-3 tracking-wider">Funds Allocation</p>
                  {/* Visual representation of fund allocation */}
                  <div className="flex w-full h-8 rounded-full overflow-hidden mb-3 bg-background">
                    <div 
                      className="bg-green-600 transition-all duration-500" 
                      style={{width: `${(balance / totalPortfolioValue) * 100}%`}}
                      title={`Idle Funds: ${formatCurrency(balance)}`}
                    ></div>
                    <div 
                      className="bg-accent1 transition-all duration-500" 
                      style={{width: `${(activeCollateral / totalPortfolioValue) * 100}%`}}
                      title={`Active Collateral: ${formatCurrency(activeCollateral)}`}
                    ></div>
                    <div 
                      className="bg-primary transition-all duration-500" 
                      style={{width: `${(MOCK_INSURANCE_VAULT / totalPortfolioValue) * 100}%`}}
                      title={`Insurance Vault: ${formatCurrency(MOCK_INSURANCE_VAULT)}`}
                    ></div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="text-center">
                      <div className="w-3 h-3 bg-green-600 rounded-full mx-auto mb-1"></div>
                      <div className="text-green-500 font-medium">Idle</div>
                      <div className="text-gray-400">{formatCurrency(balance)}</div>
                    </div>
                    <div className="text-center">
                      <div className="w-3 h-3 bg-accent1 rounded-full mx-auto mb-1"></div>
                      <div className="text-accent1 font-medium">Active</div>
                      <div className="text-gray-400">{formatCurrency(activeCollateral)}</div>
                    </div>
                    <div className="text-center">
                      <div className="w-3 h-3 bg-primary rounded-full mx-auto mb-1"></div>
                      <div className="text-primary font-medium">Vault</div>
                      <div className="text-gray-400">{formatCurrency(MOCK_INSURANCE_VAULT)}</div>
                    </div>
                  </div>
                </div>

                {/* Card 3: Risk Overview */}
                <div className="bg-surface p-6 rounded-lg shadow-lg border border-secondary">
                  <p className="text-sm text-gray-400 uppercase tracking-wider">Risk Overview</p>
                  <div className="mt-3 space-y-2">
                    <div className="flex justify-between items-center p-2 rounded hover:bg-secondary transition">
                      <span className="text-gray-300">Active Positions:</span>
                      <span className="text-white font-bold">{Object.keys(positions).length}</span>
                    </div>
                    <div className="flex justify-between items-center p-2 rounded hover:bg-secondary transition">
                      <span className="text-gray-300">At Risk:</span>
                      <span className="text-red-400 font-bold">
                        {Object.values(alerts).filter(alert => alert.level !== "Safe").length}
                      </span>
                    </div>
                    <div className="flex justify-between items-center p-2 rounded hover:bg-secondary transition">
                      <span className="text-gray-300">Protected:</span>
                      <span className="text-green-400 font-bold">
                        {Object.values(alerts).filter(alert => alert.level === "Safe").length}
                      </span>
                    </div>
                  </div>
                </div>
                
                {/* Card 4: Quick Actions */}
                <div className="bg-surface p-6 rounded-lg shadow-lg flex flex-col justify-center border border-secondary">
                  <button
                    onClick={() => {
                        setModalInitialData(null);
                        setIsOpenPositionModal(true);
                    }}
                    className="w-full bg-primary hover:bg-accent2 text-background font-bold py-3 px-4 rounded-lg transition transform hover:scale-105 text-lg mb-3 shadow-lg shadow-primary/20"
                  >
                    Open Protected Position
                  </button>
                  <p className="text-sm text-gray-400 text-center">Custom leverage & protection</p>
                </div>

              </div>
            </section>

            {/* --- Dashboard Layout (Main + Sidebar) --- */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* --- Section 2: Positions (Main Column) --- */}
              <main className="lg:col-span-2 space-y-6">
                
                {/* Positions Table Container */}
                <div className="bg-surface rounded-lg shadow-lg overflow-hidden border border-secondary">
                    {/* Tabs */}
                    <div className="flex border-b border-secondary">
                        <button 
                            onClick={() => setActiveTab('active')}
                            className={`flex-1 py-4 text-center font-medium transition ${
                                activeTab === 'active' 
                                ? 'bg-secondary text-primary border-b-2 border-primary' 
                                : 'bg-surface text-gray-400 hover:bg-secondary/50'
                            }`}
                        >
                            Active Positions
                        </button>
                        <button 
                            onClick={() => setActiveTab('history')}
                            className={`flex-1 py-4 text-center font-medium transition ${
                                activeTab === 'history' 
                                ? 'bg-secondary text-primary border-b-2 border-primary' 
                                : 'bg-surface text-gray-400 hover:bg-secondary/50'
                            }`}
                        >
                            Position History
                        </button>
                    </div>

                    {/* Table Content */}
                    <div className="overflow-x-auto">
                        {activeTab === 'active' ? (
                            <table className="w-full text-left">
                            <thead className="border-b border-secondary bg-background">
                                <tr className="text-sm text-primary uppercase tracking-wider">
                                <th className="p-4">Pair</th>
                                <th className="p-4">Size / Entry</th>
                                <th className="p-4">Live P&L</th>
                                <th className="p-4">Liq. Price</th>
                                <th className="p-4">Health</th>
                                <th className="p-4">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {Object.keys(positions).length === 0 ? (
                                <tr>
                                    <td colSpan="6" className="p-10 text-center text-gray-400">
                                    <p className="text-xl text-primary">No active positions.</p>
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
                                        className={`border-b border-secondary hover:bg-secondary transition cursor-pointer ${
                                        isSelected ? 'bg-secondary border-l-4 border-l-primary' : ''
                                        }`}
                                        onClick={() => setSelectedPosition(pos.id)}
                                    >
                                        <td className="p-4">
                                        <div className="font-bold text-white">{pos.asset || 'ETH'}/USD</div>
                                        <div className={`text-sm font-bold ${pos.positionType === 1 ? 'text-red-400' : 'text-green-400'}`}>
                                            {pos.leverage}x {pos.positionType === 1 ? 'SHORT' : 'LONG'}
                                        </div>
                                        {posProtection?.autoAddCollateral && (
                                            <div className="text-xs text-primary mt-1 font-semibold">🛡️ Protected</div>
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
                                            <div className="flex flex-col gap-1">
                                                <div className="w-full bg-background rounded-full h-2">
                                                    <div
                                                    className="h-2 rounded-full transition-all duration-300"
                                                    style={{ 
                                                        width: `${Math.min(100, healthPercent)}%`,
                                                        background: healthPercent >= 70 ? 'linear-gradient(90deg, #10B981, #22C55E)' : 
                                                                    healthPercent >= 40 ? 'linear-gradient(90deg, #F59E0B, #EAB308)' : 
                                                                    'linear-gradient(90deg, #EF4444, #DC2626)'
                                                    }}
                                                    ></div>
                                                </div>
                                                <span className={`text-xs font-bold ${getRiskBgColor(alert.level)} px-2 py-0.5 rounded-full inline-block text-center w-max`}>
                                                    {alert.level}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="p-4">
                                            <button 
                                                onClick={(e) => handleClosePosition(pos.id, e)}
                                                className="bg-red-500/10 hover:bg-red-500 hover:text-white text-red-400 border border-red-500/50 px-3 py-1 rounded text-sm transition"
                                            >
                                                Close
                                            </button>
                                        </td>
                                    </tr>
                                    );
                                })
                                )}
                            </tbody>
                            </table>
                        ) : (
                            // HISTORY TABLE
                            <table className="w-full text-left">
                                <thead className="border-b border-secondary bg-background">
                                    <tr className="text-sm text-primary uppercase tracking-wider">
                                    <th className="p-4">Pair</th>
                                    <th className="p-4">Closed Date</th>
                                    <th className="p-4">Entry / Exit</th>
                                    <th className="p-4">Realized P&L</th>
                                    <th className="p-4">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {history.length === 0 ? (
                                        <tr>
                                            <td colSpan="5" className="p-10 text-center text-gray-400">
                                                <p className="text-xl text-primary">No history yet.</p>
                                                <p className="text-base mt-2">Closed positions will appear here.</p>
                                            </td>
                                        </tr>
                                    ) : (
                                        history.map((item, idx) => (
                                            <tr key={idx} className="border-b border-secondary hover:bg-secondary transition">
                                                <td className="p-4">
                                                    <div className="font-bold text-white">{item.asset || 'ETH'}/USD</div>
                                                    <div className={`text-sm font-bold ${item.positionType === 1 ? 'text-red-400' : 'text-green-400'}`}>
                                                        {item.leverage}x {item.positionType === 1 ? 'SHORT' : 'LONG'}
                                                    </div>
                                                </td>
                                                <td className="p-4 text-sm text-gray-300">
                                                    {item.closedAt}
                                                </td>
                                                <td className="p-4 font-mono">
                                                    <div className="text-gray-300">In: {formatCurrency(item.entryPrice)}</div>
                                                    <div className="text-gray-300">Out: {formatCurrency(item.exitPrice)}</div>
                                                </td>
                                                <td className={`p-4 font-mono font-bold ${item.realizedPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                                    {item.realizedPnl >= 0 ? '+' : ''}{formatCurrency(item.realizedPnl)}
                                                </td>
                                                <td className="p-4">
                                                    <button 
                                                        onClick={(e) => handleReopenPosition(item, e)}
                                                        className="bg-primary/10 hover:bg-primary hover:text-background text-primary border border-primary/50 px-3 py-1 rounded text-sm transition flex items-center gap-1"
                                                    >
                                                        <span>↺</span> Reinvest
                                                    </button>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>

                {/* Position Details & Chart Section (Only for Active Positions) */}
                {activeTab === 'active' && selectedPositionData && (
                  <div className="bg-surface p-6 rounded-lg shadow-lg border border-secondary">
                    <h2 className="text-2xl font-serif mb-4 text-white flex items-center">
                      Position Details #{selectedPosition}
                      {protectionSettings[selectedPosition]?.autoAddCollateral && (
                        <span className="ml-3 text-sm bg-green-500/20 text-green-400 border border-green-500/50 px-2 py-1 rounded-full">🛡️ Protected</span>
                      )}
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      
                      {/* Chart Placeholder */}
                      <div className="bg-background p-4 rounded-lg border border-secondary">
                        <h3 className="text-lg font-semibold text-primary mb-3">Live Price Chart</h3>
                        <div className="h-48 bg-surface/30 rounded border border-secondary border-dashed p-3">
                          <div className="h-full w-full relative">
                            <div className="absolute inset-0 p-2">
                              <Sparkline data={priceHistory[selectedPositionData.asset || 'ETH'] || priceHistory.ETH} height={120} />
                            </div>
                            <div className="absolute left-3 top-3 text-sm text-gray-300 z-10">
                              <div className="text-lg font-semibold">{selectedPositionData.asset || 'ETH'}/USD</div>
                              <div className="text-sm">Current: {formatCurrency(livePrice)}</div>
                              <div className="text-sm">Entry: {formatCurrency(selectedPositionData.entryPrice)}</div>
                              <div className="text-sm text-red-400">Liquidation: {formatCurrency(getLiqPrice(selectedPositionData))}</div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Position Metrics */}
                      <div className="space-y-4">
                        <h3 className="text-lg font-semibold text-primary">Key Metrics</h3>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="bg-background p-3 rounded border border-secondary">
                            <p className="text-sm text-gray-400">Collateral</p>
                            <p className="text-lg font-bold text-white">
                              {formatCurrency(selectedPositionData.collateral)}
                            </p>
                          </div>
                          <div className="bg-background p-3 rounded border border-secondary">
                            <p className="text-sm text-gray-400">Leverage</p>
                            <p className={`text-lg font-bold ${selectedPositionData.positionType === 1 ? 'text-red-400' : 'text-green-400'}`}>
                              {selectedPositionData.leverage}x {selectedPositionData.positionType === 1 ? 'SHORT' : 'LONG'}
                            </p>
                          </div>
                          <div className="bg-background p-3 rounded border border-secondary">
                            <p className="text-sm text-gray-400">Position Size</p>
                            <p className="text-lg font-bold text-white">
                              {formatCurrency(selectedPositionData.collateral * selectedPositionData.leverage)}
                            </p>
                          </div>
                          <div className="bg-background p-3 rounded border border-secondary">
                            <p className="text-sm text-gray-400">Distance to Liq.</p>
                            <p className="text-lg font-bold text-red-400">
                              {Math.abs((livePrice - getLiqPrice(selectedPositionData)) / livePrice * 100).toFixed(1)}%
                            </p>
                          </div>
                        </div>
                        
                        {/* Protection Settings */}
                        {protectionSettings[selectedPosition] && (
                          <div className="bg-background p-4 rounded border border-secondary">
                            <p className="text-sm text-gray-400 mb-2">Protection Settings</p>
                            <div className="flex flex-wrap gap-2">
                              {protectionSettings[selectedPosition].autoAddCollateral && (
                                <span className="text-xs bg-green-500/20 text-green-400 border border-green-500/50 px-2 py-1 rounded">Auto-Collateral</span>
                              )}
                              {protectionSettings[selectedPosition].emergencyClose && (
                                <span className="text-xs bg-blue-500/20 text-blue-400 border border-blue-500/50 px-2 py-1 rounded">Emergency Close</span>
                              )}
                              {protectionSettings[selectedPosition].insuranceVault && (
                                <span className="text-xs bg-primary/20 text-primary border border-primary/50 px-2 py-1 rounded">Vault Access</span>
                              )}
                            </div>
                          </div>
                        )}
                        
                        <div className="bg-background p-4 rounded border border-secondary">
                          <p className="text-sm text-gray-400 mb-2">Current Status</p>
                          <div className="flex items-center justify-between">
                            <span className={`text-lg font-bold ${getRiskColor(alerts[selectedPosition]?.level || "Safe")}`}>
                              {alerts[selectedPosition]?.level || "Safe"}
                            </span>
                            <button
                              onClick={() => checkRisk(selectedPosition)}
                              className="bg-secondary hover:bg-muted hover:text-white text-gray-200 py-2 px-4 rounded transition border border-gray-600"
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
                <div className="bg-surface p-6 rounded-lg shadow-lg border border-secondary">
                  <h2 className="text-2xl font-serif mb-4 text-white">Live Market</h2>
                  <div className="text-center">
                    <p className="text-sm text-gray-400 uppercase tracking-wider">ETH-USD</p>
                    <p className="text-5xl font-mono font-bold text-white my-4">
                      {formatCurrency(livePrice)}
                    </p>
                    <div className="text-sm text-primary">
                      Real-time via Somnia Streams
                    </div>
                  </div>
                </div>
                
                {/* Insurance Vault Card */}
                <div className="bg-surface p-6 rounded-lg shadow-lg border border-secondary">
                  <h2 className="text-2xl font-serif mb-4 text-white">Insurance Vault</h2>
                  <div className="text-center mb-4">
                    <p className="text-sm text-gray-400 uppercase tracking-wider">Vault Balance</p>
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
                          stroke="var(--color-secondary)"
                          strokeWidth="3"
                        />
                        <path
                          d="M18 2.0845
                            a 15.9155 15.9155 0 0 1 0 31.831
                            a 15.9155 15.9155 0 0 1 0 -31.831"
                          fill="none"
                          stroke="var(--color-primary)"
                          strokeWidth="3"
                          strokeDasharray="70, 100"
                        />
                        <text x="18" y="20.5" textAnchor="middle" fill="var(--color-primary)" fontSize="8" fontWeight="bold">70%</text>
                      </svg>
                    </div>
                    <p className="text-sm text-gray-300">Protection Coverage</p>
                  </div>
                  <div className="flex gap-2">
                    <button className="flex-1 bg-secondary text-white py-2 px-3 rounded opacity-50 cursor-not-allowed text-sm">
                      Deposit
                    </button>
                    <button className="flex-1 bg-secondary text-white py-2 px-3 rounded opacity-50 cursor-not-allowed text-sm">
                      Withdraw
                    </button>
                  </div>
                </div>
                
                {/* Alerts Panel */}
                <div className="bg-surface p-6 rounded-lg shadow-lg border border-secondary">
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
                              ? 'border-red-500 bg-red-900/20' 
                              : alert.level === "Warning" 
                              ? 'border-yellow-500 bg-yellow-900/20'
                              : 'border-green-500 bg-green-900/20'
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
                <div className="bg-surface p-6 rounded-lg shadow-lg border border-secondary">
                  <h2 className="text-2xl font-serif mb-4 text-white">Demo Controls</h2>
                  <p className="text-sm text-gray-300 mb-3">Simulate ETH Price Changes</p>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => simulatePrice(3200)}
                      className="bg-green-600/20 border border-green-600/50 hover:bg-green-600 hover:text-white text-green-400 py-3 px-4 rounded-lg transition font-semibold"
                    >
                      $3,200
                    </button>
                    <button
                      onClick={() => simulatePrice(3000)}
                      className="bg-secondary hover:bg-muted hover:text-background text-white py-3 px-4 rounded-lg transition font-semibold"
                    >
                      $3,000
                    </button>
                    <button
                      onClick={() => simulatePrice(2700)}
                      className="bg-yellow-600/20 border border-yellow-600/50 hover:bg-yellow-600 hover:text-white text-yellow-400 py-3 px-4 rounded-lg transition font-semibold"
                    >
                      $2,700
                    </button>
                    <button
                      onClick={() => simulatePrice(2400)}
                      className="bg-red-600/20 border border-red-600/50 hover:bg-red-600 hover:text-white text-red-400 py-3 px-4 rounded-lg transition font-semibold"
                    >
                      $2,400
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
            priceHistory={priceHistory}
            initialData={modalInitialData}
          />
        </div>
      )}
    </>
  );
}

export default App;