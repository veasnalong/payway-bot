/**
 * parser.js — Parse ABA Payway Telegram bot messages
 *
 * Format:
 * ៛6,000 paid by MEAS PANHA (*534) on Mar 09, 12:44 PM via ABA PAY at Mini Cafe HLA57. Trx. ID: 177303507915729, APV: 663671
 */

const TIMEZONE = process.env.TIMEZONE || 'Asia/Phnom_Penh';

function parseABAMessage(text, msg) {
  if (!text) return null;

  const masterPattern = /^([៛$])\s*([\d,]+(?:\.\d+)?)\s+paid by\s+(.+?)\s+\((\*\d+)\)\s+on\s+(.+?)\s+via\s+(ABA KHQR(?:\s*\(.+?\))*|ABA PAY|ABA)\s+at\s+(.+?)\.\s+Trx\.\s*ID:\s*(\d+),\s*APV:\s*(\d+)/i;

  const m = text.match(masterPattern);
  if (!m) return null;

  const [, currencySymbol, amountRaw, payerName, cardMask, dateTimeStr, payMethod, merchant, trxId, apv] = m;

  const currency = currencySymbol === '៛' ? 'KHR' : 'USD';
  const amount = parseFloat(amountRaw.replace(/,/g, ''));
  if (!amount || isNaN(amount)) return null;

  const year = new Date().getFullYear();
  const parsedDate = new Date(`${dateTimeStr} ${year}`);
  const timestamp = isNaN(parsedDate)
    ? (msg.date ? new Date(msg.date * 1000).toISOString() : new Date().toISOString())
    : parsedDate.toISOString();

  const timeStr = new Date(msg.date ? msg.date * 1000 : Date.now())
    .toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: TIMEZONE });

  return {
    amount, currency,
    payer: payerName.trim(),
    cardMask, merchant: merchant.trim(),
    payMethod, trxId, apv,
    dateTimeStr: dateTimeStr.trim(),
    timestamp, timeStr,
    messageId: msg.message_id,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtAmount(amount, currency) {
  const symbol = currency === 'KHR' ? '៛' : '$';
  const num = currency === 'KHR'
    ? amount.toLocaleString('en-US', { maximumFractionDigits: 0 })
    : amount.toFixed(2);
  return `${symbol}${num}`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function divider(char = '─', len = 28) {
  return char.repeat(len);
}

// ── Summary ────────────────────────────────────────────────────────────────────

function formatSummary(transactions, label, period) {
  const now = new Date().toLocaleString('en-US', {
    timeZone: TIMEZONE, month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: true
  });

  if (transactions.length === 0) {
    return [
      `╔═══════════════════════════╗`,
      `║   📊  ${label.padEnd(21)}║`,
      `╚═══════════════════════════╝`,
      ``,
      `  <i>No transactions yet.</i>`,
      `  <i>🕐 As of ${now}</i>`,
    ].join('\n');
  }

  // Totals by currency
  const byCurrency = {};
  transactions.forEach(t => {
    if (!byCurrency[t.currency]) byCurrency[t.currency] = { total: 0, count: 0 };
    byCurrency[t.currency].total += t.amount;
    byCurrency[t.currency].count++;
  });

  // Totals by payment method (per currency)
  const byMethod = {};
  transactions.forEach(t => {
    const method = (t.payMethod || '').startsWith('ABA KHQR') ? 'ABA KHQR'
      : (t.payMethod || '').startsWith('ABA PAY') ? 'ABA PAY'
      : (t.payMethod || '').toUpperCase() === 'CASH' ? 'CASH'
      : t.payMethod || 'OTHER';
    if (!byMethod[method]) byMethod[method] = { totalKHR: 0, totalUSD: 0, count: 0 };
    if (t.currency === 'KHR') byMethod[method].totalKHR += t.amount;
    else byMethod[method].totalUSD += t.amount;
    byMethod[method].count++;
  });

  // By payer (use KHR total for ranking, track per currency)
  const byPayer = {};
  transactions.forEach(t => {
    if (!byPayer[t.payer]) byPayer[t.payer] = { totalKHR: 0, totalUSD: 0, count: 0 };
    if (t.currency === 'KHR') byPayer[t.payer].totalKHR += t.amount;
    else byPayer[t.payer].totalUSD += t.amount;
    byPayer[t.payer].count++;
  });
  const topPayers = Object.entries(byPayer).sort((a, b) => b[1].totalKHR - a[1].totalKHR);
  const uniquePayers = topPayers.length;

  // By merchant
  const byMerchant = {};
  transactions.forEach(t => {
    if (!t.merchant) return;
    if (!byMerchant[t.merchant]) byMerchant[t.merchant] = { total: 0, count: 0, currency: t.currency };
    byMerchant[t.merchant].total += t.amount;
    byMerchant[t.merchant].count++;
  });

  const lines = [];

  // Header
  lines.push(`<b>╔══════════════════════════╗</b>`);
  lines.push(`<b>║  💳  PAYMENT SUMMARY      ║</b>`);
  lines.push(`<b>╚══════════════════════════╝</b>`);
  lines.push(``);

  if (period) lines.push(`<b>📅  ${escapeHtml(label)}</b>  <code>${period}</code>`);
  else        lines.push(`<b>📅  ${escapeHtml(label)}</b>`);
  lines.push(`<i>🕐 Updated: ${now}</i>`);
  lines.push(``);

  // Stats bar
  lines.push(`${divider('─', 28)}`);
  lines.push(`  🧾 Transactions  <b>${transactions.length}</b>`);
  lines.push(`  👥 Unique Payers  <b>${uniquePayers}</b>`);
  lines.push(`${divider('─', 28)}`);
  lines.push(``);

  // Totals
  lines.push(`<b>💰 TOTAL RECEIVED</b>`);
  for (const [cur, d] of Object.entries(byCurrency)) {
    lines.push(`  <b>${fmtAmount(d.total, cur)}</b>  <i>(${d.count} payment${d.count > 1 ? 's' : ''})</i>`);
  }
  lines.push(``);

  // By payment method
  lines.push(`💳 <b>BY PAYMENT METHOD</b>`);
  const methodOrder = ['ABA PAY', 'ABA KHQR', 'CASH', 'OTHER'];
  const sortedMethods = Object.entries(byMethod).sort((a, b) => {
    const ai = methodOrder.indexOf(a[0]), bi = methodOrder.indexOf(b[0]);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  sortedMethods.forEach(([method, d]) => {
    const icon = method === 'CASH' ? '💵' : method === 'ABA PAY' ? '📱' : method === 'ABA KHQR' ? '🔲' : '💳';
    const amts = [d.totalKHR ? fmtAmount(d.totalKHR, 'KHR') : null, d.totalUSD ? fmtAmount(d.totalUSD, 'USD') : null].filter(Boolean).join('  ');
    lines.push(`  ${icon} ${method}: <b>${amts}</b>  <i>×${d.count}</i>`);
  });
  lines.push(``);

  // Top payers
  lines.push(`<b>👤 PAYERS</b>`);
  topPayers.slice(0, 10).forEach(([name, d], i) => {
    const rank = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    const times = d.count > 1 ? ` ×${d.count}` : '';
    const amts = [d.totalKHR ? fmtAmount(d.totalKHR, 'KHR') : null, d.totalUSD ? fmtAmount(d.totalUSD, 'USD') : null].filter(Boolean).join('  ');
    lines.push(`  ${rank} ${escapeHtml(name)}${times}`);
    lines.push(`      └ <b>${amts}</b>`);
  });
  if (uniquePayers > 10) lines.push(`  <i>+ ${uniquePayers - 10} more payers</i>`);
  lines.push(``);

  // Merchant breakdown
  const merchants = Object.entries(byMerchant).sort((a, b) => b[1].total - a[1].total);
  if (merchants.length > 0) {
    lines.push(`<b>🏪 BY MERCHANT</b>`);
    merchants.forEach(([name, d]) => {
      lines.push(`  • <b>${escapeHtml(name)}</b>`);
      lines.push(`    ${fmtAmount(d.total, d.currency)}  ·  ${d.count} txn${d.count > 1 ? 's' : ''}`);
    });
    lines.push(``);
  }

  lines.push(`${divider('─', 28)}`);
  lines.push(`<i>📋 /list — view all transactions</i>`);

  return lines.join('\n');
}

// ── Detail List ────────────────────────────────────────────────────────────────

function formatDetailedList(transactions, label) {
  if (transactions.length === 0) {
    return `<b>📋 TRANSACTIONS — ${escapeHtml(label).toUpperCase()}</b>\n\n<i>No transactions recorded.</i>`;
  }

  // Totals
  const byCurrency = {};
  transactions.forEach(t => {
    byCurrency[t.currency] = (byCurrency[t.currency] || 0) + t.amount;
  });

  const lines = [];
  lines.push(`<b>📋 TRANSACTIONS</b>  <code>${escapeHtml(label)}</code>`);
  lines.push(`<i>${transactions.length} record${transactions.length > 1 ? 's' : ''}</i>`);
  lines.push(``);

  // Sort by timestamp
  const sorted = [...transactions].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  sorted.forEach((t, i) => {
    const num = String(i + 1).padStart(2, '0');
    lines.push(`<b>${num}│</b> <b>${fmtAmount(t.amount, t.currency)}</b>`);
    lines.push(`   <b>${escapeHtml(t.payer)}</b> <code>${escapeHtml(t.cardMask || '')}</code>`);
    if (t.merchant) lines.push(`   🏪 ${escapeHtml(t.merchant)}`);
    lines.push(`   🕐 ${t.dateTimeStr}  ·  ${escapeHtml(t.payMethod || '')}`);
    lines.push(`   🔖 <code>${t.trxId}</code>`);
    if (i < transactions.length - 1) lines.push(`   ${divider('╌', 24)}`);
  });

  lines.push(``);
  lines.push(`${divider('─', 28)}`);
  for (const [cur, total] of Object.entries(byCurrency)) {
    lines.push(`💰 <b>TOTAL: ${fmtAmount(total, cur)}</b>`);
  }

  return lines.join('\n');
}

module.exports = { parseABAMessage, formatSummary, formatDetailedList };
