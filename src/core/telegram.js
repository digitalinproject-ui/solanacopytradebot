const config = require('./config');
const fetch = require('cross-fetch');

const defaultKeyboard = {
  keyboard: [
    [{ text: '💳 Portfolio' }, { text: '🎯 Target List' }],
    [{ text: '⚡ Quick Buy' }, { text: '📈 Auto-Sell Status' }],
    [{ text: '📊 PnL Stats' }, { text: '⚙️ Status & Menu' }]
  ],
  resize_keyboard: true,
  persistent: true
};

class TelegramBot {
  constructor() {
    this.token = config.telegram.token;
    this.chatId = String(config.telegram.chatId);
    this.lastUpdateId = 0;
    this.commandHandlers = [];
    this.callbackHandlers = [];
  }

  async send(text, replyMarkup = defaultKeyboard) {
    if (!this.token || !this.chatId) return;
    try {
      const body = {
        chat_id: this.chatId,
        text: text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: replyMarkup
      };
      const res = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!data.ok) {
        console.error('⚠️ Telegram API Error:', data.description);
      }
      return data;
    } catch (err) {
      console.error('❌ Telegram Send Error:', err.message);
    }
  }

  async editMessage(chatId, messageId, text, replyMarkup) {
    if (!this.token) return;
    try {
      const body = {
        chat_id: chatId || this.chatId,
        message_id: messageId,
        text: text,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      };
      if (replyMarkup) body.reply_markup = replyMarkup;
      await fetch(`https://api.telegram.org/bot${this.token}/editMessageText`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    } catch (err) {}
  }

  async answerCallback(callbackQueryId, text = '') {
    if (!this.token) return;
    try {
      await fetch(`https://api.telegram.org/bot${this.token}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: callbackQueryId, text })
      });
    } catch (err) {}
  }

  async deleteWebhook() {
    if (!this.token) return;
    try {
      await fetch(`https://api.telegram.org/bot${this.token}/deleteWebhook`);
    } catch (err) {}
  }

  onCommand(pattern, handler) {
    this.commandHandlers.push({ pattern, handler });
  }

  onCallback(pattern, handler) {
    this.callbackHandlers.push({ pattern, handler });
  }

  async startPolling() {
    if (!this.token) {
      console.warn('⚠️ TELEGRAM_BOT_TOKEN belum diisi! Telegram UI tidak aktif.');
      return;
    }
    await this.deleteWebhook();
    console.log('🤖 Telegram Bot polling started...');
    this._poll();
  }

  async _poll() {
    try {
      const res = await fetch(`https://api.telegram.org/bot${this.token}/getUpdates?offset=${this.lastUpdateId + 1}&timeout=10`);
      const data = await res.json();

      if (data.ok && data.result) {
        for (const update of data.result) {
          this.lastUpdateId = update.update_id;

          let fromId = null;
          if (update.message) fromId = String(update.message.chat.id);
          if (update.callback_query) fromId = String(update.callback_query.message?.chat?.id || update.callback_query.from.id);

          if (this.chatId && fromId !== this.chatId) continue;

          if (update.message && update.message.text) {
            const text = update.message.text.trim();
            for (const h of this.commandHandlers) {
              if (typeof h.pattern === 'string' && text === h.pattern) {
                await h.handler(update.message);
                break;
              } else if (h.pattern instanceof RegExp && h.pattern.test(text)) {
                await h.handler(update.message);
                break;
              }
            }
          }

          if (update.callback_query) {
            const cb = update.callback_query;
            const cbData = cb.data;

            await this.answerCallback(cb.id);

            for (const h of this.callbackHandlers) {
              if (typeof h.pattern === 'string' && cbData === h.pattern) {
                await h.handler(cb);
                break;
              } else if (h.pattern instanceof RegExp && h.pattern.test(cbData)) {
                await h.handler(cb);
                break;
              }
            }
          }
        }
      }
    } catch (err) {
      console.error('⚠️ Telegram Poll Error:', err.message);
    }
    setTimeout(() => this._poll(), 1500);
  }
}

module.exports = new TelegramBot();
