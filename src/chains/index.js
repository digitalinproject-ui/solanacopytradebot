const SolanaChain = require('./solanaChain');
const EvmChain = require('./evmChain');
const config = require('../core/config');

class ChainManager {
  constructor() {
    this.chains = new Map();

    if (config.solana.enabled) {
      try {
        this.chains.set('solana', new SolanaChain());
      } catch (e) {
        console.error('❌ Failed to init Solana chain:', e.message);
      }
    }
    if (config.base.enabled) {
      try {
        this.chains.set('base', new EvmChain('base', 'ETH', 'base'));
      } catch (e) {
        console.error('❌ Failed to init Base chain:', e.message);
      }
    }
    if (config.bsc.enabled) {
      try {
        this.chains.set('bsc', new EvmChain('bsc', 'BNB', 'bsc'));
      } catch (e) {
        console.error('❌ Failed to init BSC chain:', e.message);
      }
    }
    if (config.eth.enabled) {
      try {
        this.chains.set('eth', new EvmChain('eth', 'ETH', 'eth'));
      } catch (e) {
        console.error('❌ Failed to init ETH chain:', e.message);
      }
    }
  }

  getChain(chainName) {
    return this.chains.get(chainName.toLowerCase()) || null;
  }

  getAllChains() {
    return Array.from(this.chains.values());
  }

  getEnabledChainNames() {
    return Array.from(this.chains.keys());
  }
}

module.exports = new ChainManager();
