/**
 * parser.js — Parse ABA Payway Telegram bot messages
 *
 * Exact ABA Payway format:
 * ៛6,000 paid by MEAS PANHA (*534) on Mar 09, 12:44 PM via ABA PAY at Mini Cafe HLA57. Trx. ID: 177303507915729, APV: 663671
 *
 * Fields:
 *   Amount      — ៛6,000  or  $25.50
 *   Payer       — MEAS PANHA
 *   Card last 4 — *534
 *   Date/time   — Mar 09, 12:44 PM
 *   Merchant    — Mini Cafe HLA57
 *   Trx. ID     — 177303507915729
 *   APV         — 663671
 */

const TIMEZONE = process.env.TIMEZONE || 'Asia/Phnom_Penh';

/**
 * Try to parse an ABA Payway message.
 * Returns a transaction object or null if not an ABA message.
 */
function parseABAMessage(text, msg) {
  if (!text) return null;

  // ── Master regex for the exact ABA Payway format ────────────────────────────
  // ៛6,000 paid by MEAS PANHA (*534) on Mar 09, 12:44 PM via ABA PAY at Mini Cafe HLA57. Trx. ID: 177303507915729, APV: 663671
  const masterPattern = /^([៛$])\s*([\d,]+(?:\.\d+)?)\s+paid by\s+(.+?)\s+\((\*\d+)\)\s+on\s+(.+?)\s+via\s+(ABA KHQR(?:\s*\([^)]+\))?|ABA PAY|ABA)\s+at\s+(.+?)\.\s+Trx\.\s*ID:\s*(\d+),\s*APV:\s*(\d+)/i;

  const m = text.match(masterPattern);
  if (!m) return null;

  const [, currencySymbol, amountRaw, payerName, cardMask, dateTimeStr, payMethod, merchant, trxId, apv] = m;

  const currency = currencySymbol === '៛' ? 'KHR' : 'USD';
  const amount = parseFloat(amountRaw.replace(/,/g, ''));

  if (!amount || isNaN(amount)) return null;

  // ── Parse date/time string e.g. "Mar 09, 12:44 PM" ─────────────────────────
  const year = new Date().getFullYear();
  const parsedDate = new Date(`${dateTimeStr} ${year}`);
  const timestamp = isNaN(parsedDate)
    ? (msg.date ? new Date(msg.date * 1000).toISOString() : new Date().toISOString())
    : parsedDate.toISOString();

  const timeStr = new Date(msg.date ? msg.date * 1000 : Date.now())
    .toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: TIMEZONE });

  return {
    amount,
    currency,
    payer: payerName.trim(),
    cardMask,
    merchant: merchant.trim(),
    payMethod,
    trxId,
    apv,
    dateTimeStr: dateTimeStr.trim(),
    timestamp,
    timeStr,
    messageId: msg.message_id,
  };
}

/**
 * Format a summary report for a list of transactions.
 */
function formatSummary(transactions, label, period) {
  if (transactions.length === 0) {
    return `📊 <b>${label}</b>${period ? `\n📅 ${period}` : ''}\n\n<i>No transactions recorded yet.</i>`;
  }

  // Group by currency
  const byCurrency = {};
  transactions.forEach(t => {
    if (!byCurrency[t.currency]) byCurrency[t.currency] = { total: 0, count: 0 };
    byCurrency[t.currency].total += t.amount;
    byCurrency[t.currency].count++;
  });

  // Unique payers
  const uniquePayers = [...new Set(transactions.map(t => t.payer))];

  // Breakdown by payer (top payers by total amount)
  const byPayer = {};
  transactions.forEach(t => {
    if (!byPayer[t.payer]) byPayer[t.payer] = { total: 0, count: 0, currency: t.currency };
    byPayer[t.payer].total += t.amount;
    byPayer[t.payer].count++;
  });
  const topPayers = Object.entries(byPayer)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 10);

  // Breakdown by merchant
  const byMerchant = {};
  transactions.forEach(t => {
    if (!t.merchant) return;
    if (!byMerchant[t.merchant]) byMerchant[t.merchant] = { total: 0, count: 0, currency: t.currency };
    byMerchant[t.merchant].total += t.amount;
    byMerchant[t.merchant].count++;
  });

  let lines = [];
  lines.push(`📊 <b>${label}</b>`);
  if (period) lines.push(`📅 <code>${period}</code>`);
  lines.push('');
  lines.push(`🧾 <b>Total Transactions:</b> ${transactions.length}`);
  lines.push(`👥 <b>Unique Payers:</b> ${uniquePayers.length}`);
  lines.push('');

  // Totals per currency
  lines.push('💰 <b>Amount Received:</b>');
  for (const [cur, data] of Object.entries(byCurrency)) {
    const symbol = cur === 'KHR' ? '៛' : '$';
    const formatted = cur === 'KHR'
      ? data.total.toLocaleString('en-US', { maximumFractionDigits: 0 })
      : data.total.toFixed(2);
    lines.push(`  ${symbol}${formatted} <i>(${data.count} payment${data.count > 1 ? 's' : ''})</i>`);
  }

  // Top payers
  lines.push('');
  lines.push(`👤 <b>Payers:</b>`);
  topPayers.forEach(([name, data]) => {
    const symbol = data.currency === 'KHR' ? '៛' : '$';
    const amt = data.currency === 'KHR'
      ? data.total.toLocaleString('en-US', { maximumFractionDigits: 0 })
      : data.total.toFixed(2);
    lines.push(`  • ${escapeHtml(name)} — ${symbol}${amt} (×${data.count})`);
  });
  if (uniquePayers.length > 10) lines.push(`  <i>...and ${uniquePayers.length - 10} more</i>`);

  // Merchant breakdown
  if (Object.keys(byMerchant).length > 0) {
    lines.push('');
    lines.push(`🏪 <b>By Merchant:</b>`);
    Object.entries(byMerchant)
      .sort((a, b) => b[1].total - a[1].total)
      .forEach(([merchant, data]) => {
        const symbol = data.currency === 'KHR' ? '៛' : '$';
        const amt = data.currency === 'KHR'
          ? data.total.toLocaleString('en-US', { maximumFractionDigits: 0 })
          : data.total.toFixed(2);
        lines.push(`  • ${escapeHtml(merchant)} — ${symbol}${amt} (×${data.count})`);
      });
  }

  lines.push('');
  lines.push(`<i>Use /list for full transaction details.</i>`);

  return lines.join('\n');
}

/**
 * Format a detailed transaction list.
 */
function formatDetailedList(transactions, label) {
  if (transactions.length === 0) {
    return `📋 <b>Transactions — ${label}</b>\n\n<i>No transactions recorded.</i>`;
  }

  let lines = [];
  lines.push(`📋 <b>Transactions — ${label}</b>`);
  lines.push(`<i>${transactions.length} record(s)</i>`);
  lines.push('─────────────────────');

  transactions.forEach((t, i) => {
    const symbol = t.currency === 'KHR' ? '៛' : '$';
    const amt = t.currency === 'KHR'
      ? t.amount.toLocaleString('en-US', { maximumFractionDigits: 0 })
      : t.amount.toFixed(2);

    lines.push(`<b>${i + 1}.</b> ${symbol}${amt} — <b>${escapeHtml(t.payer)}</b> ${escapeHtml(t.cardMask || '')}`);
    if (t.merchant) lines.push(`   🏪 ${escapeHtml(t.merchant)}`);
    lines.push(`   🕐 ${t.dateTimeStr}`);
    if (t.trxId) lines.push(`   🔖 Trx: <code>${t.trxId}</code>  APV: <code>${t.apv}</code>`);
  });

  lines.push('─────────────────────');

  // Totals
  const byCurrency = {};
  transactions.forEach(t => {
    byCurrency[t.currency] = (byCurrency[t.currency] || 0) + t.amount;
  });
  for (const [cur, total] of Object.entries(byCurrency)) {
    const symbol = cur === 'KHR' ? '៛' : '$';
    const formatted = cur === 'KHR'
      ? total.toLocaleString('en-US', { maximumFractionDigits: 0 })
      : total.toFixed(2);
    lines.push(`💰 <b>Total:</b> ${symbol}${formatted}`);
  }

  return lines.join('\n');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

module.exports = { parseABAMessage, formatSummary, formatDetailedList };
