# Chatmail

**Email's UI is broken. Not the technology — the interface.**

Every Gmail thread is a wall of quoted text, headers, and signatures. You just want to know what Bob said. Instead you get three "Please see below" and Bob's reply buried somewhere in the middle.

Chatmail strips all that away. It's Gmail, but it looks like a chat.

## Features

- Chat-style thread view (no more email clutter)
- Reply, forward, and compose — all in one pane
- AI-assisted replies and tone adjustment (Formal / Casual / Shorter)
- Spam filter with rule-based and AI detection
- Task management from emails
- Dark / light theme
- Infinite scroll, search, auto-draft saving

## Requirements

- Windows / macOS / Linux
- Node.js 18+
- A Google Cloud project with Gmail API enabled
- (Optional) Claude or OpenAI API key for AI features

## Setup

### 1. Clone and install

```bash
git clone https://github.com/FireShitaiman/chatmail.git
cd chatmail
npm install
npm start
```

### 2. Create a Google Cloud OAuth app

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project
3. Enable **Gmail API** under APIs & Services
4. Go to **APIs & Services → OAuth consent screen**
   - User type: External
   - Fill in app name and your email
   - Add scope: `https://mail.google.com/`
   - Under **Audience**, click **Publish App** (no Google review required)
5. Go to **APIs & Services → Credentials**
   - Create **OAuth 2.0 Client ID** → Desktop app
   - Add `http://localhost:3000/oauth/callback` as an authorized redirect URI
   - Copy the **Client ID** and **Client Secret**

### 3. Connect Gmail

1. Open Chatmail and click the ⚙ settings button
2. Enter your **Client ID** and **Client Secret**
3. Click **Connect Gmail** — your browser will open for authentication
4. You will see an "unverified app" warning — this is expected. Click **Advanced → Go to [app] (unsafe)** to proceed. This warning appears because you created the OAuth app yourself; it is safe.

### 4. (Optional) Enable AI features

In Settings, enter your **Claude API key** (or OpenAI-compatible key) to use:
- AI reply generation
- Tone adjustment (Formal / Casual / Shorter)
- AI spam detection

## Support

If you find Chatmail useful, consider buying me a coffee ☕

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-support-yellow?logo=buy-me-a-coffee)](https://buymeacoffee.com/fireshitair)

**A note on supporting:** I'm a developer in Japan. Due to the weak yen, a $5 donation goes about 1.5× further than it looks. If Chatmail saves you time, buying me a coffee in dollars is genuinely appreciated.

## License

MIT
