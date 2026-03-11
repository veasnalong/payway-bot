/**
 * generate_session.js
 * Run this ONCE locally to generate your Telegram session string.
 * Then copy the output into TELEGRAM_SESSION env var on Railway.
 *
 * Usage:
 *   node generate_session.js
 */

const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const input = require('input');

const API_ID   = Number(process.env.TELEGRAM_API_ID);
const API_HASH = process.env.TELEGRAM_API_HASH;

if (!API_ID || !API_HASH) {
  console.error('❌ Set TELEGRAM_API_ID and TELEGRAM_API_HASH before running.');
  console.error('   Get them from https://my.telegram.org/apps');
  process.exit(1);
}

(async () => {
  const session = new StringSession('');
  const client = new TelegramClient(session, API_ID, API_HASH, { connectionRetries: 3 });

  await client.start({
    phoneNumber: async () => await input.text('📱 Your phone number (with country code, e.g. +855...): '),
    password:    async () => await input.text('🔑 2FA password (leave blank if none): '),
    phoneCode:   async () => await input.text('📨 Telegram code sent to your phone: '),
    onError:     (err) => console.error(err),
  });

  const sessionString = client.session.save();
  console.log('\n✅ Session generated successfully!\n');
  console.log('Copy this into Railway as TELEGRAM_SESSION:');
  console.log('─'.repeat(60));
  console.log(sessionString);
  console.log('─'.repeat(60));

  await client.disconnect();
  process.exit(0);
})();
