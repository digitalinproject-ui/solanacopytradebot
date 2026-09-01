const chainManager = require('../chains');
const db = require('../core/db');
const telegram = require('../core/telegram');
const config = require('../core/config');

class CopyTradeEngine {
  constructor() {
    this.isListening = false;
    this.recentSignals = new Map();
    this.COOLDOWN_MS = 30000;
  }

  start() {
    if (this.isListening) return;
    this.isListening = true;

    console.log('🚀 Copy Trade Engine started...');

    const enabledChains = chainManager.getEnabledChainNames();

    for (const chainName of enabledChains) {
      const chain = chainManager.getChain(chainName);
      if (!chain) continue;

      const dbWallets = db.getTargetWallets(chainName);
      const configWallets = config[chainName]?.targetWallets || [];

      const allWallets = new Set([
        ...dbWallets.map(w => w.address),
        ...configWallets
      ]);

      configWallets.forEach(w => db.addTargetWallet(chainName, w, 'Config'));

      allWallets.forEach(walletAddr => {
        chain.monitorWallet(walletAddr, (signal) => this.handleSignal(signal));
      });
    }
  }

  addWalletLive(chainName, walletAddress) {
    const chain = chainManager.getChain(chainName);
    if (!chain) return false;
    chain.monitorWallet(walletAddress, (signal) => this.handleSignal(signal));
    return true;
  }

  _isDuplicateSignal(chainName, tokenAddress) {
    const key = `${chainName}:${tokenAddress}`;
    const last = this.recentSignals.get(key);
    const now = Date.now();
    if (last && (now - last) < this.COOLDOWN_MS) {
      console.log(`⏳ [CopyTrade] Duplicate signal blocked: ${tokenAddress} (cooldown ${this.COOLDOWN_MS}ms)`);
      return true;
    }
    this.recentSignals.set(key, now);
    return false;
  }

  async handleSignal(signal) {
    const { chain: chainName, targetWallet, tokenAddress, txHash } = signal;

    if (this._isDuplicateSignal(chainName, tokenAddress)) return;

    const chain = chainManager.getChain(chainName);
    if (!chain) return;

    const buyAmount = config[chainName]?.buyAmount || 0.05;
    const isDry = config.bot.dryRun;
    const modeBadge = isDry ? '🧪 SIMULASI' : '🚨 REAL TRADE';

    console.log(`\n🔔 [COPY TRADE SIGNAL] ${chainName.toUpperCase()} | Target: ${targetWallet.slice(0, 8)}... | Token: ${tokenAddress.slice(0, 10)}...`);

    let tokenMeta = { symbol: '', name: '' };
    try {
      if (typeof chain.getTokenMetadata === 'function') {
        tokenMeta = await chain.getTokenMetadata(tokenAddress);
      }
    } catch (e) {}

    const alertMsg =
      `🔥 <b>SIGNAL COPY TRADE!</b> [${modeBadge}]\n\n` +
      `🌐 <b>Chain:</b> ${chainName.toUpperCase()}\n` +
      `🎯 <b>Target Wallet:</b> <code>${targetWallet}</code>\n` +
      `🪙 <b>Token:</b> ${tokenMeta.symbol || '???'} ${tokenMeta.name ? `(${tokenMeta.name})` : ''}\n` +
      `📋 <b>CA:</b> <code>${tokenAddress}</code>\n` +
      `💵 <b>Nominal Beli:</b> ${buyAmount} ${chain.symbol}\n` +
      `🔗 <b>Tx:</b> <a href="${chain.getExplorerUrl(txHash)}">Lihat Explorer</a>`;

    const inlineBtns = {
      inline_keyboard: [
        [
          { text: '📈 DexScreener', url: chain.getDexScreenerUrl(tokenAddress) },
          { text: '🔍 Explorer', url: chain.getExplorerUrl(txHash) }
        ]
      ]
    };

    await telegram.send(alertMsg, inlineBtns);

    const result = await chain.buyToken(tokenAddress, buyAmount, { dryRun: isDry });

    if (result.success) {
      const currentPrice = await chain.getTokenPrice(tokenAddress);

      const tradeId = db.recordTrade({
        chain: chainName,
        type: 'COPYTRADE',
        token_address: tokenAddress,
        token_symbol: tokenMeta.symbol || '',
        token_name: tokenMeta.name || '',
        buy_price: currentPrice,
        buy_amount: buyAmount,
        token_amount: result.outAmount || 0,
        native_spent: buyAmount,
        tx_hash: result.txHash,
        source_wallet: targetWallet,
        status: 'OPEN',
        dry_run: isDry ? 1 : 0
      });

      if (config.autoSell.enabled && currentPrice > 0) {
        db.addPosition({
          trade_id: tradeId,
          chain: chainName,
          token_address: tokenAddress,
          token_symbol: tokenMeta.symbol || '',
          buy_price: currentPrice,
          highest_price: currentPrice,
          token_amount: result.outAmount || 0,
          native_spent: buyAmount
        });
      }

      const successMsg =
        `🎉 <b>COPY TRADE BERHASIL!</b> [${modeBadge}]\n\n` +
        `🌐 ${chainName.toUpperCase()} | ${tokenMeta.symbol || tokenAddress.slice(0, 8)}\n` +
        `💵 Spent: ${buyAmount} ${chain.symbol}\n` +
        `📊 Price: $${currentPrice.toFixed(8)}\n` +
        `🔗 <a href="${chain.getExplorerUrl(result.txHash)}">Cek TX</a>`;

      await telegram.send(successMsg);
    } else {
      await telegram.send(`❌ <b>COPY TRADE GAGAL:</b> ${result.error}`);
    }
  }
}

module.exports = new CopyTradeEngine();
