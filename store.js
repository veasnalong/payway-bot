/**
 * store.js — Simple persistent store using a JSON file.
 * Structure: { chatId: { "YYYY-MM-DD": [ ...transactions ] } }
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');

let data = {};

// Load existing data on startup
function load() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      console.log(`📂 Loaded data from ${DATA_FILE}`);
    }
  } catch (e) {
    console.error('⚠️ Could not load data file, starting fresh.', e.message);
    data = {};
  }
}

function save() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('⚠️ Could not save data:', e.message);
  }
}

function addTransaction(chatId, transaction) {
  const key = String(chatId);
  const dateKey = transaction.timestamp.slice(0, 10); // YYYY-MM-DD

  if (!data[key]) data[key] = {};
  if (!data[key][dateKey]) data[key][dateKey] = [];

  // Deduplicate by messageId
  const exists = data[key][dateKey].some(t => t.messageId === transaction.messageId);
  if (!exists) {
    data[key][dateKey].push(transaction);
    save();
  }
}

function getTransactions(chatId, dateKey) {
  const key = String(chatId);
  return (data[key] && data[key][dateKey]) ? [...data[key][dateKey]] : [];
}

function clearTransactions(chatId, dateKey) {
  const key = String(chatId);
  if (data[key]) {
    data[key][dateKey] = [];
    save();
  }
}

function getAllChatIds() {
  return Object.keys(data).map(Number);
}

load();

module.exports = { addTransaction, getTransactions, clearTransactions, getAllChatIds };
