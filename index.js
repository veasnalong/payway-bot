require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const { parseABAMessage, formatSummary, formatDetailedList } = require('./parser');
const store = require('./store');

const TOKEN = process.env.BOT_TOKEN;
const ALLOWED_GROUP_ID = process.env.GROUP_ID ? Number(process.env.GROUP_ID) : null;
const DAILY_REPORT_TIME = process.env.DAILY_REPORT_TIME || '18:00'; // 24h format HH:MM
const TIMEZONE = process.env.TIMEZONE || 'Asia/Phnom_Penh';

if (!TOKEN) {
  console.error('❌ BOT_TOKEN is not set in .env');
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

console.log('🤖 ABA Payway Summary Bot is running...');

// ─── Listen to all messages in groups ─────────────────────────────────────────
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const chatType = msg.chat.type;

  // Only process group/supergroup messages
  if (chatType !== 'group' && chatType !== 'supergroup') return;

  // Optional: restrict to a specific group
  if (ALLOWED_GROUP_ID && chatId !== ALLOWED_GROUP_ID) return;

  const text = msg.text || msg.caption || '';
  const fromBot = msg.from?.is_bot;

  // Try to parse ABA Payway message (from bot or forwarded)
  const transaction = parseABAMessage(text, msg);

  if (transaction) {
    store.addTransaction(chatId, transaction);
    console.log(`✅ Captured transaction: ${transaction.amount} ${transaction.currency} from ${transaction.payer}`);
  }
});

// ─── Commands ──────────────────────────────────────────────────────────────────

// /summary — today's summary
bot.onText(/\/summary(@\w+)?$/, (msg) => {
  const chatId = msg.chat.id;
  const today = getTodayKey();
  const transactions = store.getTransactions(chatId, today);
  const reply = formatSummary(transactions, 'Today', today);
  bot.sendMessage(chatId, reply, { parse_mode: 'HTML' });
});

// /summary_week — this week
bot.onText(/\/summary_week(@\w+)?$/, (msg) => {
  const chatId = msg.chat.id;
  const days = getLastNDays(7);
  const transactions = days.flatMap(d => store.getTransactions(chatId, d));
  const reply = formatSummary(transactions, 'Last 7 Days', days[0] + ' → ' + days[days.length - 1]);
  bot.sendMessage(chatId, reply, { parse_mode: 'HTML' });
});

// /summary_month — this month
bot.onText(/\/summary_month(@\w+)?$/, (msg) => {
  const chatId = msg.chat.id;
  const days = getThisMonthDays();
  const transactions = days.flatMap(d => store.getTransactions(chatId, d));
  const label = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: TIMEZONE });
  const reply = formatSummary(transactions, label, '');
  bot.sendMessage(chatId, reply, { parse_mode: 'HTML' });
});

// /list — detailed list of today's transactions
bot.onText(/\/list(@\w+)?$/, (msg) => {
  const chatId = msg.chat.id;
  const today = getTodayKey();
  const transactions = store.getTransactions(chatId, today);
  const reply = formatDetailedList(transactions, 'Today');
  bot.sendMessage(chatId, reply, { parse_mode: 'HTML' });
});

// /list YYYY-MM-DD — list for a specific date
bot.onText(/\/list(@\w+)?\s+(\d{4}-\d{2}-\d{2})/, (msg, match) => {
  const chatId = msg.chat.id;
  const date = match[2];
  const transactions = store.getTransactions(chatId, date);
  const reply = formatDetailedList(transactions, date);
  bot.sendMessage(chatId, reply, { parse_mode: 'HTML' });
});

// /clear — clear today's data (admin only)
bot.onText(/\/clear(@\w+)?$/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  try {
    const admins = await bot.getChatAdministrators(chatId);
    const isAdmin = admins.some(a => a.user.id === userId);
    if (!isAdmin) {
      return bot.sendMessage(chatId, '⛔ Only group admins can clear data.');
    }
    const today = getTodayKey();
    store.clearTransactions(chatId, today);
    bot.sendMessage(chatId, `🗑️ Today's transactions cleared.`);
  } catch (e) {
    bot.sendMessage(chatId, '⚠️ Could not verify admin status.');
  }
});

// /help
bot.onText(/\/help(@\w+)?$/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, `
<b>📊 ABA Payway Summary Bot</b>

<b>Commands:</b>
/summary — Today's payment summary
/summary_week — Last 7 days summary
/summary_month — This month's summary
/list — Today's transaction list
/list YYYY-MM-DD — List for specific date
/clear — Clear today's data (admin only)
/help — Show this help

<b>How it works:</b>
The bot automatically reads ABA Payway payment notifications in this group and builds a running summary. Just run <code>/summary</code> anytime to see totals.
  `, { parse_mode: 'HTML' });
});

// ─── Scheduled Daily Report ────────────────────────────────────────────────────
const [schedHour, schedMin] = DAILY_REPORT_TIME.split(':');
const cronExpr = `${schedMin} ${schedHour} * * *`;

cron.schedule(cronExpr, () => {
  const today = getTodayKey();
  const allChats = store.getAllChatIds();
  allChats.forEach(chatId => {
    const transactions = store.getTransactions(chatId, today);
    if (transactions.length === 0) return;
    const report = formatSummary(transactions, '📅 Daily Report', today);
    bot.sendMessage(chatId, report, { parse_mode: 'HTML' }).catch(console.error);
  });
  console.log(`📤 Sent daily reports to ${allChats.length} group(s)`);
}, { timezone: TIMEZONE });

console.log(`⏰ Daily report scheduled at ${DAILY_REPORT_TIME} (${TIMEZONE})`);

// ─── Helpers ───────────────────────────────────────────────────────────────────
function getTodayKey() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE }); // YYYY-MM-DD
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
  const year = now.getFullYear();
  const month = now.getMonth();
  const days = [];
  for (let d = 1; d <= now.getDate(); d++) {
    const date = new Date(year, month, d);
    days.push(date.toLocaleDateString('en-CA', { timeZone: TIMEZONE }));
  }
  return days;
}
