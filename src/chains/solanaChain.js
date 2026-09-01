const BaseChain = require('./baseChain');
const config = require('../core/config');
const { Connection, PublicKey, Keypair, VersionedTransaction } = require('@solana/web3.js');
const bs58 = require('bs58').default || require('bs58');
const fetch = require('cross-fetch');

const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

class SolanaChain extends BaseChain {
  constructor() {
    super('solana', 'SOL', 9);
    this.cfg = config.solana;
    this.connection = new Connection(this.cfg.rpcHttp, {
      wsEndpoint: this.cfg.rpcWs,
      commitment: 'confirmed'
    });
    this.keypair = null;
    if (this.cfg.privateKey) {
      try {
        this.keypair = Keypair.fromSecretKey(bs58.decode(this.cfg.privateKey));
        console.log(`✅ [Solana] Wallet loaded: ${this.keypair.publicKey.toBase58().slice(0, 8)}...`);
      } catch (e) {
        console.error('❌ [Solana] Private key invalid');
      }
    }
    this.subscriptions = new Map();
    this._reconnectTimers = new Map();
  }

  async getBalance() {
    if (!this.keypair) return '0.0000';
    try {
      const lamports = await this.connection.getBalance(this.keypair.publicKey);
      return (lamports / 1e9).toFixed(4);
    } catch (e) {
      return '0.0000';
    }
  }

  async getTokenBalances() {
    if (!this.keypair) return [];
    try {
      const parsed = await this.connection.getParsedTokenAccountsByOwner(
        this.keypair.publicKey,
        { programId: TOKEN_PROGRAM_ID }
      );
      const tokens = [];
      for (const item of parsed.value) {
        const info = item.account.data.parsed.info;
        const uiAmount = info.tokenAmount.uiAmount;
        if (uiAmount && uiAmount > 0) {
          let symbol = '';
          let name = '';
          try {
            const metaRes = await fetch(`https://tokens.jup.ag/token/${info.mint}`);
            const meta = await metaRes.json();
            if (meta && meta.symbol) {
              symbol = meta.symbol;
              name = meta.name || '';
            }
          } catch (e) {}
          tokens.push({
            mint: info.mint,
            amount: uiAmount,
            decimals: info.tokenAmount.decimals,
            rawAmount: info.tokenAmount.amount,
            symbol,
            name
          });
        }
      }
      return tokens;
    } catch (e) {
      return [];
    }
  }

  async buyToken(tokenAddress, amountSol, options = {}) {
    const isDry = options.dryRun !== undefined ? options.dryRun : config.bot.dryRun;
    const slippageBps = options.slippageBps || this.cfg.slippageBps;

    if (isDry || !this.keypair) {
      return {
        success: true,
        dryRun: true,
        txHash: 'DRY_' + Date.now(),
        amountSpent: amountSol,
        tokenAddress
      };
    }

    try {
      const amountLamports = Math.floor(amountSol * 1e9);

      const quoteRes = await fetch(
        `https://quote-api.jup.ag/v6/quote?inputMint=${WSOL_MINT}&outputMint=${tokenAddress}&amount=${amountLamports}&slippageBps=${slippageBps}`
      );
      const quote = await quoteRes.json();
      if (quote.error) throw new Error(`Quote gagal: ${quote.error}`);

      const swapRes = await fetch('https://quote-api.jup.ag/v6/swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteResponse: quote,
          userPublicKey: this.keypair.publicKey.toBase58(),
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: this.cfg.priorityFee === 'auto' ? 'auto' : parseInt(this.cfg.priorityFee)
        })
      });
      const swapData = await swapRes.json();
      if (!swapData.swapTransaction) throw new Error(`Swap gagal: ${JSON.stringify(swapData.error || swapData)}`);

      const swapTxBuf = Buffer.from(swapData.swapTransaction, 'base64');
      const transaction = VersionedTransaction.deserialize(swapTxBuf);
      transaction.sign([this.keypair]);

      const txid = await this.connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: true,
        maxRetries: 3
      });

      try {
        await this.connection.confirmTransaction(txid, 'confirmed');
      } catch (e) {
        console.warn(`⚠️ [Solana] Tx confirmation timeout: ${txid}`);
      }

      return {
        success: true,
        dryRun: false,
        txHash: txid,
        amountSpent: amountSol,
        outAmount: Number(quote.outAmount) || 0,
        tokenAddress
      };
    } catch (err) {
      return { success: false, error: err.message, tokenAddress };
    }
  }

  async sellToken(tokenAddress, percentage = 100, options = {}) {
    const isDry = options.dryRun !== undefined ? options.dryRun : config.bot.dryRun;
    const slippageBps = options.slippageBps || this.cfg.slippageBps;

    if (isDry || !this.keypair) {
      return { success: true, dryRun: true, txHash: 'DRY_SELL_' + Date.now() };
    }

    try {
      const parsed = await this.connection.getParsedTokenAccountsByOwner(
        this.keypair.publicKey,
        { programId: TOKEN_PROGRAM_ID }
      );

      let tokenAccount = null;
      for (const item of parsed.value) {
        const info = item.account.data.parsed.info;
        if (info.mint === tokenAddress) {
          tokenAccount = info;
          break;
        }
      }
      if (!tokenAccount) throw new Error('Token tidak ditemukan di wallet');

      const rawBalance = BigInt(tokenAccount.tokenAmount.amount);
      if (rawBalance === 0n) throw new Error('Saldo token 0');

      const sellAmount = (rawBalance * BigInt(percentage)) / 100n;

      const quoteRes = await fetch(
        `https://quote-api.jup.ag/v6/quote?inputMint=${tokenAddress}&outputMint=${WSOL_MINT}&amount=${sellAmount.toString()}&slippageBps=${slippageBps}`
      );
      const quote = await quoteRes.json();
      if (quote.error) throw new Error(`Quote gagal: ${quote.error}`);

      const swapRes = await fetch('https://quote-api.jup.ag/v6/swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteResponse: quote,
          userPublicKey: this.keypair.publicKey.toBase58(),
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: this.cfg.priorityFee === 'auto' ? 'auto' : parseInt(this.cfg.priorityFee)
        })
      });
      const swapData = await swapRes.json();
      if (!swapData.swapTransaction) throw new Error(`Swap gagal: ${JSON.stringify(swapData.error || swapData)}`);

      const swapTxBuf = Buffer.from(swapData.swapTransaction, 'base64');
      const transaction = VersionedTransaction.deserialize(swapTxBuf);
      transaction.sign([this.keypair]);

      const txid = await this.connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: true,
        maxRetries: 3
      });

      try {
        await this.connection.confirmTransaction(txid, 'confirmed');
      } catch (e) {}

      return {
        success: true,
        dryRun: false,
        txHash: txid,
        receivedSol: Number(quote.outAmount) / 1e9
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async getTokenPrice(tokenAddress) {
    try {
      const res = await fetch(`https://api.jup.ag/price/v2?ids=${tokenAddress}`);
      const data = await res.json();
      if (data && data.data && data.data[tokenAddress]) {
        return parseFloat(data.data[tokenAddress].price) || 0;
      }
    } catch (e) {}
    try {
      const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`);
      const data = await res.json();
      if (data && data.pairs && data.pairs.length > 0) {
        const solPair = data.pairs.find(p => p.chainId === 'solana') || data.pairs[0];
        return parseFloat(solPair.priceUsd) || 0;
      }
    } catch (e) {}
    return 0;
  }

  async getTokenMetadata(tokenAddress) {
    try {
      const res = await fetch(`https://tokens.jup.ag/token/${tokenAddress}`);
      const meta = await res.json();
      if (meta && meta.symbol) {
        return { symbol: meta.symbol, name: meta.name || '' };
      }
    } catch (e) {}
    return { symbol: 'UNKNOWN', name: '' };
  }

  async parseTransactionForBoughtToken(txHash, targetWallet) {
    try {
      const tx = await this.connection.getParsedTransaction(txHash, {
        maxSupportedTransactionVersion: 0
      });
      if (!tx || !tx.meta) return null;

      const preBalances = tx.meta.preTokenBalances || [];
      const postBalances = tx.meta.postTokenBalances || [];

      for (const post of postBalances) {
        if (post.owner === targetWallet) {
          const pre = preBalances.find(p => p.accountIndex === post.accountIndex);
          const preAmt = pre ? parseFloat(pre.uiTokenAmount?.uiAmount || 0) : 0;
          const postAmt = parseFloat(post.uiTokenAmount?.uiAmount || 0);

          if (!isNaN(postAmt) && !isNaN(preAmt) && postAmt > preAmt && post.mint !== WSOL_MINT) {
            return {
              tokenMint: post.mint,
              amountBought: postAmt - preAmt
            };
          }
        }
      }
    } catch (e) {
      console.error(`⚠️ [Solana] Parse tx error (${txHash}):`, e.message);
    }
    return null;
  }

  async monitorWallet(walletAddress, onSignalCallback) {
    if (this.subscriptions.has(walletAddress)) {
      console.log(`ℹ️ [Solana] Already monitoring: ${walletAddress.slice(0, 8)}...`);
      return;
    }

    try {
      const pubKey = new PublicKey(walletAddress);
      const subId = this.connection.onLogs(
        pubKey,
        async (logs, context) => {
          if (logs.err) return;
          const result = await this.parseTransactionForBoughtToken(logs.signature, walletAddress);
          if (result) {
            onSignalCallback({
              chain: 'solana',
              targetWallet: walletAddress,
              tokenAddress: result.tokenMint,
              txHash: logs.signature,
              amountBought: result.amountBought
            });
          }
        },
        'confirmed'
      );
      this.subscriptions.set(walletAddress, subId);
      console.log(`👁️ [Solana] Monitoring wallet: ${walletAddress.slice(0, 8)}...`);
    } catch (e) {
      console.error(`❌ [Solana] Monitor failed ${walletAddress}:`, e.message);
    }
  }

  async stopMonitorWallet(walletAddress) {
    const subId = this.subscriptions.get(walletAddress);
    if (subId !== undefined) {
      try {
        await this.connection.removeAccountChangeListener(subId);
      } catch (e) {}
      this.subscriptions.delete(walletAddress);
    }
  }

  getExplorerUrl(txHash) {
    return `https://solscan.io/tx/${txHash}`;
  }

  getTokenExplorerUrl(tokenAddress) {
    return `https://solscan.io/token/${tokenAddress}`;
  }
}

module.exports = SolanaChain;
