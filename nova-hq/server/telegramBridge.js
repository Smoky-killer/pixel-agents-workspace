'use strict';

class TelegramBridge {
  constructor({ telegramConfig, broadcast }) {
    this.config = telegramConfig || {};
    this.broadcast = broadcast;
    this.bots = new Map();
    this.running = false;
  }

  async start() {
    if (!this.config.enabled) {
      console.log('[Telegram] Bridge disabled in config');
      return;
    }

    let TelegramBot;
    try {
      TelegramBot = require('node-telegram-bot-api');
    } catch {
      console.log('[Telegram] node-telegram-bot-api not installed — skipping. Run: npm install node-telegram-bot-api');
      return;
    }

    const allowedUserId = this.config.allowedUserId;

    for (const botConfig of (this.config.bots || [])) {
      if (!botConfig.token) {
        console.log(`[Telegram:${botConfig.name}] No token configured — skipping`);
        continue;
      }

      try {
        const bot = new TelegramBot(botConfig.token, { polling: true });
        this.bots.set(botConfig.name, bot);

        bot.on('message', (msg) => {
          // Security: only allow messages from the configured user
          if (allowedUserId && msg.from && msg.from.id !== allowedUserId) return;

          const text = (msg.text || '').slice(0, 200);
          if (!text) return;

          const zoneId = botConfig.targetZone;
          const from = msg.from?.first_name || msg.from?.username || 'User';

          console.log(`[Telegram:${botConfig.name}] Message from ${from}: "${text.slice(0, 50)}"`);

          // Broadcast telegramMessage for zone-specific commander animation
          this.broadcast({
            type: 'telegramMessage',
            zoneId,
            botName: botConfig.name,
            text,
            from,
            chatId: msg.chat.id,
            timestamp: Date.now(),
          });

          // Also emit as agentMessage for HUD display
          this.broadcast({
            type: 'agentMessage',
            fromId: -998,
            fromName: `TG:${from}`,
            toId: null,
            toName: null,
            text: text.length > 50 ? text.slice(0, 49) + '...' : text,
            msgType: 'instruction',
            zoneId,
          });
        });

        bot.on('polling_error', (err) => {
          // Only log non-network errors to avoid spam
          if (!err.message?.includes('ETELEGRAM') && !err.message?.includes('EFATAL')) {
            console.error(`[Telegram:${botConfig.name}] Polling error: ${err.message}`);
          }
        });

        console.log(`[Telegram:${botConfig.name}] Bot started for zone ${botConfig.targetZone}`);
      } catch (err) {
        console.error(`[Telegram:${botConfig.name}] Failed to start: ${err.message}`);
      }
    }

    this.running = true;
  }

  stop() {
    for (const [name, bot] of this.bots) {
      try { bot.stopPolling(); } catch {}
      console.log(`[Telegram:${name}] Stopped`);
    }
    this.bots.clear();
    this.running = false;
  }
}

module.exports = { TelegramBridge };
