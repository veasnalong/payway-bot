/**
 * userbot.js — GramJS userbot forwarder
 * Runs as your real Telegram account, reads @PayWayByABA_bot messages,
 * forwards them to TARGET_GROUP_ID where your bot captures them.
 */

const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const { Api } = require('telegram');

const API_ID    = Number(process.env.TELEGRAM_API_ID);
const API_HASH  = process.env.TELEGRAM_API_HASH;
const SESSION   = process.env.TELEGRAM_SESSION || '';
const SOURCE_ID = Number(process.env.SOURCE_GROUP_ID);
const TARGET_ID = Number(process.env.TARGET_GROUP_ID);
const ABA_BOT   = 'PayWayByABA_bot';

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
  const me = await client.getMe();
  console.log(`👤 Userbot connected as: @${me.username || me.firstName}`);

  // ── Resolve source and target entities properly ──────────────────────────────
  let sourceEntity, targetEntity;
  try {
    sourceEntity = await client.getEntity(SOURCE_ID);
    console.log(`✅ Source group resolved: ${sourceEntity.title || SOURCE_ID}`);
  } catch (e) {
    // Try with -100 prefix for supergroups
    try {
      sourceEntity = await client.getEntity(Number(`-100${Math.abs(SOURCE_ID)}`));
      console.log(`✅ Source group resolved: ${sourceEntity.title || SOURCE_ID}`);
    } catch (e2) {
      console.error('❌ Could not resolve SOURCE_GROUP_ID:', e2.message);
      console.error('   Make sure your Telegram account is a member of the source group');
      return;
    }
  }

  try {
    targetEntity = await client.getEntity(TARGET_ID);
    console.log(`✅ Target group resolved: ${targetEntity.title || TARGET_ID}`);
  } catch (e) {
    try {
      targetEntity = await client.getEntity(Number(`-100${Math.abs(TARGET_ID)}`));
      console.log(`✅ Target group resolved: ${targetEntity.title || TARGET_ID}`);
    } catch (e2) {
      console.error('❌ Could not resolve TARGET_GROUP_ID:', e2.message);
      console.error('   Make sure your Telegram account is a member of the target group');
      return;
    }
  }

  // ── Listen for ABA messages in source group ──────────────────────────────────
  client.addEventHandler(async (event) => {
    const msg = event.message;
    if (!msg) return;

    try {
      const text = msg.text || msg.message || '';
      if (!text) return;

      // Check sender is ABA bot
      const sender = await msg.getSender().catch(() => null);
      const senderUsername = (sender?.username || '').toLowerCase();
      if (senderUsername !== ABA_BOT.toLowerCase()) return;

      console.log(`👀 Userbot saw ABA: ${text.slice(0, 80)}`);

      // Forward using resolved entities
      await client.invoke(new Api.messages.ForwardMessages({
        fromPeer: sourceEntity,
        id: [msg.id],
        toPeer: targetEntity,
        randomId: [BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER))],
        silent: true,  // no notification
      }));

      console.log(`📤 Forwarded to target group`);
    } catch (e) {
      console.error('❌ Userbot forward error:', e.message);
    }
  }, new NewMessage({ chats: [sourceEntity] }));

  console.log(`👂 Userbot listening for @${ABA_BOT} in: ${sourceEntity.title || SOURCE_ID}`);
}

module.exports = { startUserbot };
