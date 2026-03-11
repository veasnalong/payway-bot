/**
 * userbot.js — GramJS userbot forwarder
 * Runs as your real Telegram account, reads @PayWayByABA_bot messages,
 * forwards them to TARGET_GROUP_ID where your bot captures them.
 */

const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');

const API_ID    = Number(process.env.TELEGRAM_API_ID);
const API_HASH  = process.env.TELEGRAM_API_HASH;
const SESSION   = process.env.TELEGRAM_SESSION || '';
const SOURCE_ID = Number(process.env.SOURCE_GROUP_ID); // ABA Payway group
const TARGET_ID = Number(process.env.TARGET_GROUP_ID); // Private capture group

const ABA_BOT_USERNAME = 'PayWayByABA_bot';

async function startUserbot() {
  if (!API_ID || !API_HASH) {
    console.log('⚠️  TELEGRAM_API_ID/HASH not set — userbot disabled');
    return;
  }
  if (!SOURCE_ID || !TARGET_ID) {
    console.log('⚠️  SOURCE_GROUP_ID/TARGET_GROUP_ID not set — userbot disabled');
    return;
  }
  if (!SESSION) {
    console.error('❌ TELEGRAM_SESSION not set. Run `node generate_session.js` locally to get it.');
    return;
  }

  const client = new TelegramClient(new StringSession(SESSION), API_ID, API_HASH, {
    connectionRetries: 5,
  });

  await client.start({ botAuthToken: undefined });
  console.log('👤 Userbot connected as:', (await client.getMe()).username);

  // Listen for new messages in the source group
  client.addEventHandler(async (event) => {
    const msg = event.message;
    if (!msg) return;

    try {
      const chatId = msg.peerId?.channelId || msg.peerId?.chatId || msg.peerId?.userId;
      const text = msg.text || msg.message || '';

      // Only from ABA Payway bot
      const sender = await msg.getSender().catch(() => null);
      const senderUsername = sender?.username || '';
      if (senderUsername.toLowerCase() !== ABA_BOT_USERNAME.toLowerCase()) return;

      console.log(`👀 Userbot saw ABA message: ${text.slice(0, 80)}`);

      // Forward to target group
      await client.forwardMessages(TARGET_ID, {
        messages: [msg.id],
        fromPeer: SOURCE_ID,
      });
      console.log(`📤 Forwarded to target group`);
    } catch (e) {
      console.error('❌ Userbot forward error:', e.message);
    }
  }, new NewMessage({ chats: [SOURCE_ID] }));

  console.log(`👂 Userbot listening in group ${SOURCE_ID} for @${ABA_BOT_USERNAME}`);
}

module.exports = { startUserbot };
