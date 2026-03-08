import re
import sqlite3
import logging
import os
import asyncio
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from telethon import TelegramClient, events

API_ID   = int(os.environ.get('API_ID', '6853725'))
API_HASH  = os.environ.get(“API_HASH”, “ad999703e58d06143d9b05f9a0e8ac82”)
PHONE     = os.environ.get(“PHONE”, “+855968888223”)
DB_PATH   = “payway_transactions.db”
EXCHANGE_RATE = 4100
TZ        = ZoneInfo(“Asia/Phnom_Penh”)
DAILY_SUMMARY_HOUR   = 21
DAILY_SUMMARY_MINUTE = 0

logging.basicConfig(format=”%(asctime)s [%(levelname)s] %(message)s”, level=logging.INFO)
logger = logging.getLogger(**name**)

def init_db():
con = sqlite3.connect(DB_PATH)
con.execute(”””
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
created_at TEXT DEFAULT (datetime(‘now’))
)
“””)
con.execute(”””
CREATE TABLE IF NOT EXISTS auto_report_chats (
chat_id INTEGER PRIMARY KEY
)
“””)
con.commit()
con.close()

def save_transaction(payer, account, amount, currency, trx_id, apv, paid_at, chat_id):
con = sqlite3.connect(DB_PATH)
try:
con.execute(”””
INSERT OR IGNORE INTO transactions
(payer, account, amount, currency, trx_id, apv, paid_at, chat_id)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
“””, (payer, account, amount, currency, trx_id, apv, paid_at.isoformat(), chat_id))
con.commit()
logger.info(“Saved: %s %s%s trx=%s”, payer, currency, amount, trx_id)
return True
except Exception as e:
logger.error(“DB error: %s”, e)
return False
finally:
con.close()

def query_transactions(start, end, chat_id):
con = sqlite3.connect(DB_PATH)
rows = con.execute(”””
SELECT payer, account, amount, currency, trx_id, apv, paid_at
FROM transactions
WHERE paid_at >= ? AND paid_at < ? AND chat_id = ?
ORDER BY paid_at ASC
“””, (start.isoformat(), end.isoformat(), chat_id)).fetchall()
con.close()
return rows

def get_all_auto_report_chats():
con = sqlite3.connect(DB_PATH)
rows = con.execute(“SELECT chat_id FROM auto_report_chats”).fetchall()
con.close()
return [r[0] for r in rows]

def register_chat(chat_id):
con = sqlite3.connect(DB_PATH)
con.execute(“INSERT OR IGNORE INTO auto_report_chats (chat_id) VALUES (?)”, (chat_id,))
con.commit()
con.close()

PAYWAY_USD_RE = re.compile(
r”$([0-9,]+(?:.[0-9]+)?)\s+paid by\s+(.+?)\s+((*\d+))”
r”\s+on\s+(\w+ \d{1,2}),\s+(\d{1,2}:\d{2}\s+[AP]M)”
r”.*?Trx. ID:\s*(\d+),\s*APV:\s*(\d+)”,
re.DOTALL | re.IGNORECASE,
)
PAYWAY_KHR_RE = re.compile(
r”(?:\u17db\s*([0-9,]+)|([0-9,]+)\s*(?:\u17db|riel))\s+paid by\s+(.+?)\s+((*\d+))”
r”\s+on\s+(\w+ \d{1,2}),\s+(\d{1,2}:\d{2}\s+[AP]M)”
r”.*?Trx. ID:\s*(\d+),\s*APV:\s*(\d+)”,
re.DOTALL | re.IGNORECASE,
)

def parse_dt(date_str, time_str):
year = datetime.now(TZ).year
try:
return datetime.strptime(”%s %s %s” % (date_str, year, time_str), “%b %d %Y %I:%M %p”).replace(tzinfo=TZ)
except ValueError:
return datetime.now(TZ)

def parse_payway(text):
results = []
seen = set()
for m in PAYWAY_USD_RE.finditer(text):
trx_id = m.group(6)
if trx_id in seen:
continue
seen.add(trx_id)
amt = float(m.group(1).replace(”,”, “”))
currency = “USD” if (”.” in m.group(1) and amt < 1000) else “KHR”
results.append({“payer”: m.group(2).strip(), “account”: m.group(3),
“amount”: amt, “currency”: currency, “trx_id”: trx_id,
“apv”: m.group(7), “paid_at”: parse_dt(m.group(4), m.group(5))})
for m in PAYWAY_KHR_RE.finditer(text):
trx_id = m.group(7)
if trx_id in seen:
continue
seen.add(trx_id)
amt = float((m.group(1) or m.group(2)).replace(”,”, “”))
results.append({“payer”: m.group(3).strip(), “account”: m.group(4),
“amount”: amt, “currency”: “KHR”, “trx_id”: trx_id,
“apv”: m.group(8), “paid_at”: parse_dt(m.group(5), m.group(6))})
return results

def fmt_usd(n): return “$%s” % “{:,.2f}”.format(n)
def fmt_khr(n): return “KHR %s” % “{:,.0f}”.format(n)
def to_usd(a, c): return a if c == “USD” else a / EXCHANGE_RATE
def to_khr(a, c): return a if c == “KHR” else a * EXCHANGE_RATE

def build_report(rows, title):
if not rows:
return “No transactions found\n” + title
lines = [”=== “ + title + “ ===”, “”]
total_usd_paid = total_khr_paid = 0.0
total_usd_equiv = total_khr_equiv = 0.0
count_usd = count_khr = 0
for i, (payer, account, amount, currency, trx_id, apv, paid_at_str) in enumerate(rows, 1):
paid_at = datetime.fromisoformat(paid_at_str).astimezone(TZ)
usd = to_usd(amount, currency)
khr = to_khr(amount, currency)
total_usd_equiv += usd
total_khr_equiv += khr
if currency == “USD”:
total_usd_paid += amount
count_usd += 1
amt_str = “USD “ + fmt_usd(amount) + “  ~  “ + fmt_khr(khr)
else:
total_khr_paid += amount
count_khr += 1
amt_str = fmt_khr(amount) + “  ~  “ + fmt_usd(usd)
lines.append(”%d. %s” % (i, paid_at.strftime(”%d %b %Y  %H:%M”)))
lines.append(”   “ + payer + “ “ + account)
lines.append(”   “ + amt_str)
lines.append(””)
lines.append(”=========================”)
lines.append(“Total Transactions : %d” % len(rows))
lines.append(””)
if count_khr > 0:
lines.append(“KHR Payments (%d txn)” % count_khr)
lines.append(”  Paid   : “ + fmt_khr(total_khr_paid))
lines.append(”  In USD : “ + fmt_usd(total_khr_paid / EXCHANGE_RATE))
lines.append(””)
if count_usd > 0:
lines.append(“USD Payments (%d txn)” % count_usd)
lines.append(”  Paid   : “ + fmt_usd(total_usd_paid))
lines.append(”  In KHR : “ + fmt_khr(total_usd_paid * EXCHANGE_RATE))
lines.append(””)
lines.append(”———————––”)
lines.append(“Grand Total USD : “ + fmt_usd(total_usd_equiv))
lines.append(“Grand Total KHR : “ + fmt_khr(total_khr_equiv))
lines.append(“Rate            : $1 = KHR %s” % “{:,}”.format(EXCHANGE_RATE))
return “\n”.join(lines)

client = TelegramClient(“payway_session”, API_ID, API_HASH)

@client.on(events.NewMessage)
async def on_any_message(event):
text = event.raw_text or “”
txns = parse_payway(text)
if txns:
for t in txns:
save_transaction(t[“payer”], t[“account”], t[“amount”], t[“currency”],
t[“trx_id”], t[“apv”], t[“paid_at”], event.chat_id)
logger.info(“Recorded %d payment(s) in chat %s”, len(txns), event.chat_id)

@client.on(events.NewMessage(pattern=r”^/report_daily”))
async def report_daily(event):
now = datetime.now(TZ)
start = now.replace(hour=0, minute=0, second=0, microsecond=0)
rows = query_transactions(start, start + timedelta(days=1), event.chat_id)
await event.reply(build_report(rows, “Daily Report\n” + now.strftime(”%A, %d %b %Y”)))

@client.on(events.NewMessage(pattern=r”^/report_weekly”))
async def report_weekly(event):
now = datetime.now(TZ)
start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
end = start + timedelta(weeks=1)
rows = query_transactions(start, end, event.chat_id)
end_d = start + timedelta(days=6)
title = “Weekly Report\n” + start.strftime(”%d %b”) + “ - “ + end_d.strftime(”%d %b %Y”)
await event.reply(build_report(rows, title))

@client.on(events.NewMessage(pattern=r”^/report_monthly”))
async def report_monthly(event):
now = datetime.now(TZ)
start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
end = start.replace(month=now.month % 12 + 1) if now.month < 12 else start.replace(year=now.year + 1, month=1)
rows = query_transactions(start, end, event.chat_id)
await event.reply(build_report(rows, “Monthly Report\n” + now.strftime(”%B %Y”)))

@client.on(events.NewMessage(pattern=r”^/help|^/start”))
async def cmd_help(event):
register_chat(event.chat_id)
await event.reply(
“PayWay Report Bot\n\n”
“Reading ALL PayWay ABA payments (USD + KHR).\n\n”
“Commands:\n”
“/report_daily - today\n”
“/report_weekly - this week\n”
“/report_monthly - this month\n\n”
“Auto daily summary at %02d:%02d every night.” % (DAILY_SUMMARY_HOUR, DAILY_SUMMARY_MINUTE)
)

async def auto_daily_summary_loop():
while True:
now = datetime.now(TZ)
target = now.replace(hour=DAILY_SUMMARY_HOUR, minute=DAILY_SUMMARY_MINUTE, second=0, microsecond=0)
if now >= target:
target += timedelta(days=1)
wait_seconds = (target - now).total_seconds()
logger.info(“Next auto summary in %.1f hours”, wait_seconds / 3600)
await asyncio.sleep(wait_seconds)
now = datetime.now(TZ)
start = now.replace(hour=0, minute=0, second=0, microsecond=0)
title = “Auto Daily Summary\n” + now.strftime(”%A, %d %b %Y”)
for chat_id in get_all_auto_report_chats():
rows = query_transactions(start, start + timedelta(days=1), chat_id)
try:
await client.send_message(chat_id, build_report(rows, title))
logger.info(“Sent auto daily summary to %s”, chat_id)
except Exception as e:
logger.error(“Failed to send to %s: %s”, chat_id, e)

async def main():
init_db()
await client.start(phone=PHONE)
me = await client.get_me()
logger.info(“Logged in as: %s”, me.first_name)
logger.info(“Listening for PayWay ABA messages…”)
asyncio.create_task(auto_daily_summary_loop())
await client.run_until_disconnected()

if **name** == “**main**”:
asyncio.run(main())
