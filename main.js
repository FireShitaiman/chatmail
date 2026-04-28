const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { google } = require('googleapis');

// ===== CONFIG =====

const configPath = () => path.join(app.getPath('userData'), 'chatmail-config.json');

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    return {};
  }
}

function saveConfig(patch) {
  const current = loadConfig();
  fs.writeFileSync(configPath(), JSON.stringify({ ...current, ...patch }, null, 2));
}

function makeOAuth2(config) {
  if (!config.clientId || !config.clientSecret) return null;
  return new google.auth.OAuth2(
    config.clientId,
    config.clientSecret,
    'http://localhost:3000/oauth/callback'
  );
}

// ===== WINDOW =====

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ===== IPC: CONFIG =====

ipcMain.handle('gmail:get-config', () => {
  const config = loadConfig();
  const oauth2 = makeOAuth2(config);
  return {
    clientId: config.clientId || '',
    clientSecret: config.clientSecret || '',
    isAuthenticated: !!(oauth2 && config.tokens),
  };
});

ipcMain.handle('gmail:save-config', (_, { clientId, clientSecret }) => {
  saveConfig({ clientId, clientSecret });
  return { ok: true };
});

// ===== IPC: AUTH =====

ipcMain.handle('gmail:authenticate', () => {
  return new Promise((resolve) => {
    const config = loadConfig();
    const oauth2 = makeOAuth2(config);
    if (!oauth2) return resolve({ ok: false, error: 'Client ID / Client Secret が設定されていません' });

    const authUrl = oauth2.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [
        'https://www.googleapis.com/auth/gmail.modify',
        'https://www.googleapis.com/auth/userinfo.email',
      ],
    });

    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://localhost:3000');
      if (url.pathname !== '/oauth/callback') { res.end(''); return; }

      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body style="font-family:sans-serif;text-align:center;padding:60px"><h2>認証完了！<br>Chatmailに戻ってください。</h2></body></html>');
      server.close();

      if (error || !code) {
        resolve({ ok: false, error: error || 'キャンセルされました' });
        return;
      }
      try {
        const { tokens } = await oauth2.getToken(code);
        saveConfig({ tokens });
        resolve({ ok: true });
      } catch (e) {
        resolve({ ok: false, error: e.message });
      }
    });

    server.listen(3000, () => shell.openExternal(authUrl));
    server.on('error', (e) => resolve({ ok: false, error: 'ポート 3000 が使用中です: ' + e.message }));

    setTimeout(() => {
      if (server.listening) { server.close(); resolve({ ok: false, error: 'タイムアウト（2分）' }); }
    }, 120000);
  });
});

ipcMain.handle('gmail:signout', () => {
  const config = loadConfig();
  delete config.tokens;
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
  return { ok: true };
});

ipcMain.handle('open-external', (_, url) => shell.openExternal(url));

// ===== GMAIL CLIENT =====

function gmailClient() {
  const config = loadConfig();
  const oauth2 = makeOAuth2(config);
  if (!oauth2 || !config.tokens) return null;
  oauth2.setCredentials(config.tokens);
  return google.gmail({ version: 'v1', auth: oauth2 });
}

// ===== HELPERS =====

function getHeader(headers, name) {
  const h = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

function decodeBase64url(data) {
  if (!data) return '';
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function extractPlainText(payload) {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain') return decodeBase64url(payload.body?.data);
  if (payload.mimeType === 'text/html') {
    return decodeBase64url(payload.body?.data).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  if (payload.parts) {
    const textPart = payload.parts.find(p => p.mimeType === 'text/plain');
    if (textPart) return extractPlainText(textPart);
    for (const part of payload.parts) {
      const text = extractPlainText(part);
      if (text) return text;
    }
  }
  return '';
}

function parseFrom(from) {
  const match = from.match(/^"?(.+?)"?\s*<(.+?)>$/);
  if (match) return { name: match[1].trim(), email: match[2].trim() };
  return { name: from.trim(), email: from.trim() };
}

function formatTime(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  if (d.toDateString() === now.toDateString())
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

// ===== IPC: FETCH THREADS =====

ipcMain.handle('gmail:fetch-threads', async () => {
  const gmail = gmailClient();
  if (!gmail) return { ok: false, error: '未認証' };

  try {
    const res = await gmail.users.threads.list({
      userId: 'me', maxResults: 20, q: 'in:inbox',
    });

    const threads = res.data.threads || [];

    const details = await Promise.all(
      threads.map(t =>
        gmail.users.threads.get({
          userId: 'me', id: t.id, format: 'metadata',
          metadataHeaders: ['From', 'To', 'Subject', 'Date'],
        })
      )
    );

    const contacts = details.map(detail => {
      const msgs = detail.data.messages || [];
      if (msgs.length === 0) return null;

      const lastMsg = msgs[msgs.length - 1];
      const headers = lastMsg.payload?.headers || [];
      const from = getHeader(headers, 'From');
      const subject = getHeader(headers, 'Subject');
      const date = getHeader(headers, 'Date');
      const unread = msgs.some(m => m.labelIds?.includes('UNREAD'));

      const { name, email } = parseFrom(from);

      return {
        threadId: detail.data.id,
        name,
        email,
        subject,
        preview: subject,
        time: formatTime(date),
        unread,
      };
    }).filter(Boolean);

    return { ok: true, contacts };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ===== IPC: FETCH MESSAGES =====

ipcMain.handle('gmail:fetch-messages', async (_, { threadId }) => {
  const gmail = gmailClient();
  if (!gmail) return { ok: false, error: '未認証' };

  try {
    const [threadDetail, profileRes] = await Promise.all([
      gmail.users.threads.get({ userId: 'me', id: threadId, format: 'full' }),
      gmail.users.getProfile({ userId: 'me' }),
    ]);

    const myEmail = profileRes.data.emailAddress.toLowerCase();
    let lastDate = null;

    const messages = (threadDetail.data.messages || []).map(msg => {
      const headers = msg.payload?.headers || [];
      const from = getHeader(headers, 'From');
      const date = getHeader(headers, 'Date');
      const body = extractPlainText(msg.payload).substring(0, 1200);

      const fromEmail = (from.match(/<(.+?)>/)?.[1] || from).toLowerCase();
      const isSent = fromEmail === myEmail;
      const dateStr = formatDate(date);
      const showDate = dateStr !== lastDate;
      lastDate = dateStr;

      return {
        type: isSent ? 'sent' : 'received',
        text: body.trim(),
        time: formatTime(date),
        date: showDate ? dateStr : null,
      };
    });

    return { ok: true, messages };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ===== IPC: SEND =====

ipcMain.handle('gmail:send', async (_, { to, subject, body, threadId }) => {
  const gmail = gmailClient();
  if (!gmail) return { ok: false, error: '未認証' };

  try {
    const profileRes = await gmail.users.getProfile({ userId: 'me' });
    const from = profileRes.data.emailAddress;

    const replySubject = subject.startsWith('Re:') ? subject : 'Re: ' + subject;

    const raw = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: =?utf-8?B?${Buffer.from(replySubject).toString('base64')}?=`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(body).toString('base64'),
    ].join('\r\n');

    await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: Buffer.from(raw).toString('base64url'),
        threadId: threadId || undefined,
      },
    });

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
