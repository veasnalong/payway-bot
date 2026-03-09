/**
 * store.js — Supabase-backed persistent store
 * Table: aba_transactions
 */

const { createClient } = require('@supabase/supabase-js');

const TIMEZONE = process.env.TIMEZONE || 'Asia/Phnom_Penh';
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const TABLE = 'aba_transactions';

function getDateKey(isoTimestamp) {
  return new Date(isoTimestamp).toLocaleDateString('en-CA', { timeZone: TIMEZONE });
}

async function addTransaction(chatId, transaction) {
  const dateKey = getDateKey(transaction.timestamp);

  // Check duplicate by message_id + chat_id
  const { data: existing } = await supabase
    .from(TABLE)
    .select('id')
    .eq('chat_id', String(chatId))
    .eq('message_id', transaction.messageId)
    .maybeSingle();

  if (existing) return; // already recorded

  const { error } = await supabase.from(TABLE).insert({
    chat_id:     String(chatId),
    message_id:  transaction.messageId,
    date_key:    dateKey,
    amount:      transaction.amount,
    currency:    transaction.currency,
    payer:       transaction.payer,
    card_mask:   transaction.cardMask,
    merchant:    transaction.merchant,
    pay_method:  transaction.payMethod,
    trx_id:      transaction.trxId,
    apv:         transaction.apv,
    date_time_str: transaction.dateTimeStr,
    timestamp:   transaction.timestamp,
    time_str:    transaction.timeStr,
  });

  if (error) console.error('❌ Supabase insert error:', error.message);
  else console.log(`✅ Saved: ${transaction.payer} ${transaction.amount} ${transaction.currency}`);
}

async function getTransactions(chatId, dateKey) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('chat_id', String(chatId))
    .eq('date_key', dateKey)
    .order('timestamp', { ascending: true });

  if (error) { console.error('❌ Supabase fetch error:', error.message); return []; }

  return (data || []).map(row => ({
    amount:      row.amount,
    currency:    row.currency,
    payer:       row.payer,
    cardMask:    row.card_mask,
    merchant:    row.merchant,
    payMethod:   row.pay_method,
    trxId:       row.trx_id,
    apv:         row.apv,
    dateTimeStr: row.date_time_str,
    timestamp:   row.timestamp,
    timeStr:     row.time_str,
    messageId:   row.message_id,
  }));
}

async function getAllChatIds() {
  const { data, error } = await supabase
    .from(TABLE)
    .select('chat_id');

  if (error) return [];
  return [...new Set((data || []).map(r => Number(r.chat_id)))];
}

module.exports = { addTransaction, getTransactions, getAllChatIds };
