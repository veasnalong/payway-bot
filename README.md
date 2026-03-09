# 📊 ABA Payway Summary Bot

A Telegram bot that automatically reads ABA Payway payment notifications in your group and generates summary reports.

---

## ✅ Features

- **Auto-captures** ABA Payway payment messages in any group
- **Supports** USD and KHR amounts
- **Parses** payer name, amount, reference, description, and timestamp
- **Summary commands** for today, last 7 days, or current month
- **Daily auto-report** at a scheduled time (default 6:00 PM)
- **Admin-only clear** command
- **Persistent storage** — data survives bot restarts
- Bilingual support (English + Khmer ABA messages)

---

## 🚀 Setup

### 1. Create your bot

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow prompts
3. Copy your **bot token**

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:
```
BOT_TOKEN=123456789:ABCdefGHI...
DAILY_REPORT_TIME=18:00
TIMEZONE=Asia/Phnom_Penh
```

### 3. Install & run

```bash
npm install
node index.js
```

### 4. Add bot to your group

1. Add the bot to your Telegram group
2. **Important:** Make the bot an **admin** so it can read messages (or at least give it access to messages)
3. Also go to @BotFather → `/mybots` → your bot → **Bot Settings** → **Group Privacy** → **Turn off** (so it can read all group messages)

---

## 💬 Commands

| Command | Description |
|---|---|
| `/summary` | Today's payment summary |
| `/summary_week` | Last 7 days summary |
| `/summary_month` | This month's summary |
| `/list` | Full transaction list for today |
| `/list 2024-03-10` | Transactions for a specific date |
| `/clear` | Clear today's data (admins only) |
| `/help` | Show help |

---

## 📋 Supported ABA Payway Message Formats

The bot parses messages that look like:

```
✅ Payment Received
Amount: $25.00
From: John Smith
Reference: PAY-20240310-001
Description: Invoice #123
Date: 10/03/2024 14:35:22
```

Or Khmer format messages with similar fields. The parser is flexible and handles variations in field names and formatting.

---

## ☁️ Deploy on a Server

To keep the bot running 24/7, deploy on a VPS or use PM2:

```bash
npm install -g pm2
pm2 start index.js --name aba-bot
pm2 save
pm2 startup
```

Or deploy to **Railway**, **Render**, or **Fly.io** for free hosting.

---

## 🗂 Project Structure

```
aba-summary-bot/
├── index.js        # Bot logic & commands
├── parser.js       # ABA Payway message parser
├── store.js        # Data storage (JSON file)
├── data.json       # Transaction data (auto-created)
├── .env            # Your config (don't commit!)
├── .env.example    # Config template
└── package.json
```

---

## ⚙️ Customizing the Parser

If your ABA Payway messages have a different format, edit `parser.js` and update the regex patterns in `parseABAMessage()`. You can also add a `console.log(text)` to see the raw message format, then adjust accordingly.
