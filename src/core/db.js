const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', '..', 'anubis-data.json');

function loadData() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const raw = fs.readFileSync(DB_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && parsed._nextId) return parsed;
      console.warn('⚠️ DB file format invalid, creating fresh database');
    }
  } catch (e) {
    console.error('⚠️ DB load error, creating fresh database:', e.message);
  }
  return {
    target_wallets: [],
    trades: [],
    active_positions: [],
    sniped_tokens: [],
    _nextId: { wallets: 1, trades: 1, positions: 1, sniped: 1 }
  };
}

let saveTimeout = null;
function saveData(data) {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    try {
      fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
      console.error('❌ DB Save Error:', e.message);
    }
  }, 100);
}

function saveDataSync(data) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('❌ DB Save Error:', e.message);
  }
}

let data = loadData();

module.exports = {
  getTargetWallets: (chain) => {
    return data.target_wallets.filter(w => w.chain === chain);
  },

  getAllTargetWallets: () => {
    return [...data.target_wallets];
  },

  addTargetWallet: (chain, address, label = '') => {
    const exists = data.target_wallets.find(w => w.chain === chain && w.address === address);
    if (exists) return { added: false, message: 'Wallet sudah ada di daftar target' };
    data.target_wallets.push({
      id: data._nextId.wallets++,
      chain,
      address,
      label,
      created_at: new Date().toISOString()
    });
    saveData(data);
    return { added: true, message: 'Wallet berhasil ditambahkan' };
  },

  removeTargetWallet: (chain, address) => {
    const before = data.target_wallets.length;
    data.target_wallets = data.target_wallets.filter(w => !(w.chain === chain && w.address === address));
    const removed = data.target_wallets.length < before;
    if (removed) saveData(data);
    return { removed, message: removed ? 'Wallet dihapus dari daftar target' : 'Wallet tidak ditemukan' };
  },

  recordTrade: (tradeData) => {
    const id = data._nextId.trades++;
    data.trades.push({
      id,
      chain: tradeData.chain || '',
      type: tradeData.type || 'BUY',
      token_address: tradeData.token_address || '',
      token_symbol: tradeData.token_symbol || '',
      token_name: tradeData.token_name || '',
      buy_price: Number(tradeData.buy_price) || 0,
      sell_price: 0,
      buy_amount: Number(tradeData.buy_amount) || 0,
      token_amount: Number(tradeData.token_amount) || 0,
      native_spent: Number(tradeData.native_spent) || 0,
      tx_hash: tradeData.tx_hash || '',
      source_wallet: tradeData.source_wallet || '',
      status: tradeData.status || 'OPEN',
      dry_run: tradeData.dry_run ? 1 : 0,
      pnl_percent: 0,
      pnl_native: 0,
      created_at: new Date().toISOString(),
      closed_at: null
    });
    saveData(data);
    return id;
  },

  closeTrade: (id, sellPrice, pnlPercent, pnlNative) => {
    const trade = data.trades.find(t => t.id === id);
    if (trade) {
      trade.status = 'CLOSED';
      trade.sell_price = Number(sellPrice) || 0;
      trade.pnl_percent = Number(pnlPercent) || 0;
      trade.pnl_native = Number(pnlNative) || 0;
      trade.closed_at = new Date().toISOString();
    }
    data.active_positions = data.active_positions.filter(p => p.trade_id !== id);
    saveData(data);
  },

  getOpenTrades: (chain) => {
    if (chain) {
      return data.trades.filter(t => t.status === 'OPEN' && t.chain === chain);
    }
    return data.trades.filter(t => t.status === 'OPEN');
  },

  getRecentTrades: (limit = 10) => {
    return [...data.trades].reverse().slice(0, limit);
  },

  getTradeStats: () => {
    const closedTrades = data.trades.filter(t => t.status === 'CLOSED');
    const total = data.trades.length;
    const closed = closedTrades.length;
    const wins = closedTrades.filter(t => t.pnl_percent > 0).length;
    const totalPnl = closedTrades.reduce((sum, t) => sum + (Number(t.pnl_native) || 0), 0);
    return {
      total,
      closed,
      wins,
      winRate: closed > 0 ? ((wins / closed) * 100).toFixed(1) : '0.0',
      totalPnl: totalPnl.toFixed(4)
    };
  },

  addPosition: (pos) => {
    const id = data._nextId.positions++;
    data.active_positions.push({
      id,
      trade_id: pos.trade_id,
      chain: pos.chain || '',
      token_address: pos.token_address || '',
      token_symbol: pos.token_symbol || '',
      buy_price: Number(pos.buy_price) || 0,
      highest_price: Number(pos.highest_price) || Number(pos.buy_price) || 0,
      token_amount: Number(pos.token_amount) || 0,
      native_spent: Number(pos.native_spent) || 0,
      created_at: new Date().toISOString()
    });
    saveData(data);
  },

  getActivePositions: () => {
    return [...data.active_positions];
  },

  updateHighestPrice: (id, highestPrice) => {
    const pos = data.active_positions.find(p => p.id === id);
    if (pos) {
      pos.highest_price = Number(highestPrice) || pos.highest_price;
      saveData(data);
    }
  },

  addSnipedToken: (tokenData) => {
    const id = data._nextId.sniped++;
    data.sniped_tokens.push({
      id,
      ...tokenData,
      created_at: new Date().toISOString()
    });
    saveData(data);
    return id;
  },

  getSnipedTokens: (limit = 10) => {
    return [...(data.sniped_tokens || [])].reverse().slice(0, limit);
  },

  flush: () => {
    saveDataSync(data);
  }
};
