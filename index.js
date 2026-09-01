require('dotenv').config();

const config = require('./src/core/config');
const db = require('./src/core/db');
const telegram = require('./src/core/telegram');
const { registerUIHandlers } = require('./src/ui/telegramUI');
const copyTradeEngine = require('./src/engines/copytradeEngine');
const autoSellEngine = require('./src/engines/autosellEngine');
const sniperEngine = require('./src/engines/sniperEngine');

async function main() {
  console.log('====================================================');
  console.log(`  ${config.bot.name.toUpperCase()}`);
  console.log(`  Mode: ${config.bot.dryRun ? 'SIMULASI (Paper Trade)' : 'REAL TRADE'}`);
  console.log('====================================================\n');

  const warnings = [];
  if (!config.telegram.token) warnings.push('TELEGRAM_BOT_TOKEN belum diisi');
  if (!config.telegram.chatId) warnings.push('TELEGRAM_CHAT_ID belum diisi');
  if (!config.solana.privateKey && config.solana.enabled) warnings.push('SOLANA_PRIVATE_KEY belum diisi (dry run only)');

  if (warnings.length > 0) {
    console.warn('⚠️ Warnings:');
    warnings.forEach(w => console.warn(`   - ${w}`));
    console.log('');
  }

  registerUIHandlers();
  await telegram.startPolling();

  copyTradeEngine.start();
  autoSellEngine.start();
  sniperEngine.start();

  console.log('\n✅ ALL ENGINES RUNNING!\n');

  const startMsg =
    `🚀 <b>ANUBIS TERMINAL v2.0 STARTED!</b>\n\n` +
    `• <b>Mode:</b> ${config.bot.dryRun ? '🧪 Simulasi' : '🔴 Real Trade'}\n` +
    `• <b>Chains:</b> ${require('./src/chains').getEnabledChainNames().map(c => c.toUpperCase()).join(', ') || 'None'}\n` +
    `• <b>Engines:</b> CopyTrade, AutoSell, Sniper\n\n` +
    `Ketik /start atau /help untuk mulai.`;

  await telegram.send(startMsg);
}

function gracefulShutdown(signal) {
  console.log(`\n🛑 ${signal} received. Shutting down...`);
  autoSellEngine.stop();
  db.flush();
  console.log('💾 Data saved. Goodbye!');
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err.message);
  db.flush();
});
process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled Rejection:', reason);
});

main().catch(err => {
  console.error('❌ Startup Failed:', err);
  process.exit(1);
});
