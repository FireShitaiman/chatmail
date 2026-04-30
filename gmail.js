const { app, ipcMain, shell } = require('electron');
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

// ===== IPC: CONFIG =====

ipcMain.handle('gmail:get-config', () => {
  const config = loadConfig();
  const oauth2 = makeOAuth2(config);
  return {
    clientId: config.clientId || '',
    isAuthenticated: !!(oauth2 && config.tokens),
    myEmail: config.myEmail || '',
  };
});

ipcMain.handle('gmail:save-config', (_, { clientId, clientSecret }) => {
  const patch = {};
  if (clientId)     patch.clientId = clientId;
  if (clientSecret) patch.clientSecret = clientSecret;
  saveConfig(patch);
  return { ok: true };
});

// ===== IPC: AUTH =====

let oauthServer = null;

ipcMain.handle('gmail:authenticate', () => {
  return new Promise((resolve) => {
    // 前回の認証サーバーが残っていれば閉じる
    if (oauthServer && oauthServer.listening) {
      oauthServer.close();
      oauthServer = null;
    }

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
      oauthServer = null;

      if (error || !code) {
        resolve({ ok: false, error: error || 'キャンセルされました' });
        return;
      }
      try {
        const { tokens } = await oauth2.getToken(code);
        saveConfig({ tokens });
        try {
          oauth2.setCredentials(tokens);
          const g = google.gmail({ version: 'v1', auth: oauth2 });
          const profile = await g.users.getProfile({ userId: 'me' });
          saveConfig({ myEmail: profile.data.emailAddress });
        } catch {}
        resolve({ ok: true });
      } catch (e) {
        resolve({ ok: false, error: e.message });
      }
    });

    oauthServer = server;
    server.listen(3000, () => shell.openExternal(authUrl));
    server.on('error', (e) => {
      oauthServer = null;
      resolve({ ok: false, error: 'ポート 3000 が使用中です。アプリを再起動してから再試行してください。' });
    });

    setTimeout(() => {
      if (server.listening) {
        server.close();
        oauthServer = null;
        resolve({ ok: false, error: 'タイムアウト（2分）' });
      }
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

ipcMain.handle('gmail:mark-read', async (_, { threadId }) => {
  const gmail = gmailClient();
  if (!gmail) return { ok: false, error: '未認証' };
  try {
    const thread = await gmail.users.threads.get({ userId: 'me', id: threadId, format: 'minimal' });
    const unreadIds = (thread.data.messages || [])
      .filter(m => m.labelIds?.includes('UNREAD'))
      .map(m => m.id);
    await Promise.all(unreadIds.map(id =>
      gmail.users.messages.modify({ userId: 'me', id, requestBody: { removeLabelIds: ['UNREAD'] } })
    ));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('gmail:trash-thread', async (_, { threadId }) => {
  const gmail = gmailClient();
  if (!gmail) return { ok: false, error: '未認証' };
  try {
    await gmail.users.threads.trash({ userId: 'me', id: threadId });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('gmail:mark-unread', async (_, { threadId }) => {
  const gmail = gmailClient();
  if (!gmail) return { ok: false, error: '未認証' };
  try {
    const thread = await gmail.users.threads.get({ userId: 'me', id: threadId, format: 'minimal' });
    const lastMsg = (thread.data.messages || []).at(-1);
    if (lastMsg) {
      await gmail.users.messages.modify({
        userId: 'me', id: lastMsg.id,
        requestBody: { addLabelIds: ['UNREAD'] },
      });
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('gmail:fetch-trash', async (_, { pageToken } = {}) => {
  const gmail = gmailClient();
  if (!gmail) return { ok: false, error: '未認証' };
  try {
    const [trashRes, spamRes, profileRes] = await Promise.all([
      gmail.users.threads.list({ userId: 'me', maxResults: 50, includeSpamTrash: true, labelIds: ['TRASH'] }),
      gmail.users.threads.list({ userId: 'me', maxResults: 50, includeSpamTrash: true, labelIds: ['SPAM'] }),
      gmail.users.getProfile({ userId: 'me' }),
    ]);
    const myEmail = profileRes.data.emailAddress.toLowerCase();
    const seen = new Set();
    const threads = [...(trashRes.data.threads || []), ...(spamRes.data.threads || [])]
      .filter(t => { if (seen.has(t.id)) return false; seen.add(t.id); return true; });

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
      const fromHeader = getHeader(headers, 'From');
      const subject = getHeader(headers, 'Subject');
      const date = getHeader(headers, 'Date');
      const allLabels = msgs.flatMap(m => m.labelIds || []);
      const isSpam = allLabels.includes('SPAM');
      const { email: fromEmail } = parseFrom(fromHeader);
      const contactStr = fromEmail.toLowerCase() === myEmail
        ? (getHeader(headers, 'To') || fromHeader) : fromHeader;
      const { name, email } = parseFrom(contactStr);
      const internalDate = parseInt(lastMsg.internalDate || '0', 10);
      return { threadId: detail.data.id, name, email, subject, preview: subject, time: formatTime(date), unread: false, isSpam, internalDate };
    }).filter(Boolean)
      .sort((a, b) => b.internalDate - a.internalDate)
      .map(({ internalDate, ...rest }) => rest);

    return { ok: true, contacts, nextPageToken: null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('gmail:restore-thread', async (_, { threadId }) => {
  const gmail = gmailClient();
  if (!gmail) return { ok: false, error: '未認証' };
  try {
    await gmail.users.threads.modify({
      userId: 'me', id: threadId,
      requestBody: { addLabelIds: ['INBOX'], removeLabelIds: ['TRASH', 'SPAM'] },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ===== GMAIL CLIENT =====

function gmailClient() {
  const config = loadConfig();
  const oauth2 = makeOAuth2(config);
  if (!oauth2 || !config.tokens) return null;
  oauth2.setCredentials(config.tokens);
  oauth2.on('tokens', (tokens) => {
    const current = loadConfig();
    saveConfig({ tokens: { ...current.tokens, ...tokens } });
  });
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

function stripQuotedText(text) {
  const lines = text.split('\n');
  const result = [];
  for (const line of lines) {
    if (/^On .{10,300}wrote:\s*$/.test(line.trim())) break;
    if (/<[^@\s>]+@[^@\s>]+\.[^@\s>]+>:\s*$/.test(line)) break;
    if (/^>/.test(line)) continue;
    result.push(line);
  }
  return result.join('\n').trim();
}

function extractAttachments(payload) {
  const atts = [];
  function walk(part) {
    if (!part) return;
    if (part.filename && part.body?.attachmentId) {
      atts.push({
        name: part.filename,
        mimeType: part.mimeType || 'application/octet-stream',
        attachmentId: part.body.attachmentId,
        size: part.body.size || 0,
      });
    }
    if (part.parts) part.parts.forEach(walk);
  }
  walk(payload);
  return atts;
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

ipcMain.handle('gmail:fetch-threads', async (_, { pageToken, q } = {}) => {
  const gmail = gmailClient();
  if (!gmail) return { ok: false, error: '未認証' };

  try {
    const listParams = { userId: 'me', maxResults: 20, q: q || 'in:inbox' };
    if (pageToken) listParams.pageToken = pageToken;

    const [threadsRes, profileRes] = await Promise.all([
      gmail.users.threads.list(listParams),
      gmail.users.getProfile({ userId: 'me' }),
    ]);

    const myEmail = profileRes.data.emailAddress.toLowerCase();
    const threads = threadsRes.data.threads || [];

    const details = await Promise.all(
      threads.map(t =>
        gmail.users.threads.get({
          userId: 'me', id: t.id, format: 'metadata',
          metadataHeaders: ['From', 'To', 'Subject', 'Date'],
        })
      )
    );

    const snippetMap = {};
    (threadsRes.data.threads || []).forEach(t => { snippetMap[t.id] = t.snippet || ''; });

    const contacts = details.map(detail => {
      const msgs = detail.data.messages || [];
      if (msgs.length === 0) return null;

      const lastMsg = msgs[msgs.length - 1];
      const headers = lastMsg.payload?.headers || [];
      const fromHeader = getHeader(headers, 'From');
      const subject = getHeader(headers, 'Subject');
      const date = getHeader(headers, 'Date');
      const unread = msgs.some(m => m.labelIds?.includes('UNREAD'));

      // 自分が最後に返信したスレッドは To ヘッダーを相手として使う
      const { email: fromEmail } = parseFrom(fromHeader);
      const contactStr = fromEmail.toLowerCase() === myEmail
        ? (getHeader(headers, 'To') || fromHeader)
        : fromHeader;

      const { name, email } = parseFrom(contactStr);

      return {
        threadId: detail.data.id,
        name,
        email,
        subject,
        preview: subject,
        time: formatTime(date),
        unread,
        snippet: snippetMap[detail.data.id] || '',
      };
    }).filter(Boolean);

    return { ok: true, contacts, nextPageToken: threadsRes.data.nextPageToken || null };
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
      const body = extractPlainText(msg.payload).substring(0, 8000);

      const fromEmail = (from.match(/<(.+?)>/)?.[1] || from).toLowerCase();
      const isSent = fromEmail === myEmail;
      const dateStr = formatDate(date);
      const showDate = dateStr !== lastDate;
      lastDate = dateStr;

      return {
        messageId: msg.id,
        type: isSent ? 'sent' : 'received',
        text: isSent ? body.trim() : stripQuotedText(body),
        time: formatTime(date),
        date: showDate ? dateStr : null,
        attachments: extractAttachments(msg.payload),
      };
    });

    // CCの抽出：最後のメッセージのCCのみ参照（古いCCが蓄積しないよう）
    const allMsgs = threadDetail.data.messages || [];
    const lastMsg = allMsgs[allMsgs.length - 1];
    const lastHeaders = lastMsg?.payload?.headers || [];
    const rawCC = getHeader(lastHeaders, 'Cc');
    const threadCC = rawCC
      ? rawCC.split(',').map(s => s.trim()).filter(s => {
          const { email } = parseFrom(s);
          return email.toLowerCase() !== myEmail;
        }).join(', ')
      : '';

    return { ok: true, messages, threadCC };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ===== IPC: GET ATTACHMENT =====

ipcMain.handle('gmail:get-attachment', async (_, { messageId, attachmentId, filename }) => {
  const gmail = gmailClient();
  if (!gmail) return { ok: false, error: '未認証' };
  try {
    const res = await gmail.users.messages.attachments.get({
      userId: 'me', messageId, id: attachmentId,
    });
    const data = Buffer.from(res.data.data.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    const tmpPath = path.join(app.getPath('temp'), filename);
    fs.writeFileSync(tmpPath, data);
    await shell.openPath(tmpPath);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('gmail:get-attachment-data', async (_, { messageId, attachmentId }) => {
  const gmail = gmailClient();
  if (!gmail) return { ok: false, error: '未認証' };
  try {
    const res = await gmail.users.messages.attachments.get({
      userId: 'me', messageId, id: attachmentId,
    });
    return { ok: true, data: res.data.data.replace(/-/g, '+').replace(/_/g, '/') };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ===== IPC: SEND =====

function wrapBase64(b64, lineLen = 76) {
  const lines = [];
  for (let i = 0; i < b64.length; i += lineLen) lines.push(b64.slice(i, i + lineLen));
  return lines.join('\r\n');
}

ipcMain.handle('gmail:send', async (_, { to, cc, bcc, subject, body, threadId, attachments }) => {
  const gmail = gmailClient();
  if (!gmail) return { ok: false, error: '未認証' };

  try {
    const profileRes = await gmail.users.getProfile({ userId: 'me' });
    const from = profileRes.data.emailAddress;

    const finalSubject = threadId
      ? (subject.startsWith('Re:') ? subject : 'Re: ' + subject)
      : subject;

    const encodedSubject = `=?utf-8?B?${Buffer.from(finalSubject).toString('base64')}?=`;
    const baseHeaders = [`From: ${from}`, `To: ${to}`];
    if (cc)  baseHeaders.push(`Cc: ${cc}`);
    if (bcc) baseHeaders.push(`Bcc: ${bcc}`);
    baseHeaders.push(`Subject: ${encodedSubject}`, 'MIME-Version: 1.0');

    let raw;
    if (attachments && attachments.length > 0) {
      const boundary = `chatmail_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      baseHeaders.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
      const parts = [baseHeaders.join('\r\n'), ''];

      parts.push(
        `--${boundary}`,
        'Content-Type: text/plain; charset=utf-8',
        'Content-Transfer-Encoding: base64',
        '',
        wrapBase64(Buffer.from(body).toString('base64')),
        '',
      );

      for (const att of attachments) {
        const encodedName = `=?utf-8?B?${Buffer.from(att.name).toString('base64')}?=`;
        parts.push(
          `--${boundary}`,
          `Content-Type: ${att.mimeType || 'application/octet-stream'}; name="${encodedName}"`,
          'Content-Transfer-Encoding: base64',
          `Content-Disposition: attachment; filename="${encodedName}"`,
          '',
          wrapBase64(att.data),
          '',
        );
      }

      parts.push(`--${boundary}--`);
      raw = parts.join('\r\n');
    } else {
      baseHeaders.push(
        'Content-Type: text/plain; charset=utf-8',
        'Content-Transfer-Encoding: base64',
        '',
        wrapBase64(Buffer.from(body).toString('base64')),
      );
      raw = baseHeaders.join('\r\n');
    }

    const sendRes = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: Buffer.from(raw).toString('base64url'),
        threadId: threadId || undefined,
      },
    });

    return { ok: true, threadId: sendRes.data.threadId };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ===== IPC: FORWARD =====

ipcMain.handle('gmail:forward', async (_, { to, cc, bcc, subject, body, originalMessageId, threadId }) => {
  const gmail = gmailClient();
  if (!gmail) return { ok: false, error: '未認証' };

  try {
    const profileRes = await gmail.users.getProfile({ userId: 'me' });
    const from = profileRes.data.emailAddress;

    // 元メッセージ情報を取得
    const originalMsg = await gmail.users.messages.get({
      userId: 'me',
      id: originalMessageId,
      format: 'full',
    });

    const origHeaders = originalMsg.data.payload?.headers || [];
    const origFrom = getHeader(origHeaders, 'From');
    const origDate = getHeader(origHeaders, 'Date');
    const origSubject = getHeader(origHeaders, 'Subject');
    const origBody = extractPlainText(originalMsg.data.payload);

    // 転送本文を構成
    const forwardHeader = `
---------- Forwarded message ---------
From: ${origFrom}
Date: ${origDate}
Subject: ${origSubject}
To: ${getHeader(origHeaders, 'To')}

`;

    const fullBody = body + forwardHeader + origBody;

    const now = new Date();
    const boundary = `----ChatmailBoundary${now.getTime()}`;

    const headers = [
      `From: <${from}>`,
      `To: ${to}`,
      cc ? `Cc: ${cc}` : '',
      bcc ? `Bcc: ${bcc}` : '',
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ].filter(Boolean).join('\r\n');

    const textPart = `--${boundary}\r\nContent-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: 7bit\r\n\r\n${fullBody}\r\n`;
    const raw = `${headers}\r\n\r\n${textPart}--${boundary}--`;

    const sendRes = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: Buffer.from(raw).toString('base64url'),
        threadId: threadId || undefined,
      },
    });

    return { ok: true, threadId: sendRes.data.threadId };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
