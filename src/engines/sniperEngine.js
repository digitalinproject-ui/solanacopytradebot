const chainManager = require('../chains');
const db = require('../core/db');
const telegram = require('../core/telegram');
const config = require('../core/config');
const { PublicKey } = require('@solana/web3.js');
const fetch = require('cross-fetch');

const RAYDIUM_LIQUIDITY_V4 = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';
const WSOL_MINT = 'So11111111111111111111111111111111111111112';

class SniperEngine {
  constructor() {
    this.isListening = false;
    this.recentPools = new Set();
  }

  start() {
    if (!config.sniper.enabled) {
      console.log('⏸️ Token Sniper Engine disabled');
      return;
    }

    console.log(`🎯 Token Sniper Engine started (Chains: ${config.sniper.chains.join(', ')} | Auto-Buy: ${config.sniper.autoBuy ? 'ON' : 'OFF'})`);
    this.isListening = true;

    for (const chainName of config.sniper.chains) {
      try {
        const chain = chainManager.getChain(chainName);
        if (!chain) continue;
        this.listenForNewPools(chain);
      } catch (e) {
        console.warn(`⚠️ [Sniper] Could not start on ${chainName}: ${e.message}`);
      }
    }
  }

  listenForNewPools(chain) {
    if (chain.name === 'solana') {
      this._listenRaydiumPools(chain);
    } else {
      this._listenEvmPools(chain);
    }
  }

  _listenRaydiumPools(chain) {
    try {
      const raydiumPubKey = new PublicKey(RAYDIUM_LIQUIDITY_V4);

      chain.connection.onLogs(
        raydiumPubKey,
        async (logs, ctx) => {
          if (logs.err) return;
          const logStr = logs.logs.join(' ');

          if (!logStr.includes('initialize2') && !logStr.includes('InitInstruction')) return;

          const txHash = logs.signature;
          if (this.recentPools.has(txHash)) return;
          this.recentPools.add(txHash);

          console.log(`🔥 [SNIPER] New Raydium Pool Detected! TX: ${txHash}`);

          try {
            const tokenMint = await this._extractNewPoolToken(chain, txHash);
            if (!tokenMint) return;

            let tokenMeta = { symbol: 'NEW', name: '' };
            try {
              tokenMeta = await chain.getTokenMetadata(tokenMint);
            } catch (e) {}

            db.addSnipedToken({
              chain: 'solana',
              token_address: tokenMint,
              pool_address: '',
              tx_hash: txHash
            });

            const alertMsg =
              `🎯 <b>NEW POOL DETECTED!</b> (Raydium)\n\n` +
              `🪙 <b>Token:</b> ${tokenMeta.symbol} ${tokenMeta.name ? `(${tokenMeta.name})` : ''}\n` +
              `📋 <b>CA:</b> <code>${tokenMint}</code>\n` +
              `🔗 <b>Pool TX:</b> <a href="https://solscan.io/tx/${txHash}">Solscan</a>`;

            const btns = {
              inline_keyboard: [
                [
                  { text: '📈 DexScreener', url: `https://dexscreener.com/solana/${tokenMint}` },
                  { text: '🔍 Solscan', url: `https://solscan.io/token/${tokenMint}` }
                ]
              ]
            };

            if (config.sniper.autoBuy) {
              btns.inline_keyboard.push([
                { text: `🚀 SNIPING ${config.sniper.buyAmountSol} SOL...`, callback_data: 'NOOP' }
              ]);
            }

            await telegram.send(alertMsg, btns);

            if (config.sniper.autoBuy) {
              await this._executeSnipe(chain, tokenMint, tokenMeta);
            }
          } catch (e) {
            console.error(`⚠️ [Sniper] Error processing pool:`, e.message);
          }
        },
        'confirmed'
      );
      console.log('🎯 [Sniper] Listening for new Raydium V4 pools on Solana...');
    } catch (e) {
      console.error('❌ [Sniper] Failed to listen Raydium pools:', e.message);
    }
  }

  async _extractNewPoolToken(chain, txHash) {
    try {
      await new Promise(r => setTimeout(r, 2000));

      const tx = await chain.connection.getParsedTransaction(txHash, {
        maxSupportedTransactionVersion: 0
      });
      if (!tx || !tx.meta) return null;

      const postTokenBalances = tx.meta.postTokenBalances || [];
      for (const bal of postTokenBalances) {
        if (bal.mint && bal.mint !== WSOL_MINT) {
          return bal.mint;
        }
      }
    } catch (e) {
      console.error(`⚠️ [Sniper] Extract token error:`, e.message);
    }
    return null;
  }

  async _executeSnipe(chain, tokenMint, tokenMeta) {
    const isDry = config.bot.dryRun;
    const modeBadge = isDry ? '🧪 SIMULASI' : '🚨 REAL SNIPE';

    console.log(`🚀 [SNIPER] Attempting snipe: ${tokenMint} (${config.sniper.buyAmountSol} SOL)`);

    const result = await chain.buyToken(tokenMint, config.sniper.buyAmountSol, { dryRun: isDry });

    if (result.success) {
      const currentPrice = await chain.getTokenPrice(tokenMint);

      const tradeId = db.recordTrade({
        chain: 'solana',
        type: 'SNIPE',
        token_address: tokenMint,
        token_symbol: tokenMeta.symbol || '',
        token_name: tokenMeta.name || '',
        buy_price: currentPrice,
        buy_amount: config.sniper.buyAmountSol,
        token_amount: result.outAmount || 0,
        native_spent: config.sniper.buyAmountSol,
        tx_hash: result.txHash,
        source_wallet: 'SNIPER',
        status: 'OPEN',
        dry_run: isDry ? 1 : 0
      });

      if (config.autoSell.enabled && currentPrice > 0) {
        db.addPosition({
          trade_id: tradeId,
          chain: 'solana',
          token_address: tokenMint,
          token_symbol: tokenMeta.symbol || '',
          buy_price: currentPrice,
          highest_price: currentPrice,
          token_amount: result.outAmount || 0,
          native_spent: config.sniper.buyAmountSol
        });
      }

      const msg =
        `🎉 <b>SNIPE BERHASIL!</b> [${modeBadge}]\n\n` +
        `🪙 ${tokenMeta.symbol || 'NEW TOKEN'}\n` +
        `📋 <code>${tokenMint}</code>\n` +
        `💵 Spent: ${config.sniper.buyAmountSol} SOL\n` +
        `📊 Price: $${currentPrice.toFixed(8)}\n` +
        `🔗 <a href="${chain.getExplorerUrl(result.txHash)}">Cek TX</a>`;
      await telegram.send(msg);
    } else {
      await telegram.send(`❌ <b>SNIPE GAGAL:</b> ${result.error}`);
    }
  }

  _listenEvmPools(chain) {
    try {
      const activeProvider = chain.wsProvider || chain.provider;
      console.log(`🎯 [Sniper] Listening for new pools on ${chain.name.toUpperCase()} (DexScreener polling)...`);

      setInterval(async () => {
        try {
          const res = await fetch(`https://api.dexscreener.com/latest/dex/search?q=new+pair+${chain.name}`);
          const data = await res.json();
          if (data && data.pairs) {
            for (const pair of data.pairs.slice(0, 3)) {
              if (pair.chainId === chain.name && pair.pairCreatedAt) {
                const ageMs = Date.now() - pair.pairCreatedAt;
                if (ageMs < 300000 && !this.recentPools.has(pair.pairAddress)) {
                  this.recentPools.add(pair.pairAddress);
                  const alertMsg =
                    `🎯 <b>NEW POOL!</b> (${chain.name.toUpperCase()})\n\n` +
                    `🪙 <b>Token:</b> ${pair.baseToken?.symbol || '???'}\n` +
                    `📋 <b>CA:</b> <code>${pair.baseToken?.address || ''}</code>\n` +
                    `💧 <b>Liquidity:</b> $${Number(pair.liquidity?.usd || 0).toLocaleString()}\n` +
                    `📈 <b>Price:</b> $${pair.priceUsd || '0'}`;

                  const btns = {
                    inline_keyboard: [
                      [{ text: '📈 DexScreener', url: pair.url || `https://dexscreener.com/${chain.name}/${pair.pairAddress}` }]
                    ]
                  };
                  await telegram.send(alertMsg, btns);
                }
              }
            }
          }
        } catch (e) {}
      }, 30000);
    } catch (e) {
      console.error(`❌ [Sniper] EVM pool listener failed for ${chain.name}:`, e.message);
    }
  }
}

module.exports = new SniperEngine();
