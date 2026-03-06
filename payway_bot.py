#!/usr/bin/env python3
"""
PayWay ABA Telegram Report Bot
pip install "python-telegram-bot==20.7"
"""

import re
import sqlite3
import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from telegram import Update
from telegram.ext import (
    ApplicationBuilder, CommandHandler,
    MessageHandler, ContextTypes, filters,
)

# ── CONFIG ─────────────────────────────────────────────────────────────────────
import os
BOT_TOKEN     = os.environ.get("BOT_TOKEN", "8535145906:AAHLvTTpdFlEXvC0ZBA08RxM2Ulj-HiaABk")   # <-- paste your token here
DB_PATH       = "payway_transactions.db"
EXCHANGE_RATE = 4100                    # 1 USD = 4100 KHR
TZ            = ZoneInfo("Asia/Phnom_Penh")
# ───────────────────────────────────────────────────────────────────────────────

logging.basicConfig(format="%(asctime)s [%(levelname)s] %(message)s", level=logging.INFO)
logger = logging.getLogger(__name__)

# ── DATABASE ───────────────────────────────────────────────────────────────────
def init_db():
    con = sqlite3.connect(DB_PATH)
    con.execute("""
        CREATE TABLE IF NOT EXISTS transactions (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            payer      TEXT NOT NULL,
            account    TEXT,
            amount     REAL NOT NULL,
            currency   TEXT NOT NULL,
            trx_id     TEXT UNIQUE,
            apv        TEXT,
            paid_at    TEXT NOT NULL,
            chat_id    INTEGER,
            created_at TEXT DEFAULT (datetime('now'))
        )
    """)
    con.commit()
    con.close()

def save_transaction(payer, account, amount, currency, trx_id, apv, paid_at, chat_id):
    con = sqlite3.connect(DB_PATH)
    try:
        con.execute("""
            INSERT OR IGNORE INTO transactions
              (payer, account, amount, currency, trx_id, apv, paid_at, chat_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (payer, account, amount, currency, trx_id, apv, paid_at.isoformat(), chat_id))
        con.commit()
        logger.info(f"Saved: {payer} {currency}{amount} trx={trx_id}")
    finally:
        con.close()

def query_transactions(start, end, chat_id):
    con = sqlite3.connect(DB_PATH)
    rows = con.execute("""
        SELECT payer, account, amount, currency, trx_id, apv, paid_at
        FROM transactions
        WHERE paid_at >= ? AND paid_at < ? AND chat_id = ?
        ORDER BY paid_at ASC
    """, (start.isoformat(), end.isoformat(), chat_id)).fetchall()
    con.close()
    return rows

# ── PARSER ─────────────────────────────────────────────────────────────────────
PAYWAY_RE = re.compile(
    r"\$([0-9,]+(?:\.[0-9]+)?)\s+paid by\s+(.+?)\s+\((\*\d+)\)"
    r"\s+on\s+(\w+ \d{1,2}),\s+(\d{1,2}:\d{2}\s+[AP]M)"
    r".*?Trx\. ID:\s*(\d+),\s*APV:\s*(\d+)",
    re.DOTALL | re.IGNORECASE,
)

def parse_payway(text):
    results = []
    for m in PAYWAY_RE.finditer(text):
        raw_amount = float(m.group(1).replace(",", ""))
        currency = "USD" if ("." in m.group(1) and raw_amount < 100) else "KHR"
        year = datetime.now(TZ).year
        dt_str = f"{m.group(4)} {year} {m.group(5)}"
        try:
            paid_at = datetime.strptime(dt_str, "%b %d %Y %I:%M %p").replace(tzinfo=TZ)
        except ValueError:
            paid_at = datetime.now(TZ)
        results.append({
            "payer": m.group(2).strip(), "account": m.group(3),
            "amount": raw_amount, "currency": currency,
            "trx_id": m.group(6), "apv": m.group(7), "paid_at": paid_at,
        })
    return results

# ── FORMATTER ──────────────────────────────────────────────────────────────────
def fmt_usd(n): return f"${n:,.2f}"
def fmt_khr(n): return f"KHR {n:,.0f}"
def to_usd(a, c): return a if c == "USD" else a / EXCHANGE_RATE
def to_khr(a, c): return a if c == "KHR" else a * EXCHANGE_RATE

def build_report(rows, title):
    if not rows:
        return f"No transactions found for: {title}"

    lines = [f"=== {title} ===", ""]
    total_usd = total_khr = 0.0

    for i, (payer, account, amount, currency, trx_id, apv, paid_at_str) in enumerate(rows, 1):
        paid_at = datetime.fromisoformat(paid_at_str).astimezone(TZ)
        usd = to_usd(amount, currency)
        khr = to_khr(amount, currency)
        total_usd += usd
        total_khr += khr
        if currency == "USD":
            amt_str = f"USD {fmt_usd(amount)}  ~  {fmt_khr(khr)}"
        else:
            amt_str = f"{fmt_khr(amount)}  ~  {fmt_usd(usd)}"
        lines.append(f"{i}. {paid_at.strftime('%H:%M')} - {payer} {account}")
        lines.append(f"   {amt_str}")

    lines += [
        "",
        "-------------------------",
        f"Transactions : {len(rows)}",
        f"Total USD    : {fmt_usd(total_usd)}",
        f"Total KHR    : {fmt_khr(total_khr)}",
        f"Rate         : 1 USD = {EXCHANGE_RATE:,} KHR",
    ]
    return "\n".join(lines)

# ── HANDLERS ───────────────────────────────────────────────────────────────────
async def on_message(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    text = update.message.text or update.message.caption or ""
    txns = parse_payway(text)
    for t in txns:
        save_transaction(
            t["payer"], t["account"], t["amount"], t["currency"],
            t["trx_id"], t["apv"], t["paid_at"], update.effective_chat.id,
        )
    if txns:
        await update.message.reply_text(f"Recorded {len(txns)} payment(s).")

async def report_daily(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    now = datetime.now(TZ)
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=1)
    rows = query_transactions(start, end, update.effective_chat.id)
    title = f"Daily Report - {now.strftime('%A %d %b %Y')}"
    await update.message.reply_text(build_report(rows, title))

async def report_weekly(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    now = datetime.now(TZ)
    start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(weeks=1)
    rows = query_transactions(start, end, update.effective_chat.id)
    end_disp = start + timedelta(days=6)
    title = f"Weekly Report - {start.strftime('%d %b')} to {end_disp.strftime('%d %b %Y')}"
    await update.message.reply_text(build_report(rows, title))

async def report_monthly(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    now = datetime.now(TZ)
    start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if now.month < 12:
        end = start.replace(month=now.month + 1)
    else:
        end = start.replace(year=now.year + 1, month=1)
    rows = query_transactions(start, end, update.effective_chat.id)
    title = f"Monthly Report - {now.strftime('%B %Y')}"
    await update.message.reply_text(build_report(rows, title))

async def cmd_help(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    msg = (
        "PayWay Report Bot\n\n"
        "I capture PayWay ABA payments in this group.\n\n"
        "Commands:\n"
        "/report_daily - today\n"
        "/report_weekly - this week\n"
        "/report_monthly - this month\n"
        "/help - this message\n\n"
        "Make sure I am added as Admin to read all messages."
    )
    await update.message.reply_text(msg)

# ── MAIN ───────────────────────────────────────────────────────────────────────
def main():
    init_db()
    app = ApplicationBuilder().token(BOT_TOKEN).build()
    app.add_handler(CommandHandler("start",          cmd_help))
    app.add_handler(CommandHandler("help",           cmd_help))
    app.add_handler(CommandHandler("report_daily",   report_daily))
    app.add_handler(CommandHandler("report_weekly",  report_weekly))
    app.add_handler(CommandHandler("report_monthly", report_monthly))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, on_message))
    logger.info("Bot is running... Press Ctrl+C to stop.")
    app.run_polling(allowed_updates=Update.ALL_TYPES)

if __name__ == "__main__":
    main()
