const BaseChain = require('./baseChain');
const config = require('../core/config');
const { ethers } = require('ethers');
const fetch = require('cross-fetch');

const ROUTER_ABI = [
  'function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable',
  'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)',
  'function swapExactTokensForETHSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external',
  'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
  'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)',
  'function factory() external pure returns (address)'
];

const ERC20_ABI = [
  'function balanceOf(address owner) external view returns (uint256)',
  'function approve(address spender, uint256 value) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function symbol() external view returns (string)',
  'function name() external view returns (string)',
  'function decimals() external view returns (uint8)',
  'function totalSupply() external view returns (uint256)'
];

const FACTORY_ABI = [
  'event PairCreated(address indexed token0, address indexed token1, address pair, uint)'
];

const SWAP_METHOD_SIGS = {
  '0x7ff36ab5': 'swapExactETHForTokens',
  '0xb6f9de95': 'swapExactETHForTokensSupportingFeeOnTransferTokens',
  '0x18cbafe5': 'swapExactTokensForETH',
  '0x791ac947': 'swapExactTokensForETHSupportingFeeOnTransferTokens',
  '0x38ed1739': 'swapExactTokensForTokens',
  '0x8803dbee': 'swapTokensForExactTokens'
};

class EvmChain extends BaseChain {
  constructor(chainName, symbol, configKey) {
    super(chainName, symbol, 18);
    this.cfg = config[configKey];
    this.configKey = configKey;
    this.provider = new ethers.JsonRpcProvider(this.cfg.rpcHttp);
    this.wsProvider = null;
    this.wallet = null;

    if (this.cfg.rpcWs) {
      try {
        this.wsProvider = new ethers.WebSocketProvider(this.cfg.rpcWs);
      } catch (e) {
        console.warn(`⚠️ [${chainName}] WebSocket not available, using HTTP polling`);
      }
    }

    if (this.cfg.privateKey) {
      try {
        this.wallet = new ethers.Wallet(this.cfg.privateKey, this.provider);
        console.log(`✅ [${chainName.toUpperCase()}] Wallet loaded: ${this.wallet.address.slice(0, 10)}...`);
      } catch (e) {
        console.error(`❌ [${chainName}] Private key invalid`);
      }
    }
    this.wethAddress = this._getWethAddress();
    this.monitoredWallets = new Set();
  }

  _getWethAddress() {
    switch (this.name) {
      case 'base': return '0x4200000000000000000000000000000000000006';
      case 'bsc': return '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
      case 'eth': return '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
      default: return '';
    }
  }

  async getBalance() {
    if (!this.wallet) return '0.0000';
    try {
      const bal = await this.provider.getBalance(this.wallet.address);
      return parseFloat(ethers.formatEther(bal)).toFixed(4);
    } catch (e) {
      return '0.0000';
    }
  }

  async getTokenBalances() {
    if (!this.wallet) return [];
    return [];
  }

  _calculateMinOut(amountIn, slippagePercent) {
    const slippageBigInt = BigInt(Math.floor(slippagePercent * 100));
    return (amountIn * (10000n - slippageBigInt)) / 10000n;
  }

  async buyToken(tokenAddress, amountNative, options = {}) {
    const isDry = options.dryRun !== undefined ? options.dryRun : config.bot.dryRun;
    const slippage = options.slippagePercent || this.cfg.slippagePercent;

    if (isDry || !this.wallet) {
      return {
        success: true,
        dryRun: true,
        txHash: 'DRY_EVM_' + Date.now(),
        amountSpent: amountNative,
        tokenAddress
      };
    }

    try {
      const router = new ethers.Contract(this.cfg.routerAddress, ROUTER_ABI, this.wallet);
      const path = [this.wethAddress, tokenAddress];
      const value = ethers.parseEther(String(amountNative));
      const deadline = Math.floor(Date.now() / 1000) + 300;

      let amountOutMin = 0n;
      try {
        const amounts = await router.getAmountsOut(value, path);
        amountOutMin = this._calculateMinOut(amounts[amounts.length - 1], slippage);
      } catch (e) {
        console.warn(`⚠️ [${this.name}] getAmountsOut gagal, skip slippage protection`);
      }

      let gasLimit;
      try {
        const estimatedGas = await router.swapExactETHForTokensSupportingFeeOnTransferTokens.estimateGas(
          amountOutMin, path, this.wallet.address, deadline, { value }
        );
        gasLimit = (estimatedGas * 130n) / 100n;
      } catch (e) {
        gasLimit = 350000n;
      }

      const tx = await router.swapExactETHForTokensSupportingFeeOnTransferTokens(
        amountOutMin, path, this.wallet.address, deadline,
        { value, gasLimit }
      );

      const receipt = await tx.wait();

      return {
        success: true,
        dryRun: false,
        txHash: receipt.hash,
        amountSpent: amountNative,
        tokenAddress
      };
    } catch (err) {
      return { success: false, error: err.message?.slice(0, 200) || 'Unknown error', tokenAddress };
    }
  }

  async sellToken(tokenAddress, percentage = 100, options = {}) {
    const isDry = options.dryRun !== undefined ? options.dryRun : config.bot.dryRun;

    if (isDry || !this.wallet) {
      return { success: true, dryRun: true, txHash: 'DRY_EVM_SELL_' + Date.now() };
    }

    try {
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.wallet);
      const balance = await tokenContract.balanceOf(this.wallet.address);
      if (balance === 0n) throw new Error('Token balance = 0');

      const amountToSell = (balance * BigInt(percentage)) / 100n;

      const allowance = await tokenContract.allowance(this.wallet.address, this.cfg.routerAddress);
      if (allowance < amountToSell) {
        const appTx = await tokenContract.approve(this.cfg.routerAddress, ethers.MaxUint256);
        await appTx.wait();
      }

      const router = new ethers.Contract(this.cfg.routerAddress, ROUTER_ABI, this.wallet);
      const path = [tokenAddress, this.wethAddress];
      const deadline = Math.floor(Date.now() / 1000) + 300;

      let amountOutMin = 0n;
      try {
        const amounts = await router.getAmountsOut(amountToSell, path);
        amountOutMin = this._calculateMinOut(amounts[amounts.length - 1], this.cfg.slippagePercent);
      } catch (e) {}

      let gasLimit;
      try {
        const est = await router.swapExactTokensForETHSupportingFeeOnTransferTokens.estimateGas(
          amountToSell, amountOutMin, path, this.wallet.address, deadline
        );
        gasLimit = (est * 130n) / 100n;
      } catch (e) {
        gasLimit = 350000n;
      }

      const tx = await router.swapExactTokensForETHSupportingFeeOnTransferTokens(
        amountToSell, amountOutMin, path, this.wallet.address, deadline,
        { gasLimit }
      );

      const receipt = await tx.wait();

      return {
        success: true,
        dryRun: false,
        txHash: receipt.hash,
        receivedNative: Number(ethers.formatEther(amountOutMin))
      };
    } catch (err) {
      return { success: false, error: err.message?.slice(0, 200) || 'Unknown error' };
    }
  }

  async getTokenPrice(tokenAddress) {
    try {
      const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`);
      const data = await res.json();
      if (data && data.pairs && data.pairs.length > 0) {
        const chainPair = data.pairs.find(p => p.chainId === this.name) || data.pairs[0];
        return parseFloat(chainPair.priceUsd) || 0;
      }
    } catch (e) {}
    return 0;
  }

  async getTokenMetadata(tokenAddress) {
    try {
      const contract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
      const [symbol, name] = await Promise.all([
        contract.symbol().catch(() => 'UNKNOWN'),
        contract.name().catch(() => '')
      ]);
      return { symbol, name };
    } catch (e) {
      return { symbol: 'UNKNOWN', name: '' };
    }
  }

  _parseSwapTokenFromTxData(txData, txTo) {
    if (!txData || txData.length < 10) return null;
    const methodSig = txData.slice(0, 10);
    const methodName = SWAP_METHOD_SIGS[methodSig];
    if (!methodName) return null;

    try {
      const iface = new ethers.Interface(ROUTER_ABI);
      const decoded = iface.parseTransaction({ data: txData, value: 0n });
      if (!decoded || !decoded.args) return null;

      const path = decoded.args.path || decoded.args[1];
      if (path && path.length >= 2) {
        if (methodName.includes('ETHForTokens')) {
          return path[path.length - 1];
        }
        if (methodName.includes('TokensForETH')) {
          return path[0];
        }
        return path[path.length - 1];
      }
    } catch (e) {}
    return null;
  }

  async monitorWallet(walletAddress, onSignalCallback) {
    if (this.monitoredWallets.has(walletAddress.toLowerCase())) {
      console.log(`ℹ️ [${this.name.toUpperCase()}] Already monitoring: ${walletAddress.slice(0, 10)}...`);
      return;
    }
    this.monitoredWallets.add(walletAddress.toLowerCase());

    const activeProvider = this.wsProvider || this.provider;

    try {
      activeProvider.on('block', async (blockNumber) => {
        try {
          const block = await this.provider.getBlock(blockNumber, true);
          if (!block) return;

          const txs = block.prefetchedTransactions || [];
          for (const tx of txs) {
            if (!tx.from || tx.from.toLowerCase() !== walletAddress.toLowerCase()) continue;

            const boughtToken = this._parseSwapTokenFromTxData(tx.data, tx.to);
            if (boughtToken) {
              onSignalCallback({
                chain: this.name,
                targetWallet: walletAddress,
                tokenAddress: boughtToken,
                txHash: tx.hash
              });
            }
          }
        } catch (e) {}
      });
      console.log(`👁️ [${this.name.toUpperCase()}] Monitoring wallet: ${walletAddress.slice(0, 10)}...`);
    } catch (e) {
      console.error(`❌ [${this.name}] Monitor failed:`, e.message);
    }
  }

  getExplorerUrl(txHash) {
    switch (this.name) {
      case 'base': return `https://basescan.org/tx/${txHash}`;
      case 'bsc': return `https://bscscan.com/tx/${txHash}`;
      case 'eth': return `https://etherscan.io/tx/${txHash}`;
      default: return txHash;
    }
  }

  getTokenExplorerUrl(tokenAddress) {
    switch (this.name) {
      case 'base': return `https://basescan.org/token/${tokenAddress}`;
      case 'bsc': return `https://bscscan.com/token/${tokenAddress}`;
      case 'eth': return `https://etherscan.io/token/${tokenAddress}`;
      default: return tokenAddress;
    }
  }
}

module.exports = EvmChain;
