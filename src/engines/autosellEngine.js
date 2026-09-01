const chainManager = require('../chains');
const db = require('../core/db');
const telegram = require('../core/telegram');
const config = require('../core/config');

class AutoSellEngine {
  constructor() {
    this.interval = null;
  }

  start() {
    if (!config.autoSell.enabled) {
      console.log('⏸️ Auto-Sell Engine disabled');
      return;
    }

    console.log(`⚡ Auto-Sell Engine started (TP:+${config.autoSell.takeProfitPercent}% / SL:-${config.autoSell.stopLossPercent}% / Trail:-${config.autoSell.trailingStopPercent}%)`);
    this.interval = setInterval(() => this.checkPositions(), config.autoSell.checkIntervalMs);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async checkPositions() {
    const positions = db.getActivePositions();
    if (positions.length === 0) return;

    for (const pos of positions) {
      try {
        const chain = chainManager.getChain(pos.chain);
        if (!chain) continue;

        const currentPrice = await chain.getTokenPrice(pos.token_address);
        const buyPrice = Number(pos.buy_price) || 0;
        const highestPrice = Number(pos.highest_price) || buyPrice;
        if (currentPrice === 0 || buyPrice === 0) continue;

        if (currentPrice > highestPrice) {
          db.updateHighestPrice(pos.id, currentPrice);
          pos.highest_price = currentPrice;
        }

        const pnlPercent = ((currentPrice - buyPrice) / buyPrice) * 100;
        const dropFromPeak = highestPrice > 0 ? ((highestPrice - currentPrice) / highestPrice) * 100 : 0;

        let shouldSell = false;
        let reason = '';

        if (pnlPercent >= config.autoSell.takeProfitPercent) {
          shouldSell = true;
          reason = `🚀 TAKE PROFIT (+${pnlPercent.toFixed(1)}%)`;
        } else if (pnlPercent <= -config.autoSell.stopLossPercent) {
          shouldSell = true;
          reason = `🛑 STOP LOSS (${pnlPercent.toFixed(1)}%)`;
        } else if (highestPrice > buyPrice && dropFromPeak >= config.autoSell.trailingStopPercent) {
          shouldSell = true;
          reason = `📉 TRAILING STOP (-${dropFromPeak.toFixed(1)}% dari Puncak)`;
        }

        if (shouldSell) {
          await this.executeSell(pos, currentPrice, pnlPercent, reason);
        }
      } catch (err) {
        console.error(`⚠️ [AutoSell] Error checking ${pos.token_address?.slice(0, 10)}:`, err.message);
      }
    }
  }

  async executeSell(pos, currentPrice, pnlPercent, reason) {
    const chain = chainManager.getChain(pos.chain);
    if (!chain) return;

    console.log(`⚡ [AUTO SELL] ${reason} | ${pos.chain.toUpperCase()} | ${pos.token_address.slice(0, 10)}...`);

    const result = await chain.sellToken(pos.token_address, 100);
    const nativeSpent = Number(pos.native_spent) || 0;
    const pnlNative = nativeSpent * (pnlPercent / 100);

    if (result.success) {
      db.closeTrade(pos.trade_id, currentPrice, pnlPercent, pnlNative);

      const buyPriceDisplay = Number(pos.buy_price) || 0;
      const emoji = pnlPercent >= 0 ? '🟢' : '🔴';
      const msg =
        `💰 <b>AUTO-SELL EXECUTED!</b>\n\n` +
        `🎯 <b>Alasan:</b> ${reason}\n` +
        `🌐 <b>Chain:</b> ${pos.chain.toUpperCase()}\n` +
        `🪙 <b>Token:</b> ${pos.token_symbol || pos.token_address.slice(0, 10)}\n` +
        `💵 Buy: $${buyPriceDisplay.toFixed(8)} -> Sell: $${currentPrice.toFixed(8)}\n` +
        `${emoji} <b>PnL:</b> ${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}% (${pnlNative.toFixed(4)} ${chain.symbol})\n` +
        `🔗 <a href="${chain.getExplorerUrl(result.txHash)}">Cek TX</a>`;

      await telegram.send(msg);
    } else {
      await telegram.send(`❌ <b>AUTO SELL GAGAL:</b> ${pos.token_symbol || pos.token_address.slice(0, 10)} - ${result.error}`);
    }
  }
}

module.exports = new AutoSellEngine();
