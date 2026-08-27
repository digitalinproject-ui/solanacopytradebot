require('dotenv').config();
const { Connection, PublicKey, Keypair, VersionedTransaction } = require('@solana/web3.js');
const bs58 = require('bs58').default || require('bs58');
const fetch = require('cross-fetch');

const RPC_HTTP = process.env.RPC_HTTP_URL || 'https://api.mainnet-beta.solana.com';
const RPC_WS = process.env.RPC_WS_URL || 'wss://api.mainnet-beta.solana.com';
let TARGET_WALLETS = (process.env.TARGET_WALLETS || '').split(',').map(w => w.trim()).filter(Boolean);
let DRY_RUN = process.env.DRY_RUN !== 'false';
let BUY_AMOUNT_SOL = parseFloat(process.env.BUY_AMOUNT_SOL || '0.05');

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const connection = new Connection(RPC_HTTP, {
  wsEndpoint: RPC_WS,
  commitment: 'confirmed'
});

let userKeypair = null;
if (process.env.MY_PRIVATE_KEY) {
  try {
    userKeypair = Keypair.fromSecretKey(bs58.decode(process.env.MY_PRIVATE_KEY));
  } catch (e) {}
}

// Keyboards Setup
const replyKeyboard = {
  keyboard: [
    [{ text: '💳 Portfolio' }, { text: '🎯 Target List' }],
    [{ text: '⚙️ Status & Menu' }]
  ],
  resize_keyboard: true,
  persistent: true
};

async function sendTelegram(text, replyMarkup = replyKeyboard) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    const body = {
      chat_id: TELEGRAM_CHAT_ID,
      text: text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: replyMarkup
    };
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch (err) {
    console.error('❌ Telegram error:', err.message);
  }
}

let lastUpdateId = 0;
async function pollTelegramUpdates() {
  if (!TELEGRAM_TOKEN) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=10`);
    const data = await res.json();
    if (data.ok && data.result) {
      for (const update of data.result) {
        lastUpdateId = update.update_id;
        
        if (update.message) {
          const fromId = String(update.message.chat.id);
          if (fromId !== String(TELEGRAM_CHAT_ID)) continue;
        }
        if (update.callback_query) {
          const fromId = String(update.callback_query.from.id);
          if (fromId !== String(TELEGRAM_CHAT_ID)) continue;
        }

        if (update.message && update.message.text) {
          const text = update.message.text.trim();
          if (text === '/start' || text === '/menu' || text === '⚙️ Status & Menu') {
            await showMainMenu();
          } else if (text === '/balance' || text === '💳 Portfolio') {
            await showBalance();
          } else if (text === '/targets' || text === '🎯 Target List') {
            await showTargets();
          } else if (text.startsWith('/addwallet ')) {
            const newW = text.split(' ')[1];
            if (newW) {
              TARGET_WALLETS.push(newW);
              await sendTelegram(`✨ Wallet target baru berhasil ditambahkan!\n<code>${newW}</code>`);
            }
          }
        }

        if (update.callback_query) {
          const cb = update.callback_query;
          const action = cb.data;
          
          if (action === 'TOGGLE_MODE') {
            DRY_RUN = !DRY_RUN;
            await showMainMenu();
          } else if (action === 'REFRESH_BALANCE') {
            await showBalance();
          } else if (action === 'SHOW_TARGETS') {
            await showTargets();
          } else if (action === 'MAIN_MENU') {
            await showMainMenu();
          }
        }
      }
    }
  } catch (err) {}
  setTimeout(pollTelegramUpdates, 2000);
}

// UI Santai & Modern
async function showMainMenu() {
  const modeStatus = DRY_RUN ? '🧪 Simulasi / Paper Trade' : '🔴 Real Money Trade';
  const walletAddr = userKeypair ? `<code>${userKeypair.publicKey.toBase58()}</code>` : '<i>Belum diisi nih</i>';

  const msg = `Halo bro! Welcome back ke <b>Anubis Terminal</b> 🚀\n\n` +
              `• <b>Mode Aktif:</b> ${modeStatus}\n` +
              `• <b>Wallet Kamu:</b> ${walletAddr}\n` +
              `• <b>Target Dipantau:</b> ${TARGET_WALLETS.length} Smart Wallet\n` +
              `• <b>Nominal Beli:</b> ${BUY_AMOUNT_SOL} SOL per signal\n\n` +
              `Pilih menu santai di bawah ini ya:`;

  const inlineKeyboard = {
    inline_keyboard: [
      [
        { text: '💰 Portfolio & Saldo', callback_data: 'REFRESH_BALANCE' },
        { text: '🎯 Intip Target Wallet', callback_data: 'SHOW_TARGETS' }
      ],
      [
        { text: DRY_RUN ? '⚡ Ganti ke Mode REAL' : '🧪 Ganti ke SIMULASI', callback_data: 'TOGGLE_MODE' }
      ]
    ]
  };

  await sendTelegram(msg, inlineKeyboard);
}

async function showBalance() {
  let solBal = '0.0000';
  let tokenListText = '<i>Belum ada token lain di wallet ini.</i>';

  if (userKeypair) {
    try {
      const lamports = await connection.getBalance(userKeypair.publicKey);
      solBal = (lamports / 1e9).toFixed(4);

      const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
      const parsedTokenAccounts = await connection.getParsedTokenAccountsByOwner(
        userKeypair.publicKey,
        { programId: TOKEN_PROGRAM_ID }
      );

      const tokens = [];
      parsedTokenAccounts.value.forEach(item => {
        const info = item.account.data.parsed.info;
        const amount = info.tokenAmount.uiAmount;
        const mint = info.mint;
        if (amount > 0) {
          tokens.push({ mint, amount });
        }
      });

      if (tokens.length > 0) {
        const tokenTexts = await Promise.all(tokens.map(async (t, i) => {
          let tokenName = 'Unknown Token';
          let symbol = '';
          try {
            const res = await fetch(`https://tokens.jup.ag/token/${t.mint}`);
            const meta = await res.json();
            if (meta && meta.name) {
              tokenName = meta.name;
              symbol = meta.symbol ? `(${meta.symbol})` : '';
            }
          } catch (e) {}
          return `<b>${i+1}. ${tokenName} ${symbol}</b>\n   Hold: ${t.amount.toLocaleString()} | <code>${t.mint.slice(0,4)}...${t.mint.slice(-4)}</code>`;
        }));
        tokenListText = tokenTexts.join('\n');
      }
    } catch (e) {}
  }

  const msg = `📊 <b>Portfolio & Isikan Saldo Kamu</b>\n\n` +
              `💵 <b>Saldo SOL:</b> <b>${solBal} SOL</b>\n\n` +
              `🪙 <b>Koleksi Token:</b>\n${tokenListText}`;

  const inlineKeyboard = {
    inline_keyboard: [
      [
        { text: '🔄 Refresh Saldo', callback_data: 'REFRESH_BALANCE' },
        { text: '👈 Kembali ke Menu', callback_data: 'MAIN_MENU' }
      ]
    ]
  };

  await sendTelegram(msg, inlineKeyboard);
}

async function showTargets() {
  let list = `🎯 <b>Daftar Target Wallet (${TARGET_WALLETS.length})</b>\n\n`;
  TARGET_WALLETS.forEach((w, i) => {
    list += `${i+1}. <code>${w}</code>\n`;
  });
  list += `\n<i>Mau tambah target? Tinggal ketik:</i>\n<code>/addwallet alamat_walletnya</code>`;

  const inlineKeyboard = {
    inline_keyboard: [
      [{ text: '👈 Kembali ke Menu', callback_data: 'MAIN_MENU' }]
    ]
  };

  await sendTelegram(list, inlineKeyboard);
}

async function executeBuyOrder(targetTokenMint, targetWallet) {
  const modeText = DRY_RUN ? '🧪 SIMULASI' : '🚨 REAL BUY';
  
  const msg = `🔥 <b>ADA SIGNAL BARU NIHBRO!</b> [${modeText}]\n\n` +
              `• <b>Dari Wallet:</b> <code>${targetWallet}</code>\n` +
              `• <b>Beli Token (CA):</b> <code>${targetTokenMint}</code>\n` +
              `• <b>Nominal:</b> ${BUY_AMOUNT_SOL} SOL`;

  const inlineKeyboard = {
    inline_keyboard: [
      [
        { text: '📈 DexScreener', url: `https://dexscreener.com/solana/${targetTokenMint}` },
        { text: '🔍 Solscan', url: `https://solscan.io/token/${targetTokenMint}` }
      ]
    ]
  };

  await sendTelegram(msg, inlineKeyboard);

  if (DRY_RUN || !userKeypair) return;

  try {
    const amountInLamports = Math.floor(BUY_AMOUNT_SOL * 1e9);
    const inputMint = 'So11111111111111111111111111111111111111112';

    const quoteResponse = await (
      await fetch(`https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${targetTokenMint}&amount=${amountInLamports}&slippageBps=1000`)
    ).json();

    if (quoteResponse.error) throw new Error(`Quote Gagal: ${quoteResponse.error}`);

    const swapResponse = await (
      await fetch('https://quote-api.jup.ag/v6/swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteResponse,
          userPublicKey: userKeypair.publicKey.toBase58(),
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: 'auto'
        })
      })
    ).json();

    const swapTransactionBuf = Buffer.from(swapResponse.swapTransaction, 'base64');
    const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
    transaction.sign([userKeypair]);

    const txid = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: true,
      maxRetries: 2
    });

    const successMsg = `🎉 <b>BERHASIL DIBELI BRO!</b>\n\nCek di Solscan: <a href="https://solscan.io/tx/${txid}">Klik di sini</a>`;
    await sendTelegram(successMsg);
  } catch (err) {
    const errorMsg = `❌ <b>Gagal Beli Bro:</b> ${err.message}`;
    await sendTelegram(errorMsg);
  }
}

console.log('🚀 ANUBIS PRO CASUAL TERMINAL RUNNING');
pollTelegramUpdates();

TARGET_WALLETS.forEach((walletAddress) => {
  try {
    const pubKey = new PublicKey(walletAddress);
    connection.onAccountChange(
      pubKey,
      async (accountInfo, context) => {
        console.log(`\n🔔 [SIGNAL DETECTED] Wallet: ${walletAddress}`);
        await executeBuyOrder('hgin2YeSuc6JXDwiTKGxZaw1xkDHKicUAHPV3u9pump', walletAddress);
      },
      'confirmed'
    );
  } catch (err) {}
});
