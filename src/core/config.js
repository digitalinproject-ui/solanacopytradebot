require('dotenv').config();

function safeFloat(val, fallback) {
  const n = parseFloat(val);
  return isNaN(n) ? fallback : n;
}

function safeInt(val, fallback) {
  const n = parseInt(val, 10);
  return isNaN(n) ? fallback : n;
}

const config = {
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || ''
  },
  bot: {
    dryRun: process.env.DRY_RUN !== 'false',
    name: 'Anubis Multi-Chain Terminal v2.0'
  },
  solana: {
    enabled: process.env.SOLANA_ENABLED !== 'false',
    rpcHttp: process.env.SOLANA_RPC_HTTP || 'https://api.mainnet-beta.solana.com',
    rpcWs: process.env.SOLANA_RPC_WS || 'wss://api.mainnet-beta.solana.com',
    privateKey: process.env.SOLANA_PRIVATE_KEY || '',
    buyAmount: safeFloat(process.env.SOLANA_BUY_AMOUNT, 0.05),
    slippageBps: safeInt(process.env.SOLANA_SLIPPAGE_BPS, 300),
    priorityFee: process.env.SOLANA_PRIORITY_FEE || 'auto',
    targetWallets: (process.env.SOLANA_TARGET_WALLETS || '').split(',').map(w => w.trim()).filter(Boolean)
  },
  base: {
    enabled: process.env.BASE_ENABLED === 'true',
    rpcHttp: process.env.BASE_RPC_HTTP || 'https://mainnet.base.org',
    rpcWs: process.env.BASE_RPC_WS || '',
    privateKey: process.env.BASE_PRIVATE_KEY || '',
    buyAmount: safeFloat(process.env.BASE_BUY_AMOUNT, 0.005),
    slippagePercent: safeFloat(process.env.BASE_SLIPPAGE_PERCENT, 3),
    routerAddress: process.env.BASE_ROUTER || '0x2626664c2603336E57B271c5C0b26F421741e481',
    targetWallets: (process.env.BASE_TARGET_WALLETS || '').split(',').map(w => w.trim()).filter(Boolean)
  },
  bsc: {
    enabled: process.env.BSC_ENABLED === 'true',
    rpcHttp: process.env.BSC_RPC_HTTP || 'https://bsc-dataseed1.binance.org',
    rpcWs: process.env.BSC_RPC_WS || '',
    privateKey: process.env.BSC_PRIVATE_KEY || '',
    buyAmount: safeFloat(process.env.BSC_BUY_AMOUNT, 0.01),
    slippagePercent: safeFloat(process.env.BSC_SLIPPAGE_PERCENT, 3),
    routerAddress: process.env.BSC_ROUTER || '0x10ED43C718714eb63d5aA57B78B54704E256024E',
    targetWallets: (process.env.BSC_TARGET_WALLETS || '').split(',').map(w => w.trim()).filter(Boolean)
  },
  eth: {
    enabled: process.env.ETH_ENABLED === 'true',
    rpcHttp: process.env.ETH_RPC_HTTP || '',
    rpcWs: process.env.ETH_RPC_WS || '',
    privateKey: process.env.ETH_PRIVATE_KEY || '',
    buyAmount: safeFloat(process.env.ETH_BUY_AMOUNT, 0.005),
    slippagePercent: safeFloat(process.env.ETH_SLIPPAGE_PERCENT, 3),
    routerAddress: process.env.ETH_ROUTER || '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
    targetWallets: (process.env.ETH_TARGET_WALLETS || '').split(',').map(w => w.trim()).filter(Boolean)
  },
  autoSell: {
    enabled: process.env.AUTO_SELL_ENABLED !== 'false',
    takeProfitPercent: safeFloat(process.env.TAKE_PROFIT_PERCENT, 100),
    stopLossPercent: safeFloat(process.env.STOP_LOSS_PERCENT, 30),
    trailingStopPercent: safeFloat(process.env.TRAILING_STOP_PERCENT, 20),
    checkIntervalMs: safeInt(process.env.AUTO_SELL_INTERVAL_MS, 10000)
  },
  sniper: {
    enabled: process.env.SNIPER_ENABLED === 'true',
    buyAmountSol: safeFloat(process.env.SNIPER_BUY_AMOUNT_SOL, 0.02),
    chains: (process.env.SNIPER_CHAINS || 'solana').split(',').map(c => c.trim()).filter(Boolean),
    minLiquidityUsd: safeFloat(process.env.SNIPER_MIN_LIQUIDITY, 1000),
    autoBuy: process.env.SNIPER_AUTO_BUY === 'true'
  }
};

module.exports = config;
