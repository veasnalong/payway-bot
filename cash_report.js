/**
 * cash_report.js
 * Handles photo → Claude Vision → extract cash report data → save to Supabase
 */

const https = require('https');
const { createClient } = require('@supabase/supabase-js');

const TIMEZONE = process.env.TIMEZONE || 'Asia/Phnom_Penh';
const TABLE = 'cash_reports';

let supabase = null;
function getClient() {
  if (supabase) return supabase;
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  return supabase;
}

function getTodayKey() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE });
}

// ── Download Telegram photo as base64 ─────────────────────────────────────────
async function downloadPhotoBase64(bot, fileId) {
  const file = await bot.getFile(fileId);
  const url = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ── Call Claude Vision API to extract cash report fields ──────────────────────
async function extractReportFromImage(base64Image) {
  const body = JSON.stringify({
    model: 'claude-opus-4-5',
    max_tokens: 1500,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/jpeg', data: base64Image }
        },
        {
          type: 'text',
          text: `This is a Mini Coffee daily cash report sheet. Extract all the data you can see and return ONLY a JSON object with no explanation, no markdown, no backticks. Use this exact structure:
{
  "date": "YYYY-MM-DD or null",
  "cashier": "name or null",
  "shift": "morning/evening/full or null",
  "cash_in_khr": number or null,
  "cash_in_usd": number or null,
  "bank_aba_khr": number or null,
  "bank_aba_usd": number or null,
  "bank_acleda_khr": number or null,
  "bank_acleda_usd": number or null,
  "bank_lolc_khr": number or null,
  "bank_lolc_usd": number or null,
  "bank_sathapana_khr": number or null,
  "bank_sathapana_usd": number or null,
  "bank_prince_khr": number or null,
  "bank_prince_usd": number or null,
  "bank_other_khr": number or null,
  "bank_other_usd": number or null,
  "total_bank_khr": number or null,
  "total_bank_usd": number or null,
  "total_income_khr": number or null,
  "total_income_usd": number or null,
  "expenses_khr": number or null,
  "expenses_usd": number or null,
  "profit_khr": number or null,
  "profit_usd": number or null,
  "sales_22oz": number or null,
  "sales_16oz": number or null,
  "sales_12oz": number or null,
  "total_net_sales_khr": number or null,
  "total_net_sales_usd": number or null,
  "cash_out_khr": number or null,
  "cash_out_usd": number or null,
  "grand_total_khr": number or null,
  "grand_total_usd": number or null,
  "notes": "any other relevant info or null"
}
Only return the JSON. Do not include any other text.`
        }
      ]
    }]
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const text = parsed.content?.[0]?.text || '';
          const clean = text.replace(/```json|```/g, '').trim();
          resolve(JSON.parse(clean));
        } catch (e) {
          reject(new Error('Failed to parse Claude response: ' + data.slice(0, 200)));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Save report to Supabase ───────────────────────────────────────────────────
async function saveReport(chatId, messageId, data) {
  const db = getClient();
  const dateKey = data.date || getTodayKey();

  // Check duplicate
  const { data: existing } = await db
    .from(TABLE)
    .select('id')
    .eq('chat_id', String(chatId))
    .eq('message_id', messageId)
    .maybeSingle();
  if (existing) return { duplicate: true };

  const { error } = await db.from(TABLE).insert({
    chat_id:            String(chatId),
    message_id:         messageId,
    date_key:           dateKey,
    cashier:            data.cashier,
    shift:              data.shift,
    cash_in_khr:        data.cash_in_khr,
    cash_in_usd:        data.cash_in_usd,
    bank_aba_khr:       data.bank_aba_khr,
    bank_aba_usd:       data.bank_aba_usd,
    bank_acleda_khr:    data.bank_acleda_khr,
    bank_acleda_usd:    data.bank_acleda_usd,
    bank_lolc_khr:      data.bank_lolc_khr,
    bank_lolc_usd:      data.bank_lolc_usd,
    bank_sathapana_khr: data.bank_sathapana_khr,
    bank_sathapana_usd: data.bank_sathapana_usd,
    bank_prince_khr:    data.bank_prince_khr,
    bank_prince_usd:    data.bank_prince_usd,
    bank_other_khr:     data.bank_other_khr,
    bank_other_usd:     data.bank_other_usd,
    total_bank_khr:     data.total_bank_khr,
    total_bank_usd:     data.total_bank_usd,
    total_income_khr:   data.total_income_khr,
    total_income_usd:   data.total_income_usd,
    expenses_khr:       data.expenses_khr,
    expenses_usd:       data.expenses_usd,
    profit_khr:         data.profit_khr,
    profit_usd:         data.profit_usd,
    sales_22oz:         data.sales_22oz,
    sales_16oz:         data.sales_16oz,
    sales_12oz:         data.sales_12oz,
    total_net_sales_khr: data.total_net_sales_khr,
    total_net_sales_usd: data.total_net_sales_usd,
    cash_out_khr:       data.cash_out_khr,
    cash_out_usd:       data.cash_out_usd,
    grand_total_khr:    data.grand_total_khr,
    grand_total_usd:    data.grand_total_usd,
    notes:              data.notes,
    raw_json:           JSON.stringify(data),
  });

  if (error) throw new Error(error.message);
  return { dateKey, data };
}

// ── Get reports for a date ────────────────────────────────────────────────────
async function getReports(chatId, dateKey) {
  const db = getClient();
  const { data, error } = await db
    .from(TABLE)
    .select('*')
    .eq('chat_id', String(chatId))
    .eq('date_key', dateKey)
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);
  return data || [];
}

// ── Format report for Telegram ────────────────────────────────────────────────
function fmtKHR(n) {
  if (n == null) return '—';
  return '៛' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
}
function fmtUSD(n) {
  if (n == null) return '—';
  return '$' + Number(n).toFixed(2);
}
function row(label, khr, usd) {
  const k = khr != null ? fmtKHR(khr) : null;
  const u = usd != null ? fmtUSD(usd) : null;
  if (!k && !u) return null;
  const val = [k, u].filter(Boolean).join('  ');
  return `  ${label}: <b>${val}</b>`;
}

function formatReportSummary(reports, label, dateKey) {
  if (reports.length === 0) {
    return `📋 <b>CASH REPORT — ${label}</b>\n\n<i>No reports submitted yet.</i>`;
  }

  // Aggregate across multiple shifts
  const sum = (field) => reports.reduce((acc, r) => acc + (Number(r[field]) || 0), 0) || null;

  const lines = [];
  lines.push(`<b>╔══════════════════════════╗</b>`);
  lines.push(`<b>║  📋  DAILY CASH REPORT    ║</b>`);
  lines.push(`<b>╚══════════════════════════╝</b>`);
  lines.push('');
  lines.push(`<b>📅 ${label}</b>  <code>${dateKey}</code>`);

  const cashiers = [...new Set(reports.map(r => r.cashier).filter(Boolean))];
  if (cashiers.length) lines.push(`👤 Cashier: <b>${cashiers.join(', ')}</b>`);
  if (reports.length > 1) lines.push(`🔄 <i>${reports.length} shifts combined</i>`);
  lines.push('');

  // Cash In
  lines.push(`─────────────────────────────`);
  lines.push(`💵 <b>CASH IN</b>`);
  const ci = [row('KHR', sum('cash_in_khr'), null), row('USD', null, sum('cash_in_usd'))].filter(Boolean);
  if (ci.length) ci.forEach(l => lines.push(l));
  else lines.push('  —');
  lines.push('');

  // Bank Payments
  lines.push(`🏦 <b>BANK PAYMENTS</b>`);
  const banks = [
    ['ABA',       'bank_aba_khr',       'bank_aba_usd'],
    ['ACLEDA',    'bank_acleda_khr',    'bank_acleda_usd'],
    ['LOLC',      'bank_lolc_khr',      'bank_lolc_usd'],
    ['SATHAPANA', 'bank_sathapana_khr', 'bank_sathapana_usd'],
    ['PRINCE',    'bank_prince_khr',    'bank_prince_usd'],
    ['Other',     'bank_other_khr',     'bank_other_usd'],
  ];
  let hasBank = false;
  banks.forEach(([name, kField, uField]) => {
    const k = sum(kField), u = sum(uField);
    if (k || u) { lines.push(`  • ${name}: <b>${[k ? fmtKHR(k) : null, u ? fmtUSD(u) : null].filter(Boolean).join('  ')}</b>`); hasBank = true; }
  });
  if (!hasBank) lines.push('  —');
  const tbk = sum('total_bank_khr'), tbu = sum('total_bank_usd');
  if (tbk || tbu) lines.push(`  <i>Total: ${[tbk ? fmtKHR(tbk) : null, tbu ? fmtUSD(tbu) : null].filter(Boolean).join('  ')}</i>`);
  lines.push('');

  // Sales
  lines.push(`☕ <b>SALES</b>`);
  const s22 = sum('sales_22oz'), s16 = sum('sales_16oz'), s12 = sum('sales_12oz');
  if (s22) lines.push(`  22oz: <b>${s22}</b> cups`);
  if (s16) lines.push(`  16oz: <b>${s16}</b> cups`);
  if (s12) lines.push(`  12oz: <b>${s12}</b> cups`);
  const tns_k = sum('total_net_sales_khr'), tns_u = sum('total_net_sales_usd');
  if (tns_k || tns_u) lines.push(`  Net Sales: <b>${[tns_k ? fmtKHR(tns_k) : null, tns_u ? fmtUSD(tns_u) : null].filter(Boolean).join('  ')}</b>`);
  lines.push('');

  // Income & Profit
  lines.push(`📈 <b>INCOME & PROFIT</b>`);
  const ti_k = sum('total_income_khr'), ti_u = sum('total_income_usd');
  if (ti_k || ti_u) lines.push(`  Total Income: <b>${[ti_k ? fmtKHR(ti_k) : null, ti_u ? fmtUSD(ti_u) : null].filter(Boolean).join('  ')}</b>`);
  const ex_k = sum('expenses_khr'), ex_u = sum('expenses_usd');
  if (ex_k || ex_u) lines.push(`  Expenses: <b>${[ex_k ? fmtKHR(ex_k) : null, ex_u ? fmtUSD(ex_u) : null].filter(Boolean).join('  ')}</b>`);
  const pr_k = sum('profit_khr'), pr_u = sum('profit_usd');
  if (pr_k || pr_u) lines.push(`  Profit: <b>${[pr_k ? fmtKHR(pr_k) : null, pr_u ? fmtUSD(pr_u) : null].filter(Boolean).join('  ')}</b>`);
  lines.push('');

  // Grand Total
  const gt_k = sum('grand_total_khr'), gt_u = sum('grand_total_usd');
  if (gt_k || gt_u) {
    lines.push(`─────────────────────────────`);
    lines.push(`💰 <b>GRAND TOTAL: ${[gt_k ? fmtKHR(gt_k) : null, gt_u ? fmtUSD(gt_u) : null].filter(Boolean).join('  ')}</b>`);
  }

  return lines.join('\n');
}

async function clearReports(chatId, dateKey) {
  try {
    const db = getClient();
    const { error } = await db
      .from(TABLE)
      .delete()
      .eq('chat_id', String(chatId))
      .eq('date_key', dateKey);
    if (error) throw new Error(error.message);
    console.log(`🗑️ Cleared cash reports for chat=${chatId} date=${dateKey}`);
  } catch (e) {
    console.error('❌ clearReports error:', e.message);
    throw e;
  }
}

module.exports = { downloadPhotoBase64, extractReportFromImage, saveReport, getReports, formatReportSummary, clearReports };
