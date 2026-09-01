const telegram = require('../core/telegram');
const config = require('../core/config');
const db = require('../core/db');
const chainManager = require('../chains');
const copyTradeEngine = require('../engines/copytradeEngine');

function registerUIHandlers() {
  // Main commands
  telegram.onCommand('/start', showMainMenu);
  telegram.onCommand('/menu', showMainMenu);
  telegram.onCommand('⚙️ Status & Menu', showMainMenu);
  telegram.onCommand('💳 Portfolio', showPortfolio);
  telegram.onCommand('/balance', showPortfolio);
  telegram.onCommand('🎯 Target List', showTargets);
  telegram.onCommand('/targets', showTargets);
  telegram.onCommand('📈 Auto-Sell Status', showAutoSellStatus);
  telegram.onCommand('⚡ Quick Buy', showQuickBuyHelp);
  telegram.onCommand('📊 PnL Stats', showPnLStats);
  telegram.onCommand('/pnl', showPnLStats);
  telegram.onCommand('/help', showHelp);

  // Add target wallets: /addsol, /addbase, /addbsc, /addeth
  telegram.onCommand(/^\/add(sol|base|bsc|eth)/, handleAddWallet);

  // Remove target wallets: /delsol, /delbase, /delbsc, /deleth
  telegram.onCommand(/^\/del(sol|base|bsc|eth)/, handleDelWallet);

  // Manual buy: /buysol, /buybase, /buybsc, /buyeth
  telegram.onCommand(/^\/buy(sol|base|bsc|eth)/, handleManualBuy);

  // Manual sell: /sellsol, /sellbase, /sellbsc, /selleth
  telegram.onCommand(/^\/sell(sol|base|bsc|eth)/, handleManualSell);

  // Callbacks
  telegram.onCallback('MAIN_MENU', showMainMenu);
  telegram.onCallback('SHOW_PORTFOLIO', showPortfolio);
  telegram.onCallback('SHOW_TARGETS', showTargets);
  telegram.onCallback('TOGGLE_MODE', toggleMode);
  telegram.onCallback('SHOW_AUTOSELL', showAutoSellStatus);
  telegram.onCallback('SHOW_PNL', showPnLStats);
  telegram.onCallback('SHOW_HELP', showHelp);
  telegram.onCallback('SHOW_POSITIONS', showOpenPositions);
  telegram.onCallback('SHOW_HISTORY', showTradeHistory);
  telegram.onCallback('NOOP', () => {});
}

// ==================== MAIN MENU ====================
async function showMainMenu() {
  const modeStatus = config.bot.dryRun ? '🧪 SIMULASI (Paper Trade)' : '🔴 REAL MONEY TRADE';
  const enabledChains = chainManager.getEnabledChainNames().map(c => c.toUpperCase()).join(', ') || 'None';
  const stats = db.getTradeStats();
  const targets = db.getAllTargetWallets();
  const positions = db.getActivePositions();

  const msg =
    `🦅 <b>ANUBIS TERMINAL v2.0</b>\n` +
    `Multi-Chain Copy Trade + Sniper Bot\n\n` +
    `• <b>Mode:</b> ${modeStatus}\n` +
    `• <b>Chains:</b> <code>${enabledChains}</code>\n` +
    `• <b>Target Wallets:</b> ${targets.length}\n` +
    `• <b>Posisi Terbuka:</b> ${positions.length}\n` +
    `• <b>Total Trade:</b> ${stats.total} (Win: ${stats.winRate}%)\n` +
    `• <b>Total PnL:</b> ${stats.totalPnl}\n\n` +
    `Ketik /help untuk melihat semua command.`;

  const inlineKeyboard = {
    inline_keyboard: [
      [
        { text: '💳 Portfolio', callback_data: 'SHOW_PORTFOLIO' },
        { text: '🎯 Target Wallets', callback_data: 'SHOW_TARGETS' }
      ],
      [
        { text: '📊 PnL Stats', callback_data: 'SHOW_PNL' },
        { text: '⚡ Auto-Sell', callback_data: 'SHOW_AUTOSELL' }
      ],
      [
        { text: '📂 Posisi Terbuka', callback_data: 'SHOW_POSITIONS' },
        { text: '📜 Riwayat Trade', callback_data: 'SHOW_HISTORY' }
      ],
      [
        { text: config.bot.dryRun ? '⚡ Ganti ke REAL TRADE' : '🧪 Ganti ke SIMULASI', callback_data: 'TOGGLE_MODE' }
      ]
    ]
  };

  await telegram.send(msg, inlineKeyboard);
}

// ==================== PORTFOLIO ====================
async function showPortfolio() {
  let text = `💳 <b>PORTFOLIO MULTI-CHAIN</b>\n\n`;

  const chains = chainManager.getAllChains();
  for (const chain of chains) {
    const bal = await chain.getBalance();
    text += `🔹 <b>${chain.name.toUpperCase()}:</b> <code>${bal} ${chain.symbol}</code>\n`;
  }

  const solChain = chainManager.getChain('solana');
  if (solChain) {
    const tokens = await solChain.getTokenBalances();
    if (tokens.length > 0) {
      text += `\n🪙 <b>Token di Wallet Solana:</b>\n`;
      for (const t of tokens.slice(0, 10)) {
        text += `  • <b>${t.symbol || 'Unknown'}</b>: ${t.amount.toLocaleString()} | <code>${t.mint.slice(0, 6)}...${t.mint.slice(-4)}</code>\n`;
      }
      if (tokens.length > 10) text += `  <i>...dan ${tokens.length - 10} lainnya</i>\n`;
    }
  }

  const inlineKeyboard = {
    inline_keyboard: [
      [
        { text: '🔄 Refresh', callback_data: 'SHOW_PORTFOLIO' },
        { text: '👈 Menu', callback_data: 'MAIN_MENU' }
      ]
    ]
  };

  await telegram.send(text, inlineKeyboard);
}

// ==================== TARGET LIST ====================
async function showTargets() {
  const allTargets = db.getAllTargetWallets();

  let msg = `🎯 <b>TARGET WALLETS (${allTargets.length})</b>\n\n`;

  if (allTargets.length === 0) {
    msg += `<i>Belum ada target wallet.</i>\n`;
  } else {
    const grouped = {};
    allTargets.forEach(t => {
      if (!grouped[t.chain]) grouped[t.chain] = [];
      grouped[t.chain].push(t);
    });

    for (const [chain, wallets] of Object.entries(grouped)) {
      msg += `\n🔹 <b>${chain.toUpperCase()}</b>\n`;
      wallets.forEach((w, i) => {
        msg += `  ${i + 1}. <code>${w.address}</code>\n`;
      });
    }
  }

  msg += `\n<b>Commands:</b>\n` +
    `• Tambah: <code>/addsol ADDRESS</code>\n` +
    `• Tambah: <code>/addbase ADDRESS</code>\n` +
    `• Tambah: <code>/addbsc ADDRESS</code>\n` +
    `• Tambah: <code>/addeth ADDRESS</code>\n` +
    `• Hapus: <code>/delsol ADDRESS</code>\n` +
    `• Hapus: <code>/delbase ADDRESS</code>`;

  const inlineKeyboard = {
    inline_keyboard: [
      [{ text: '👈 Menu', callback_data: 'MAIN_MENU' }]
    ]
  };

  await telegram.send(msg, inlineKeyboard);
}

// ==================== ADD WALLET ====================
async function handleAddWallet(msg) {
  const text = msg.text.trim();
  const parts = text.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const addr = parts[1];

  if (!addr || addr.length < 10) {
    await telegram.send(`⚠️ Format salah! Contoh: <code>${cmd} ALAMAT_WALLET</code>`);
    return;
  }

  const chainMap = { '/addsol': 'solana', '/addbase': 'base', '/addbsc': 'bsc', '/addeth': 'eth' };
  const chain = chainMap[cmd];
  if (!chain) return;

  if (chain === 'solana' && (addr.length < 32 || addr.length > 44)) {
    await telegram.send(`⚠️ Alamat Solana tidak valid!`);
    return;
  }
  if (chain !== 'solana' && !addr.startsWith('0x')) {
    await telegram.send(`⚠️ Alamat EVM harus dimulai dengan 0x!`);
    return;
  }

  const result = db.addTargetWallet(chain, addr, 'Telegram');

  if (result.added) {
    copyTradeEngine.addWalletLive(chain, addr);
    await telegram.send(`✅ Target wallet baru ditambahkan ke <b>${chain.toUpperCase()}</b> dan langsung dipantau!\n<code>${addr}</code>`);
  } else {
    await telegram.send(`ℹ️ Wallet sudah ada di daftar target <b>${chain.toUpperCase()}</b>.\n<code>${addr}</code>`);
  }
}

// ==================== DEL WALLET ====================
async function handleDelWallet(msg) {
  const text = msg.text.trim();
  const parts = text.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const addr = parts[1];

  if (!addr) {
    await telegram.send(`⚠️ Format: <code>${cmd} ALAMAT_WALLET</code>`);
    return;
  }

  const chainMap = { '/delsol': 'solana', '/delbase': 'base', '/delbsc': 'bsc', '/deleth': 'eth' };
  const chain = chainMap[cmd];
  if (!chain) return;

  const result = db.removeTargetWallet(chain, addr);
  if (result.removed) {
    await telegram.send(`✅ Wallet dihapus dari target <b>${chain.toUpperCase()}</b>.\n<code>${addr}</code>\n\n<i>Restart bot untuk berhenti monitor wallet ini.</i>`);
  } else {
    await telegram.send(`⚠️ Wallet tidak ditemukan di target <b>${chain.toUpperCase()}</b>.`);
  }
}

// ==================== MANUAL BUY ====================
async function handleManualBuy(msg) {
  const text = msg.text.trim();
  const parts = text.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const tokenCA = parts[1];
  const amount = parseFloat(parts[2]);

  if (!tokenCA) {
    await telegram.send(`⚠️ Format: <code>${cmd} TOKEN_CA JUMLAH</code>\nContoh: <code>${cmd} 7xKX...pump 0.1</code>`);
    return;
  }

  const chainMap = { '/buysol': 'solana', '/buybase': 'base', '/buybsc': 'bsc', '/buyeth': 'eth' };
  const chainName = chainMap[cmd];
  if (!chainName) return;

  const chain = chainManager.getChain(chainName);
  if (!chain) {
    await telegram.send(`❌ Chain <b>${chainName.toUpperCase()}</b> tidak aktif!`);
    return;
  }

  const buyAmount = isNaN(amount) ? config[chainName]?.buyAmount || 0.05 : amount;
  const isDry = config.bot.dryRun;
  const modeBadge = isDry ? '🧪 SIM' : '🚨 REAL';

  await telegram.send(`⏳ Membeli token di ${chainName.toUpperCase()}... [${modeBadge}]\n<code>${tokenCA}</code>\nNominal: ${buyAmount} ${chain.symbol}`);

  const result = await chain.buyToken(tokenCA, buyAmount, { dryRun: isDry });

  if (result.success) {
    const currentPrice = await chain.getTokenPrice(tokenCA);
    let tokenMeta = { symbol: '', name: '' };
    try {
      if (typeof chain.getTokenMetadata === 'function') {
        tokenMeta = await chain.getTokenMetadata(tokenCA);
      }
    } catch (e) {}

    const tradeId = db.recordTrade({
      chain: chainName,
      type: 'MANUAL_BUY',
      token_address: tokenCA,
      token_symbol: tokenMeta.symbol || '',
      token_name: tokenMeta.name || '',
      buy_price: currentPrice,
      buy_amount: buyAmount,
      token_amount: result.outAmount || 0,
      native_spent: buyAmount,
      tx_hash: result.txHash,
      source_wallet: 'MANUAL',
      status: 'OPEN',
      dry_run: isDry ? 1 : 0
    });

    if (config.autoSell.enabled && currentPrice > 0) {
      db.addPosition({
        trade_id: tradeId,
        chain: chainName,
        token_address: tokenCA,
        token_symbol: tokenMeta.symbol || '',
        buy_price: currentPrice,
        highest_price: currentPrice,
        token_amount: result.outAmount || 0,
        native_spent: buyAmount
      });
    }

    const successMsg =
      `🎉 <b>BERHASIL DIBELI!</b> [${modeBadge}]\n\n` +
      `🌐 ${chainName.toUpperCase()} | ${tokenMeta.symbol || tokenCA.slice(0, 8)}\n` +
      `💵 Spent: ${buyAmount} ${chain.symbol}\n` +
      `📊 Price: $${currentPrice.toFixed(8)}\n` +
      `🔗 <a href="${chain.getExplorerUrl(result.txHash)}">Cek TX</a>`;

    const btns = {
      inline_keyboard: [
        [
          { text: '📈 DexScreener', url: chain.getDexScreenerUrl(tokenCA) },
          { text: '🔍 Explorer', url: chain.getExplorerUrl(result.txHash) }
        ]
      ]
    };

    await telegram.send(successMsg, btns);
  } else {
    await telegram.send(`❌ <b>GAGAL BELI:</b> ${result.error}`);
  }
}

// ==================== MANUAL SELL ====================
async function handleManualSell(msg) {
  const text = msg.text.trim();
  const parts = text.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const tokenCA = parts[1];
  const percent = parseInt(parts[2]) || 100;

  if (!tokenCA) {
    await telegram.send(`⚠️ Format: <code>${cmd} TOKEN_CA PERSEN</code>\nContoh: <code>${cmd} 7xKX...pump 100</code>`);
    return;
  }

  const chainMap = { '/sellsol': 'solana', '/sellbase': 'base', '/sellbsc': 'bsc', '/selleth': 'eth' };
  const chainName = chainMap[cmd];
  if (!chainName) return;

  const chain = chainManager.getChain(chainName);
  if (!chain) {
    await telegram.send(`❌ Chain <b>${chainName.toUpperCase()}</b> tidak aktif!`);
    return;
  }

  const isDry = config.bot.dryRun;
  const modeBadge = isDry ? '🧪 SIM' : '🚨 REAL';

  await telegram.send(`⏳ Menjual ${percent}% token di ${chainName.toUpperCase()}... [${modeBadge}]\n<code>${tokenCA}</code>`);

  const result = await chain.sellToken(tokenCA, percent, { dryRun: isDry });

  if (result.success) {
    const successMsg =
      `💰 <b>BERHASIL DIJUAL!</b> [${modeBadge}]\n\n` +
      `🌐 ${chainName.toUpperCase()}\n` +
      `🪙 <code>${tokenCA}</code>\n` +
      `📊 Sell: ${percent}%\n` +
      `🔗 <a href="${chain.getExplorerUrl(result.txHash)}">Cek TX</a>`;
    await telegram.send(successMsg);
  } else {
    await telegram.send(`❌ <b>GAGAL JUAL:</b> ${result.error}`);
  }
}

// ==================== AUTO-SELL STATUS ====================
async function showAutoSellStatus() {
  const cfg = config.autoSell;
  const positions = db.getActivePositions();

  let posText = '';
  if (positions.length === 0) {
    posText = '<i>Tidak ada posisi terbuka.</i>';
  } else {
    for (const p of positions) {
      const buyPrice = Number(p.buy_price) || 0;
      posText += `• [${p.chain.toUpperCase()}] ${p.token_symbol || p.token_address.slice(0, 8)} | Buy: $${buyPrice.toFixed(6)} | Spent: ${Number(p.native_spent || 0).toFixed(4)}\n`;
    }
  }

  const msg =
    `⚡ <b>AUTO-SELL ENGINE</b>\n\n` +
    `• <b>Status:</b> ${cfg.enabled ? '✅ AKTIF' : '❌ OFF'}\n` +
    `• <b>Take Profit:</b> +${cfg.takeProfitPercent}%\n` +
    `• <b>Stop Loss:</b> -${cfg.stopLossPercent}%\n` +
    `• <b>Trailing Stop:</b> -${cfg.trailingStopPercent}% dari puncak\n` +
    `• <b>Check Interval:</b> ${cfg.checkIntervalMs / 1000}s\n\n` +
    `📌 <b>Posisi Dipantau (${positions.length}):</b>\n${posText}`;

  const inlineKeyboard = {
    inline_keyboard: [
      [
        { text: '🔄 Refresh', callback_data: 'SHOW_AUTOSELL' },
        { text: '👈 Menu', callback_data: 'MAIN_MENU' }
      ]
    ]
  };

  await telegram.send(msg, inlineKeyboard);
}

// ==================== PNL STATS ====================
async function showPnLStats() {
  const stats = db.getTradeStats();
  const openTrades = db.getOpenTrades();

  const msg =
    `📊 <b>PERFORMA TRADING (PnL)</b>\n\n` +
    `• <b>Total Trade:</b> ${stats.total}\n` +
    `• <b>Closed:</b> ${stats.closed}\n` +
    `• <b>Wins:</b> ${stats.wins} (${stats.winRate}%)\n` +
    `• <b>Total PnL:</b> <b>${stats.totalPnl}</b>\n` +
    `• <b>Posisi Terbuka:</b> ${openTrades.length}`;

  const inlineKeyboard = {
    inline_keyboard: [
      [
        { text: '📜 Riwayat Trade', callback_data: 'SHOW_HISTORY' },
        { text: '👈 Menu', callback_data: 'MAIN_MENU' }
      ]
    ]
  };

  await telegram.send(msg, inlineKeyboard);
}

// ==================== OPEN POSITIONS ====================
async function showOpenPositions() {
  const positions = db.getActivePositions();

  let msg = `📂 <b>POSISI TERBUKA (${positions.length})</b>\n\n`;

  if (positions.length === 0) {
    msg += '<i>Tidak ada posisi terbuka.</i>';
  } else {
    for (const p of positions) {
      const chain = chainManager.getChain(p.chain);
      const currentPrice = chain ? await chain.getTokenPrice(p.token_address) : 0;
      const buyPrice = Number(p.buy_price) || 0;
      const pnl = buyPrice > 0 ? ((currentPrice - buyPrice) / buyPrice * 100).toFixed(1) : '0';
      const emoji = Number(pnl) >= 0 ? '🟢' : '🔴';

      msg += `${emoji} [${p.chain.toUpperCase()}] <b>${p.token_symbol || p.token_address.slice(0, 8)}</b>\n`;
      msg += `   Buy: $${buyPrice.toFixed(6)} | Now: $${currentPrice.toFixed(6)} | PnL: ${pnl}%\n`;
      msg += `   Spent: ${Number(p.native_spent || 0).toFixed(4)} | CA: <code>${p.token_address.slice(0, 10)}...</code>\n\n`;
    }
  }

  const inlineKeyboard = {
    inline_keyboard: [
      [
        { text: '🔄 Refresh', callback_data: 'SHOW_POSITIONS' },
        { text: '👈 Menu', callback_data: 'MAIN_MENU' }
      ]
    ]
  };

  await telegram.send(msg, inlineKeyboard);
}

// ==================== TRADE HISTORY ====================
async function showTradeHistory() {
  const trades = db.getRecentTrades(10);

  let msg = `📜 <b>RIWAYAT TRADE (Last 10)</b>\n\n`;

  if (trades.length === 0) {
    msg += '<i>Belum ada trade.</i>';
  } else {
    for (const t of trades) {
      const emoji = t.status === 'OPEN' ? '🟡' : (Number(t.pnl_percent) >= 0 ? '🟢' : '🔴');
      const pnlText = t.status === 'CLOSED' ? ` | PnL: ${Number(t.pnl_percent).toFixed(1)}%` : '';
      msg += `${emoji} [${t.chain.toUpperCase()}] ${t.type} | ${t.token_symbol || t.token_address.slice(0, 8)} | ${t.status}${pnlText}\n`;
    }
  }

  const inlineKeyboard = {
    inline_keyboard: [
      [{ text: '👈 Menu', callback_data: 'MAIN_MENU' }]
    ]
  };

  await telegram.send(msg, inlineKeyboard);
}

// ==================== TOGGLE MODE ====================
async function toggleMode() {
  config.bot.dryRun = !config.bot.dryRun;
  const modeText = config.bot.dryRun ? '🧪 SIMULASI' : '🔴 REAL TRADE';
  await telegram.send(`⚡ Mode diubah ke: <b>${modeText}</b>\n\n<i>Catatan: perubahan ini tidak permanen. Restart bot akan kembali ke setting .env</i>`);
  await showMainMenu();
}

// ==================== QUICK BUY HELP ====================
async function showQuickBuyHelp() {
  const msg =
    `⚡ <b>QUICK BUY / SELL MANUAL</b>\n\n` +
    `<b>Beli Token:</b>\n` +
    `• <code>/buysol CA JUMLAH_SOL</code>\n` +
    `• <code>/buybase CA JUMLAH_ETH</code>\n` +
    `• <code>/buybsc CA JUMLAH_BNB</code>\n` +
    `• <code>/buyeth CA JUMLAH_ETH</code>\n\n` +
    `<b>Jual Token:</b>\n` +
    `• <code>/sellsol CA PERSEN</code>\n` +
    `• <code>/sellbase CA PERSEN</code>\n` +
    `• <code>/sellbsc CA PERSEN</code>\n` +
    `• <code>/selleth CA PERSEN</code>\n\n` +
    `<b>Contoh:</b>\n` +
    `<code>/buysol 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU 0.1</code>\n` +
    `<code>/sellsol 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU 100</code>`;

  await telegram.send(msg);
}

// ==================== HELP ====================
async function showHelp() {
  const msg =
    `📖 <b>ANUBIS TERMINAL v2.0 - HELP</b>\n\n` +
    `<b>🔹 Menu Utama</b>\n` +
    `• /start /menu - Buka dashboard\n` +
    `• /help - Tampilkan help ini\n\n` +
    `<b>🔹 Portfolio</b>\n` +
    `• /balance - Cek saldo semua chain\n` +
    `• /pnl - Lihat statistik profit/loss\n\n` +
    `<b>🔹 Target Wallet</b>\n` +
    `• /targets - Lihat daftar target\n` +
    `• /addsol ADDRESS - Tambah target Solana\n` +
    `• /addbase ADDRESS - Tambah target Base\n` +
    `• /addbsc ADDRESS - Tambah target BSC\n` +
    `• /addeth ADDRESS - Tambah target ETH\n` +
    `• /delsol ADDRESS - Hapus target Solana\n` +
    `• /delbase ADDRESS - Hapus target Base\n` +
    `• /delbsc ADDRESS - Hapus target BSC\n` +
    `• /deleth ADDRESS - Hapus target ETH\n\n` +
    `<b>🔹 Manual Trading</b>\n` +
    `• /buysol CA JUMLAH - Beli di Solana\n` +
    `• /buybase CA JUMLAH - Beli di Base\n` +
    `• /buybsc CA JUMLAH - Beli di BSC\n` +
    `• /buyeth CA JUMLAH - Beli di ETH\n` +
    `• /sellsol CA PERSEN - Jual di Solana\n` +
    `• /sellbase CA PERSEN - Jual di Base\n` +
    `• /sellbsc CA PERSEN - Jual di BSC\n` +
    `• /selleth CA PERSEN - Jual di ETH\n\n` +
    `<b>🔹 Chains Supported:</b> Solana, Base, BSC, Ethereum`;

  const inlineKeyboard = {
    inline_keyboard: [
      [{ text: '👈 Menu', callback_data: 'MAIN_MENU' }]
    ]
  };

  await telegram.send(msg, inlineKeyboard);
}

module.exports = { registerUIHandlers };
