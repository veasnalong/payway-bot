/**
 * store.js — Supabase-backed persistent store
 */

const { createClient } = require('@supabase/supabase-js');

const TIMEZONE = process.env.TIMEZONE || 'Asia/Phnom_Penh';
const TABLE = 'aba_transactions';

let supabase = null;

function getClient() {
  if (supabase) return supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_KEY must be set in environment variables');
  }
  supabase = createClient(url, key);
  return supabase;
}

function getDateKey(isoTimestamp) {
  return new Date(isoTimestamp).toLocaleDateString('en-CA', { timeZone: TIMEZONE });
}

async function addTransaction(chatId, transaction) {
  try {
    const db = getClient();
    const dateKey = getDateKey(transaction.timestamp);

    const { data: existing } = await db
      .from(TABLE)
      .select('id')
      .eq('chat_id', String(chatId))
      .eq('message_id', transaction.messageId)
      .maybeSingle();

    if (existing) return;

    const { error } = await db.from(TABLE).insert({
      chat_id:      String(chatId),
      message_id:   transaction.messageId,
      date_key:     dateKey,
      amount:       transaction.amount,
      currency:     transaction.currency,
      payer:        transaction.payer,
      card_mask:    transaction.cardMask,
      merchant:     transaction.merchant,
      pay_method:   transaction.payMethod,
      trx_id:       transaction.trxId,
      apv:          transaction.apv,
      date_time_str: transaction.dateTimeStr,
      timestamp:    transaction.timestamp,
      time_str:     transaction.timeStr,
    });

    if (error) console.error('❌ Supabase insert error:', error.message);
    else console.log(`✅ Saved: ${transaction.payer} ${transaction.amount} ${transaction.currency}`);
  } catch (e) {
    console.error('❌ addTransaction error:', e.message);
  }
}

async function getTransactions(chatId, dateKey) {
  try {
    const db = getClient();
    const { data, error } = await db
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
  } catch (e) {
    console.error('❌ getTransactions error:', e.message);
    return [];
  }
}

async function getAllChatIds() {
  try {
    const db = getClient();
    const { data, error } = await db.from(TABLE).select('chat_id');
    if (error) return [];
    return [...new Set((data || []).map(r => Number(r.chat_id)))];
  } catch (e) {
    return [];
  }
}

module.exports = { addTransaction, getTransactions, getAllChatIds };
