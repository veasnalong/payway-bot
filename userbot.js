/**
 * userbot.js — GramJS userbot forwarder
 */

const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const { Api } = require('telegram');

const API_ID    = Number(process.env.TELEGRAM_API_ID);
const API_HASH  = process.env.TELEGRAM_API_HASH;
const SESSION   = process.env.TELEGRAM_SESSION || '';
const SOURCE_ID = process.env.SOURCE_GROUP_ID;  // keep as string
const TARGET_ID = process.env.TARGET_GROUP_ID;  // keep as string
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
    console.error('❌ TELEGRAM_SESSION not set. Run `node generate_session.js` locally.');
    return;
  }

  const client = new TelegramClient(new StringSession(SESSION), API_ID, API_HASH, {
    connectionRetries: 5,
  });

  await client.start({ botAuthToken: undefined });
  const me = await client.getMe();
  console.log(`👤 Userbot connected as: @${me.username || me.firstName}`);

  // ── Fetch all dialogs to populate entity cache ─────────────────────────────
  console.log('📋 Loading dialogs to resolve groups...');
  await client.getDialogs({ limit: 100 });

  // ── Resolve source and target by trying multiple formats ───────────────────
  async function resolveEntity(idStr) {
    const attempts = [
      idStr,                                    // as-is: "-1001234567890"
      Number(idStr),                            // as number
      Math.abs(Number(idStr)),                  // positive: 1234567890
      Number(idStr.replace('-100', '-')),       // strip -100 prefix
    ];
    for (const attempt of attempts) {
      try {
        const entity = await client.getEntity(attempt);
        console.log(`✅ Resolved ${idStr} → ${entity.title || entity.username || attempt}`);
        return entity;
      } catch (e) {
        // try next
      }
    }
    throw new Error(`Could not resolve group ID: ${idStr}. Make sure your account is a member.`);
  }

  let sourceEntity, targetEntity;
  try {
    sourceEntity = await resolveEntity(SOURCE_ID);
  } catch (e) {
    console.error('❌ Source group:', e.message);
    return;
  }
  try {
    targetEntity = await resolveEntity(TARGET_ID);
  } catch (e) {
    console.error('❌ Target group:', e.message);
    return;
  }

  // ── Listen for ABA messages ────────────────────────────────────────────────
  client.addEventHandler(async (event) => {
    const msg = event.message;
    if (!msg) return;

    try {
      const text = msg.text || msg.message || '';
      if (!text) return;

      const sender = await msg.getSender().catch(() => null);
      const senderUsername = (sender?.username || '').toLowerCase();
      if (senderUsername !== ABA_BOT.toLowerCase()) return;

      console.log(`👀 Userbot saw ABA: ${text.slice(0, 80)}`);

      // Send message using target group's string ID directly
      await client.sendMessage(TARGET_ID, {
        message: text,
        silent: true,
      });

      console.log(`📤 Forwarded to target group`);
    } catch (e) {
      console.error('❌ Userbot forward error:', e.message);
    }
  }, new NewMessage({ chats: [sourceEntity.id] }));

  console.log(`👂 Listening for @${ABA_BOT} in: ${sourceEntity.title || SOURCE_ID}`);
  console.log(`📨 Forwarding to: ${targetEntity.title || TARGET_ID}`);
}

module.exports = { startUserbot };
