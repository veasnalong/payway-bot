require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const { parseABAMessage, formatSummary, formatDetailedList } = require('./parser');
const store = require('./store');
const cashReport = require('./cash_report');
const { startUserbot } = require('./userbot');

const TOKEN = process.env.BOT_TOKEN;
const ALLOWED_GROUP_ID = process.env.GROUP_ID ? Number(process.env.GROUP_ID) : null;
const SOURCE_GROUP_ID = process.env.SOURCE_GROUP_ID ? Number(process.env.SOURCE_GROUP_ID) : null; // ABA Payway group
const TARGET_GROUP_ID = process.env.TARGET_GROUP_ID ? Number(process.env.TARGET_GROUP_ID) : null; // Your bot group
const DAILY_REPORT_TIME = process.env.DAILY_REPORT_TIME || '18:00';
// All data stored under SOURCE_GROUP_ID so commands in source group see everything
const STORE_CHAT_ID = SOURCE_GROUP_ID || TARGET_GROUP_ID;
const TIMEZONE = process.env.TIMEZONE || 'Asia/Phnom_Penh';

// ── Validate env vars ──────────────────────────────────────────────────────────
const missing = [];
if (!TOKEN) missing.push('BOT_TOKEN');
if (!process.env.SUPABASE_URL) missing.push('SUPABASE_URL');
if (!process.env.SUPABASE_KEY) missing.push('SUPABASE_KEY');
if (!process.env.ANTHROPIC_API_KEY) console.log('⚠️  ANTHROPIC_API_KEY not set — cash report photo feature disabled');
if (missing.length > 0) {
  console.error('❌ Missing env vars:', missing.join(', '));
  process.exit(1);
}
console.log('✅ Environment OK');
console.log(`📦 STORE_CHAT_ID: ${STORE_CHAT_ID} | SOURCE: ${SOURCE_GROUP_ID} | TARGET: ${TARGET_GROUP_ID}`);

// ── Bot init ───────────────────────────────────────────────────────────────────
const bot = new TelegramBot(TOKEN, { polling: false });
bot.deleteWebHook()
  .then(() => {
    console.log('🔓 Webhook cleared, starting polling...');
    bot.startPolling();
    bot.on('polling_error', (err) => {
      if (err && err.message) console.error('❌ polling error:', err.message);
    });
    bot.getMe().then(me => console.log(`🤖 Bot: @${me.username} (id: ${me.id})`));
    startUserbot().catch(e => console.error('❌ Userbot failed to start:', e.message));
  })
  .catch(err => {
    console.error('⚠️ Could not clear webhook:', err.message);
    bot.startPolling();
  });

console.log('🤖 Mini Coffee Bot is running...');
console.log(`⏰ Daily report at ${DAILY_REPORT_TIME} (${TIMEZONE})`);

// ── Helper: send long message in chunks ───────────────────────────────────────
async function sendLong(chatId, text, options = {}) {
  const LIMIT = 4000;
  if (text.length <= LIMIT) return bot.sendMessage(chatId, text, options);
  const lines = text.split('\n');
  let chunk = '';
  for (const line of lines) {
    if ((chunk + '\n' + line).length > LIMIT) {
      await bot.sendMessage(chatId, chunk, options);
      chunk = line;
    } else {
      chunk = chunk ? chunk + '\n' + line : line;
    }
  }
  if (chunk) await bot.sendMessage(chatId, chunk, options);
}

// ── Date helpers ───────────────────────────────────────────────────────────────
function getTodayKey() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE });
}
function getLastNDays(n) {
  const days = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toLocaleDateString('en-CA', { timeZone: TIMEZONE }));
  }
  return days;
}
function getThisMonthDays() {
  const now = new Date();
  const days = [];
  for (let d = 1; d <= now.getDate(); d++) {
    const date = new Date(now.getFullYear(), now.getMonth(), d);
    days.push(date.toLocaleDateString('en-CA', { timeZone: TIMEZONE }));
  }
  return days;
}

// ── Cash Payment Listener ──────────────────────────────────────────────────────
// Barista types: cash 6000 / cash ៛6000 / cash $2.50 / cash 2.50$
function parseCashMessage(text, msg) {
  if (!text) return null;
  const lower = text.trim().toLowerCase();
  if (!lower.startsWith('cash')) return null;

  // Match: cash ៛6,000 | cash 6000 | cash $2.50
  const hasDollar = text.includes('$');
  const usdMatch = hasDollar && text.match(/cash\s*\$\s*([\d,]+(?:\.\d{1,2})?)/i);
  const khrMatch = !hasDollar && text.match(/cash\s*[៛]?\s*([\d,]+)/i);

  // Prefer USD if $ symbol present
  if (hasDollar && usdMatch) {
    const amount = parseFloat(usdMatch[1].replace(/,/g, ''));
    if (isNaN(amount) || amount <= 0) return null;
    return {
      amount, currency: 'USD',
      payer: msg.from?.first_name || msg.from?.username || 'Barista',
      cardMask: '', merchant: 'Mini Cafe HLA57',
      payMethod: 'CASH', trxId: `CASH-${msg.message_id}`, apv: '',
      dateTimeStr: new Date().toLocaleString('en-US', {
        month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: TIMEZONE
      }),
      timestamp: new Date().toLocaleString('en-CA', { timeZone: TIMEZONE }) + 'T00:00:00',
      timeStr: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: TIMEZONE }),
      messageId: msg.message_id,
    };
  }

  if (!hasDollar && khrMatch) {
    const amount = parseFloat(khrMatch[1].replace(/,/g, ''));
    if (isNaN(amount) || amount <= 0) return null;
    return {
      amount, currency: 'KHR',
      payer: msg.from?.first_name || msg.from?.username || 'Barista',
      cardMask: '', merchant: 'Mini Cafe HLA57',
      payMethod: 'CASH', trxId: `CASH-${msg.message_id}`, apv: '',
      dateTimeStr: new Date().toLocaleString('en-US', {
        month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: TIMEZONE
      }),
      timestamp: new Date().toLocaleString('en-CA', { timeZone: TIMEZONE }) + 'T00:00:00',
      timeStr: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: TIMEZONE }),
      messageId: msg.message_id,
    };
  }

  return null;
}

// ── ABA Payway message listener ────────────────────────────────────────────────
async function handleMsg(msg) {
  const chatId = msg.chat.id;
  const chatType = msg.chat.type;

  // Log ALL incoming messages regardless of group — helps diagnose which chat_id to use
  const text = msg.text || msg.caption || '';
  const fromName = msg.sender_chat?.title || msg.sender_chat?.username
    || msg.from?.username || msg.from?.first_name || String(msg.from?.id || 'unknown');
  const tag = (msg.from?.is_bot ? '[BOT]' : '') + (msg.sender_chat ? '[CHAN]' : '');
  console.log(`📨 chat=${chatId} [${chatType}]${tag} ${fromName}: ${(text || '[no text]').slice(0, 100)}`);

  if (!['group', 'supergroup', 'channel'].includes(chatType)) return;
  // NOTE: GROUP_ID filter disabled — bot captures from ALL groups it's in
  // Set GROUP_ID in env to restrict to one group once confirmed working

  if (!text) return;

  const transaction = parseABAMessage(text, msg);
  if (transaction) {
    const saveChatId = STORE_CHAT_ID || chatId;
    store.addTransaction(saveChatId, transaction);
    console.log(`✅ Captured: ${transaction.payer} ${transaction.amount} ${transaction.currency} → saved to chat=${saveChatId}`);
  } else if (text.includes('paid by') || text.includes('ABA') || text.includes('KHR')) {
    console.log(`⚠️  ABA-like but not parsed — chat=${chatId}: ${text.slice(0, 150)}`);
  }

  // Check for cash payment entry by barista
  const cashTxn = parseCashMessage(text, msg);
  if (cashTxn) {
    await store.addTransaction(STORE_CHAT_ID || chatId, cashTxn);
    const symbol = cashTxn.currency === 'KHR' ? '៛' : '$';
    const amt = cashTxn.currency === 'KHR'
      ? cashTxn.amount.toLocaleString('en-US', { maximumFractionDigits: 0 })
      : cashTxn.amount.toFixed(2);
    console.log(`💵 Cash captured: ${symbol}${amt} by ${cashTxn.payer}`);
    bot.sendMessage(chatId, `✅ Cash recorded: <b>${symbol}${amt}</b> by ${cashTxn.payer}`, { parse_mode: 'HTML' });
  }
}

bot.on('message', handleMsg);
bot.on('channel_post', handleMsg);
bot.on('edited_message', handleMsg);
bot.on('edited_channel_post', handleMsg);

// ── Photo → Cash Report ────────────────────────────────────────────────────────
bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  const chatType = msg.chat.type;
  if (!['group', 'supergroup'].includes(chatType)) return;

  const caption = (msg.caption || '').toLowerCase();
  // Process if caption has report keywords OR no caption at all
  if (caption && !caption.includes('report') && !caption.includes('cash') && !caption.includes('daily')) return;

  if (!process.env.ANTHROPIC_API_KEY) {
    return bot.sendMessage(chatId, '⚠️ Cash report photo feature is disabled. Set ANTHROPIC_API_KEY to enable it.');
  }
  const processingMsg = await bot.sendMessage(chatId, '📸 Reading cash report sheet... please wait.');
  try {
    const photo = msg.photo[msg.photo.length - 1];
    const base64 = await cashReport.downloadPhotoBase64(bot, photo.file_id);
    console.log('📸 Photo downloaded, calling Claude Vision...');

    const data = await cashReport.extractReportFromImage(base64);
    console.log('✅ Extracted data:', JSON.stringify(data).slice(0, 200));

    const result = await cashReport.saveReport(chatId, msg.message_id, data);
    if (result.duplicate) {
      await bot.editMessageText('⚠️ This report was already recorded.', { chat_id: chatId, message_id: processingMsg.message_id });
      return;
    }

    const reports = await cashReport.getReports(chatId, result.dateKey);
    const summary = cashReport.formatReportSummary(reports, data.cashier || 'Report', result.dateKey);
    await bot.editMessageText('✅ Cash report saved!', { chat_id: chatId, message_id: processingMsg.message_id });
    await sendLong(chatId, summary, { parse_mode: 'HTML' });
  } catch (e) {
    console.error('❌ Photo error:', e.message);
    await bot.editMessageText('❌ Could not read report: ' + e.message, { chat_id: chatId, message_id: processingMsg.message_id }).catch(() => {});
  }
});


// ── Auto-Forward: ABA group → Bot group ───────────────────────────────────────
// Sits in SOURCE_GROUP_ID, detects ABA payments, forwards to TARGET_GROUP_ID
async function handleAutoForward(msg) {
  if (!SOURCE_GROUP_ID || !TARGET_GROUP_ID) return;
  if (msg.chat.id !== SOURCE_GROUP_ID) return;

  const text = msg.text || msg.caption || '';
  if (!text) return;

  // Only forward if it looks like an ABA payment
  const isABAPayment = /paid by.+via ABA/i.test(text) || /.Trx. ID:/i.test(text);
  if (!isABAPayment) return;

  try {
    await bot.forwardMessage(TARGET_GROUP_ID, SOURCE_GROUP_ID, msg.message_id);
    console.log(`📤 Auto-forwarded ABA message to target group`);
  } catch (e) {
    console.error('❌ Auto-forward failed:', e.message);
  }
}

bot.on('message', handleAutoForward);
bot.on('channel_post', handleAutoForward);

// ── ABA Commands ───────────────────────────────────────────────────────────────
bot.onText(/\/summary(@\w+)?$/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const transactions = await store.getTransactions(STORE_CHAT_ID || msg.chat.id, getTodayKey());
    await sendLong(chatId, formatSummary(transactions, 'Today', getTodayKey()), { parse_mode: 'HTML' });
  } catch (e) {
    console.error('❌ /summary:', e.message);
    bot.sendMessage(chatId, '⚠️ Error: ' + e.message);
  }
});

bot.onText(/\/summary_week(@\w+)?$/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const days = getLastNDays(7);
    const all = await Promise.all(days.map(d => store.getTransactions(STORE_CHAT_ID || msg.chat.id, d)));
    await sendLong(chatId, formatSummary(all.flat(), 'Last 7 Days', days[0] + ' → ' + days[days.length - 1]), { parse_mode: 'HTML' });
  } catch (e) {
    bot.sendMessage(chatId, '⚠️ Error: ' + e.message);
  }
});

bot.onText(/\/summary_month(@\w+)?$/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const days = getThisMonthDays();
    const all = await Promise.all(days.map(d => store.getTransactions(STORE_CHAT_ID || msg.chat.id, d)));
    const label = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: TIMEZONE });
    await sendLong(chatId, formatSummary(all.flat(), label, ''), { parse_mode: 'HTML' });
  } catch (e) {
    bot.sendMessage(chatId, '⚠️ Error: ' + e.message);
  }
});

bot.onText(/\/list(@\w+)?$/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const transactions = await store.getTransactions(STORE_CHAT_ID || msg.chat.id, getTodayKey());
    await sendLong(chatId, formatDetailedList(transactions, 'Today'), { parse_mode: 'HTML' });
  } catch (e) {
    bot.sendMessage(chatId, '⚠️ Error: ' + e.message);
  }
});

bot.onText(/\/list(@\w+)?\s+(\d{4}-\d{2}-\d{2})/, async (msg, match) => {
  const chatId = msg.chat.id;
  try {
    const transactions = await store.getTransactions(STORE_CHAT_ID || msg.chat.id, match[2]);
    await sendLong(chatId, formatDetailedList(transactions, match[2]), { parse_mode: 'HTML' });
  } catch (e) {
    bot.sendMessage(chatId, '⚠️ Error: ' + e.message);
  }
});

// ── Help ───────────────────────────────────────────────────────────────────────
bot.onText(/\/help(@\w+)?$/, (msg) => {
  sendLong(msg.chat.id, `<b>🤖 Mini Coffee Bot</b>

<b>💳 ABA Payway (auto-captured):</b>
/summary — Today's payment summary
/summary_week — Last 7 days
/summary_month — This month
/list — Today's transaction list
/list YYYY-MM-DD — Specific date

/help — Show this help`, { parse_mode: 'HTML' });
});

// ── Scheduled Daily ABA Summary ────────────────────────────────────────────────
const [schedHour, schedMin] = DAILY_REPORT_TIME.split(':');
cron.schedule(`${schedMin} ${schedHour} * * *`, async () => {
  const today = getTodayKey();
  const chatIds = STORE_CHAT_ID ? [STORE_CHAT_ID] : await store.getAllChatIds();
  for (const chatId of chatIds) {
    try {
      const transactions = await store.getTransactions(chatId, today);
      if (transactions.length === 0) continue;
      await sendLong(chatId, formatSummary(transactions, '📅 Daily Report', today), { parse_mode: 'HTML' });
    } catch (e) {
      console.error(`❌ Scheduled report for ${chatId}:`, e.message);
    }
  }
  console.log(`📤 Daily reports sent to ${chatIds.length} group(s)`);
}, { timezone: TIMEZONE });
