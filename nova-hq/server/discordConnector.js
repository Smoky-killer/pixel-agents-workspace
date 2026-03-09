'use strict';

/**
 * Discord Connector — listens for Discord messages via webhook/bot
 * and routes them to the appropriate zone.
 *
 * When a Discord message arrives:
 *   1. Parse which zone/agent it's addressed to
 *   2. Emit { type: 'discordMessage', zone, agentName, text, from }
 *   3. The agent's character walks to the "Discord desk"
 *   4. Speech bubble shows the message preview
 *
 * This is a lightweight connector — it uses the Discord.js-free approach
 * via Discord webhooks or a simple bot token with minimal REST API calls.
 *
 * For a full implementation, install discord.js:
 *   npm install discord.js
 *
 * This file provides the framework; the actual Discord.js integration
 * is behind a conditional require so the app works without it.
 */

class DiscordConnector {
  constructor({ discordConfig, broadcast }) {
    this.config = discordConfig || {};
    this.broadcast = broadcast;
    this.client = null;
    this.running = false;
  }

  async start() {
    if (!this.config.enabled || !this.config.token) {
      console.log('[Discord] Connector disabled (no token or enabled=false)');
      return;
    }

    try {
      // Try to load discord.js (optional dependency)
      const { Client, GatewayIntentBits } = require('discord.js');
      this.client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent,
        ],
      });

      this.client.on('ready', () => {
        console.log(`[Discord] Logged in as ${this.client.user.tag}`);
        this.broadcast({ type: 'discordStatus', connected: true });
        this.running = true;
      });

      this.client.on('messageCreate', (message) => {
        if (message.author.bot) return;
        this._handleMessage(message);
      });

      this.client.on('error', (err) => {
        console.error('[Discord] Error:', err.message);
      });

      await this.client.login(this.config.token);
    } catch (err) {
      console.log('[Discord] discord.js not installed or login failed:', err.message);
      console.log('[Discord] To enable Discord: npm install discord.js');
    }
  }

  stop() {
    if (this.client) {
      try {
        this.client.destroy();
      } catch {}
      this.running = false;
    }
  }

  _handleMessage(message) {
    const channelId = message.channel.id;
    const channels = this.config.channels || [];

    // Find which zone this channel routes to
    const channelConfig = channels.find(c => c.channelId === channelId);
    if (!channelConfig) return; // Not a monitored channel

    const zoneId = channelConfig.targetZone;
    const targetAgent = channelConfig.targetAgent || null;
    const username = message.author.username;
    const text = message.content.slice(0, 100); // Truncate

    console.log(`[Discord] #${message.channel.name} -> Zone:${zoneId} Agent:${targetAgent || 'commander'}: "${text}"`);

    this.broadcast({
      type: 'discordMessage',
      zoneId,
      agentName: targetAgent,
      text,
      from: username,
      channelName: message.channel.name,
      timestamp: Date.now(),
    });

    // Also emit as an agentMessage so it shows in the HUD
    this.broadcast({
      type: 'agentMessage',
      fromId: -999, // Special "Discord" ID
      fromName: `Discord:${username}`,
      toId: null,
      toName: targetAgent,
      text: text.length > 50 ? text.slice(0, 49) + '...' : text,
      msgType: 'instruction',
      zoneId,
    });
  }
}

module.exports = { DiscordConnector };
