class BaseChain {
  constructor(name, symbol, nativeDecimals = 18) {
    this.name = name; // 'solana', 'base', 'bsc', 'eth'
    this.symbol = symbol; // 'SOL', 'ETH', 'BNB'
    this.nativeDecimals = nativeDecimals;
  }

  async getBalance() {
    throw new Error('getBalance() not implemented');
  }

  async getTokenBalances() {
    throw new Error('getTokenBalances() not implemented');
  }

  async buyToken(tokenAddress, amountNative, options = {}) {
    throw new Error('buyToken() not implemented');
  }

  async sellToken(tokenAddress, percentage = 100, options = {}) {
    throw new Error('sellToken() not implemented');
  }

  async getTokenPrice(tokenAddress) {
    throw new Error('getTokenPrice() not implemented');
  }

  async monitorWallet(walletAddress, callback) {
    throw new Error('monitorWallet() not implemented');
  }

  async parseTransaction(txHash) {
    throw new Error('parseTransaction() not implemented');
  }

  getExplorerUrl(txHash) {
    return '';
  }

  getDexScreenerUrl(tokenAddress) {
    return `https://dexscreener.com/${this.name}/${tokenAddress}`;
  }
}

module.exports = BaseChain;
