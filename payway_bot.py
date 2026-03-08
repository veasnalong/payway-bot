import re, sqlite3, logging, os, asyncio
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from telethon import TelegramClient, events

API_ID   = int(os.environ.get(‘API_ID’, ‘0’))
API_HASH = os.environ.get(‘API_HASH’, ‘YOUR_API_HASH’)
PHONE    = os.environ.get(‘PHONE’, ‘+855xxxxxxxxx’)
DB_PATH  = ‘payway_transactions.db’
EXCHANGE_RATE = 4100
TZ = ZoneInfo(‘Asia/Phnom_Penh’)
DAILY_HOUR   = 21
DAILY_MINUTE = 0
logging.basicConfig(format=’%(asctime)s %(levelname)s %(message)s’, level=logging.INFO)
logger = logging.getLogger(**name**)

def init_db():
con = sqlite3.connect(DB_PATH)
con.execute(‘CREATE TABLE IF NOT EXISTS transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, payer TEXT, account TEXT, amount REAL, currency TEXT, trx_id TEXT UNIQUE, apv TEXT, paid_at TEXT, chat_id INTEGER)’)
con.execute(‘CREATE TABLE IF NOT EXISTS auto_report_chats (chat_id INTEGER PRIMARY KEY)’)
con.commit(); con.close()

def save_tx(payer, account, amount, currency, trx_id, apv, paid_at, chat_id):
con = sqlite3.connect(DB_PATH)
try:
con.execute(‘INSERT OR IGNORE INTO transactions (payer,account,amount,currency,trx_id,apv,paid_at,chat_id) VALUES (?,?,?,?,?,?,?,?)’, (payer,account,amount,currency,trx_id,apv,paid_at.isoformat(),chat_id))
con.commit()
except Exception as e: logger.error(‘DB %s’, e)
finally: con.close()

def query(start, end, chat_id):
con = sqlite3.connect(DB_PATH)
rows = con.execute(‘SELECT payer,account,amount,currency,trx_id,apv,paid_at FROM transactions WHERE paid_at>=? AND paid_at<? AND chat_id=? ORDER BY paid_at’, (start.isoformat(),end.isoformat(),chat_id)).fetchall()
con.close(); return rows

def get_chats():
con = sqlite3.connect(DB_PATH)
rows = con.execute(‘SELECT chat_id FROM auto_report_chats’).fetchall()
con.close(); return [r[0] for r in rows]

def reg_chat(cid):
con = sqlite3.connect(DB_PATH)
con.execute(‘INSERT OR IGNORE INTO auto_report_chats(chat_id) VALUES(?)’, (cid,))
con.commit(); con.close()

USD_PAT = r’$([0-9,]+(?:.[0-9]+)?)\s+paid by\s+(.+?)\s+((*\d+))\s+on\s+(\w+ \d{1,2}),\s+(\d{1,2}:\d{2}\s+[AP]M).*?Trx.\s*ID:\s*(\d+),\s*APV:\s*(\d+)’
KHR_PAT = r’(?:\u17db\s*([0-9,]+)|([0-9,]+)\s*(?:\u17db|riel))\s+paid by\s+(.+?)\s+((*\d+))\s+on\s+(\w+ \d{1,2}),\s+(\d{1,2}:\d{2}\s+[AP]M).*?Trx.\s*ID:\s*(\d+),\s*APV:\s*(\d+)’
USD_RE = re.compile(USD_PAT, re.DOTALL|re.IGNORECASE)
KHR_RE = re.compile(KHR_PAT, re.DOTALL|re.IGNORECASE)

def pdt(ds, ts):
try: return datetime.strptime(ds+’ ‘+str(datetime.now(TZ).year)+’ ’+ts, ‘%b %d %Y %I:%M %p’).replace(tzinfo=TZ)
except: return datetime.now(TZ)

def parse(text):
out, seen = [], set()
for m in USD_RE.finditer(text):
tid = m.group(6)
if tid in seen: continue
seen.add(tid)
a = float(m.group(1).replace(’,’,’’))
c = ‘USD’ if (’.’ in m.group(1) and a < 1000) else ‘KHR’
out.append(dict(payer=m.group(2).strip(),account=m.group(3),amount=a,currency=c,trx_id=tid,apv=m.group(7),paid_at=pdt(m.group(4),m.group(5))))
for m in KHR_RE.finditer(text):
tid = m.group(7)
if tid in seen: continue
seen.add(tid)
a = float((m.group(1) or m.group(2)).replace(’,’,’’))
out.append(dict(payer=m.group(3).strip(),account=m.group(4),amount=a,currency=‘KHR’,trx_id=tid,apv=m.group(8),paid_at=pdt(m.group(5),m.group(6))))
return out

def fusd(n): return ‘$’+’{:,.2f}’.format(n)
def fkhr(n): return ‘KHR ‘+’{:,.0f}’.format(n)
def tusd(a,c): return a if c==‘USD’ else a/EXCHANGE_RATE
def tkhr(a,c): return a if c==‘KHR’ else a*EXCHANGE_RATE

def build_report(rows, title):
if not rows: return ‘No transactions found for ’ + title
L = [’=== ‘+title+’ ===’, ‘’]
tu=tk=cu=ck=0.0; nu=nk=0
for i,(payer,account,amount,currency,_x,_y,pat) in enumerate(rows,1):
pd = datetime.fromisoformat(pat).astimezone(TZ)
u=tusd(amount,currency); k=tkhr(amount,currency)
tu+=u; tk+=k
if currency==‘USD’:
cu+=amount; nu+=1; s=‘USD ‘+fusd(amount)+’  ~  ‘+fkhr(k)
else:
ck+=amount; nk+=1; s=fkhr(amount)+’  ~  ‘+fusd(u)
L.append(’%d. %s’%(i,pd.strftime(’%d %b %Y  %H:%M’)))
L.append(’   ‘+payer+’ ‘+account)
L.append(’   ‘+s)
L.append(’’)
L += [’=========================’,‘Total : %d transactions’%len(rows),’’]
if nk: L += [‘KHR Payments (%d)’%nk,’  Paid   : ‘+fkhr(ck),’  In USD : ‘+fusd(ck/EXCHANGE_RATE),’’]
if nu: L += [‘USD Payments (%d)’%nu,’  Paid   : ‘+fusd(cu),’  In KHR : ‘+fkhr(cu*EXCHANGE_RATE),’’]
L += [’———————––’,’Grand Total USD : ’+fusd(tu),‘Grand Total KHR : ‘+fkhr(tk),‘Rate : $1 = KHR %s’%’{:,}’.format(EXCHANGE_RATE)]
return chr(10).join(L)

client = TelegramClient(‘payway_session’, API_ID, API_HASH)

@client.on(events.NewMessage)
async def on_msg(event):
txns = parse(event.raw_text or ‘’)
for t in txns:
save_tx(t[‘payer’],t[‘account’],t[‘amount’],t[‘currency’],t[‘trx_id’],t[‘apv’],t[‘paid_at’],event.chat_id)
if txns: logger.info(‘Recorded %d payment(s)’, len(txns))

@client.on(events.NewMessage(pattern=r’^/report_daily’))
async def daily(event):
now=datetime.now(TZ); s=now.replace(hour=0,minute=0,second=0,microsecond=0)
await event.reply(build_report(query(s,s+timedelta(days=1),event.chat_id),‘Daily Report - ‘+now.strftime(’%A %d %b %Y’)))

@client.on(events.NewMessage(pattern=r’^/report_weekly’))
async def weekly(event):
now=datetime.now(TZ)
s=(now-timedelta(days=now.weekday())).replace(hour=0,minute=0,second=0,microsecond=0)
await event.reply(build_report(query(s,s+timedelta(weeks=1),event.chat_id),‘Weekly Report - ‘+s.strftime(’%d %b’)+’ to ‘+(s+timedelta(days=6)).strftime(’%d %b %Y’)))

@client.on(events.NewMessage(pattern=r’^/report_monthly’))
async def monthly(event):
now=datetime.now(TZ); s=now.replace(day=1,hour=0,minute=0,second=0,microsecond=0)
e=s.replace(month=now.month%12+1) if now.month<12 else s.replace(year=now.year+1,month=1)
await event.reply(build_report(query(s,e,event.chat_id),‘Monthly Report - ‘+now.strftime(’%B %Y’)))

@client.on(events.NewMessage(pattern=r’^/help|^/start’))
async def help_cmd(event):
reg_chat(event.chat_id)
msg = ‘PayWay Report Bot’ + chr(10)*2 + ‘Commands:’ + chr(10) + ‘/report_daily’ + chr(10) + ‘/report_weekly’ + chr(10) + ‘/report_monthly’ + chr(10)*2 + ‘Auto summary at %02d:%02d nightly’%(DAILY_HOUR,DAILY_MINUTE)
await event.reply(msg)

async def daily_loop():
while True:
now=datetime.now(TZ)
t=now.replace(hour=DAILY_HOUR,minute=DAILY_MINUTE,second=0,microsecond=0)
if now>=t: t+=timedelta(days=1)
await asyncio.sleep((t-now).total_seconds())
now=datetime.now(TZ); s=now.replace(hour=0,minute=0,second=0,microsecond=0)
title=‘Auto Daily Summary - ‘+now.strftime(’%A %d %b %Y’)
for cid in get_chats():
try: await client.send_message(cid,build_report(query(s,s+timedelta(days=1),cid),title))
except Exception as ex: logger.error(‘Send failed %s’,ex)

async def main():
init_db()
await client.start(phone=PHONE)
me=await client.get_me()
logger.info(‘Logged in as %s’, me.first_name)
asyncio.create_task(daily_loop())
await client.run_until_disconnected()

if **name** == ‘**main**’:
asyncio.run(main())
