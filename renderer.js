// ===== STATE =====
let contacts = [];
let currentContact = null;
let gmailConnected = false;
let globalSignature = localStorage.getItem('chatmail_signature') || '';

// 相手別の冒頭文は localStorage に保存（email → greeting）
function getGreeting(email) {
  const map = JSON.parse(localStorage.getItem('chatmail_greetings') || '{}');
  return map[email] || '';
}

function setGreeting(email, text) {
  const map = JSON.parse(localStorage.getItem('chatmail_greetings') || '{}');
  map[email] = text;
  localStorage.setItem('chatmail_greetings', JSON.stringify(map));
}

// ===== AVATAR COLOR =====
const AVATAR_COLORS = ['#4f6ef7','#e8605a','#2ab37a','#f5a623','#9b59b6','#e67e22','#1abc9c','#e91e63'];
function emailToColor(email) {
  let hash = 0;
  for (const c of email) hash = c.charCodeAt(0) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// ===== SIDEBAR =====
function renderContactList() {
  const list = document.getElementById('contact-list');
  if (contacts.length === 0) {
    list.innerHTML = '<div class="sidebar-empty"><p>受信トレイが空です。</p></div>';
    return;
  }
  list.innerHTML = contacts.map((c, i) => `
    <div class="contact-item${currentContact && currentContact.threadId === c.threadId ? ' active' : ''}"
         data-index="${i}"
         onclick="selectContact(${i})">
      <div class="avatar" style="background:${emailToColor(c.email)}">${(c.name[0] || '?').toUpperCase()}</div>
      <div class="contact-info">
        <div class="contact-name">${esc(c.name)}</div>
        <div class="contact-preview">${esc(c.preview || c.subject || '')}</div>
      </div>
      <div class="contact-meta">
        <span class="contact-time">${esc(c.time)}</span>
        ${c.unread ? '<span class="unread-badge">●</span>' : ''}
      </div>
    </div>`).join('');
}

function showSidebarEmpty(message, showConnectBtn) {
  document.getElementById('contact-list').innerHTML = `
    <div class="sidebar-empty">
      <p>${message}</p>
      ${showConnectBtn ? '<button class="btn-connect" onclick="openSettings()">Gmailに接続する</button>' : ''}
    </div>`;
}

function filterContacts(query) {
  const q = query.trim().toLowerCase();
  document.querySelectorAll('#contact-list .contact-item').forEach(el => {
    const i = parseInt(el.dataset.index, 10);
    const c = contacts[i];
    const match = !q || c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q) || c.subject.toLowerCase().includes(q);
    el.style.display = match ? '' : 'none';
  });
}

// ===== SELECT CONTACT =====
async function selectContact(index) {
  currentContact = contacts[index];

  const c = currentContact;
  const color = emailToColor(c.email);
  document.getElementById('header-avatar').textContent = (c.name[0] || '?').toUpperCase();
  document.getElementById('header-avatar').style.background = color;
  document.getElementById('header-name').textContent = c.name;
  document.getElementById('header-email').textContent = c.email;

  document.querySelectorAll('#contact-list .contact-item').forEach(el => {
    el.classList.toggle('active', parseInt(el.dataset.index, 10) === index);
  });

  const msgs = document.getElementById('messages');
  msgs.innerHTML = '<div style="text-align:center;padding:40px;color:#aaa;font-size:13px">読み込み中...</div>';

  const result = await window.electronAPI.gmail.fetchMessages(c.threadId);
  if (result.ok) {
    renderMessages(result.messages);
  } else {
    msgs.innerHTML = `<div style="text-align:center;padding:40px;color:#e8605a;font-size:13px">読み込みエラー: ${esc(result.error)}</div>`;
  }

  resetCompose();
  updateTemplateBlocks();
}

function renderMessages(messages) {
  const msgs = document.getElementById('messages');
  msgs.innerHTML = '';

  messages.forEach(m => {
    if (m.date) {
      const div = document.createElement('div');
      div.className = 'date-divider';
      div.textContent = m.date;
      msgs.appendChild(div);
    }
    const group = document.createElement('div');
    group.className = `message-group ${m.type}`;
    group.innerHTML = `<div class="bubble">${esc(m.text)}</div><div class="message-time">${esc(m.time)}</div>`;
    msgs.appendChild(group);
  });

  msgs.scrollTop = msgs.scrollHeight;
}

function appendSentMessage(text) {
  const msgs = document.getElementById('messages');
  const now = new Date();
  const time = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
  const group = document.createElement('div');
  group.className = 'message-group sent';
  group.innerHTML = `<div class="bubble">${esc(text)}</div><div class="message-time">${time}</div>`;
  msgs.appendChild(group);
  msgs.scrollTop = msgs.scrollHeight;
}

// ===== TEMPLATE BLOCKS =====
function updateTemplateBlocks() {
  if (!currentContact) return;
  const greeting = getGreeting(currentContact.email);
  const greetingEl = document.getElementById('template-greeting');
  greetingEl.textContent = greeting;
  greetingEl.classList.toggle('hidden', !greeting);
  updateSigVisual();
}

function updateSigVisual() {
  const sigEl = document.getElementById('template-signature');
  const sigText = document.getElementById('sig-text');
  sigText.textContent = globalSignature;
  sigEl.classList.toggle('hidden', !globalSignature);
  sigText.style.opacity = document.getElementById('sig-checkbox').checked ? '1' : '0.35';
}

// ===== COMPOSE =====
function onInputChange(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 140) + 'px';
  const hasText = el.value.trim().length > 0;
  document.getElementById('tone-buttons').classList.toggle('visible', hasText);
  document.getElementById('btn-ai').textContent = hasText ? '✦ 整える' : '✦ AIに書かせる';
}

function onKeyDown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function enableCompose() {
  document.getElementById('compose-input').disabled = false;
}

function getApiKey() {
  return localStorage.getItem('chatmail_apikey') || '';
}

async function callClaude(system, userMsg) {
  const key = getApiKey();
  if (!key) { alert('設定画面でClaude APIキーを入力してください。'); return null; }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system,
      messages: [{ role: 'user', content: userMsg }]
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    alert('APIエラー: ' + (err.error?.message || res.status));
    return null;
  }
  const data = await res.json();
  return data.content[0].text.trim();
}

async function triggerAI() {
  if (!currentContact) return;
  const input = document.getElementById('compose-input');
  hideSuggestion();
  document.getElementById('ai-loading').classList.add('visible');

  try {
    let result;
    if (input.value.trim()) {
      result = await callClaude(
        'あなたはビジネスメールの文章を整えるアシスタントです。与えられた文章を自然で適切な日本語ビジネスメール本文に整えてください。冒頭の挨拶や署名は含めず、本文のみを返してください。',
        input.value.trim()
      );
    } else {
      result = await callClaude(
        'あなたはビジネスメールの返信を書くアシスタントです。相手の情報をもとに、自然で適切な返信本文のみを日本語で書いてください。冒頭の挨拶や署名は不要です。',
        `相手：${currentContact.name}（${currentContact.email}）\n件名：${currentContact.subject}\n\n返信文を書いてください。`
      );
    }
    if (result) {
      document.getElementById('ai-suggestion-text').textContent = result;
      document.getElementById('ai-suggestion').classList.add('visible');
    }
  } finally {
    document.getElementById('ai-loading').classList.remove('visible');
  }
}

async function adjustTone(tone) {
  const input = document.getElementById('compose-input');
  if (!input.value.trim()) return;
  hideSuggestion();
  document.getElementById('ai-loading').classList.add('visible');

  const toneMap = { '丁寧に': '丁寧でフォーマルなビジネス文体', 'フランクに': 'フランクで親しみやすい文体', '短く': 'できるだけ短く簡潔な文体' };
  try {
    const result = await callClaude(
      `あなたはメール文章のトーンを調整するアシスタントです。与えられたテキストを「${toneMap[tone]}」で書き直してください。本文のみを返してください。`,
      input.value.trim()
    );
    if (result) {
      document.getElementById('ai-suggestion-text').textContent = result;
      document.getElementById('ai-suggestion').classList.add('visible');
    }
  } finally {
    document.getElementById('ai-loading').classList.remove('visible');
  }
}

function adoptSuggestion() {
  document.getElementById('compose-input').value = document.getElementById('ai-suggestion-text').textContent;
  onInputChange(document.getElementById('compose-input'));
  hideSuggestion();
  document.getElementById('compose-input').focus();
}

function discardSuggestion() { hideSuggestion(); }
function hideSuggestion() { document.getElementById('ai-suggestion').classList.remove('visible'); }

async function sendMessage() {
  if (!currentContact) return;
  const input = document.getElementById('compose-input');
  const body = input.value.trim();
  if (!body) return;

  const greeting = getGreeting(currentContact.email);
  const sigOn = document.getElementById('sig-checkbox').checked;
  const fullText = [
    greeting,
    body,
    sigOn && globalSignature ? '\n' + globalSignature : ''
  ].join('').trim();

  if (gmailConnected) {
    const result = await window.electronAPI.gmail.send({
      to: currentContact.email,
      subject: currentContact.subject,
      body: fullText,
      threadId: currentContact.threadId,
    });
    if (!result.ok) {
      alert('送信エラー: ' + result.error);
      return;
    }
  }

  appendSentMessage(fullText);
  input.value = '';
  onInputChange(input);
  hideSuggestion();
}

function resetCompose() {
  const input = document.getElementById('compose-input');
  input.value = '';
  input.style.height = 'auto';
  document.getElementById('tone-buttons').classList.remove('visible');
  document.getElementById('btn-ai').textContent = '✦ AIに書かせる';
  hideSuggestion();
  document.getElementById('ai-loading').classList.remove('visible');
  document.getElementById('sig-checkbox').checked = true;
}

// ===== SETTINGS =====
function openSettings() {
  window.electronAPI.gmail.getConfig().then(cfg => {
    document.getElementById('modal-client-id').value = cfg.clientId || '';
    document.getElementById('modal-client-secret').value = '';
    updateGmailStatus(cfg.isAuthenticated);
  });

  if (currentContact) {
    document.getElementById('greeting-section').style.display = 'block';
    document.getElementById('greeting-label').textContent = currentContact.name + ' への冒頭文';
    document.getElementById('modal-greeting').value = getGreeting(currentContact.email);
  } else {
    document.getElementById('greeting-section').style.display = 'none';
  }

  document.getElementById('modal-signature').value = globalSignature;
  const savedKey = getApiKey();
  document.getElementById('modal-apikey').value = savedKey;
  document.getElementById('apikey-status').textContent = savedKey ? '✓ 設定済み' : '';
  document.getElementById('apikey-status').className = 'api-key-status' + (savedKey ? ' ok' : '');

  document.getElementById('modal-overlay').classList.add('visible');
}

function closeSettings(e) {
  if (e && e.target !== document.getElementById('modal-overlay')) return;
  document.getElementById('modal-overlay').classList.remove('visible');
}

function updateGmailStatus(connected) {
  gmailConnected = connected;
  const status = document.getElementById('gmail-status');
  const connectBtn = document.getElementById('btn-gmail-connect');
  const signoutBtn = document.getElementById('btn-gmail-signout');
  if (connected) {
    status.textContent = '✓ Gmail に接続済み';
    status.className = 'api-key-status ok';
    connectBtn.textContent = '再接続';
    signoutBtn.style.display = '';
  } else {
    status.textContent = '未接続';
    status.className = 'api-key-status';
    connectBtn.textContent = 'Gmail に接続';
    signoutBtn.style.display = 'none';
  }
}

async function connectGmail() {
  const clientId = document.getElementById('modal-client-id').value.trim();
  const clientSecret = document.getElementById('modal-client-secret').value.trim();

  if (!clientId || !clientSecret) {
    alert('Client ID と Client Secret を入力してください。');
    return;
  }

  await window.electronAPI.gmail.saveConfig({ clientId, clientSecret });

  const status = document.getElementById('gmail-status');
  status.textContent = 'ブラウザで認証中...';
  status.className = 'api-key-status';

  const result = await window.electronAPI.gmail.authenticate();
  if (result.ok) {
    updateGmailStatus(true);
    closeSettings();
    await loadInbox();
  } else {
    status.textContent = 'エラー: ' + result.error;
    status.className = 'api-key-status err';
  }
}

async function signoutGmail() {
  await window.electronAPI.gmail.signout();
  updateGmailStatus(false);
  contacts = [];
  currentContact = null;
  renderContactList();
  showSidebarEmpty('Gmail に接続すると受信トレイが表示されます。', true);
}

async function reloadInbox() {
  closeSettings();
  await loadInbox();
}

function openGCPHelp() {
  window.electronAPI.openExternal('https://console.cloud.google.com/apis/credentials');
}

async function saveSettings() {
  globalSignature = document.getElementById('modal-signature').value;
  localStorage.setItem('chatmail_signature', globalSignature);

  if (currentContact) {
    setGreeting(currentContact.email, document.getElementById('modal-greeting').value);
  }

  const apiKey = document.getElementById('modal-apikey').value.trim();
  if (apiKey) localStorage.setItem('chatmail_apikey', apiKey);

  const clientId = document.getElementById('modal-client-id').value.trim();
  const clientSecret = document.getElementById('modal-client-secret').value.trim();
  if (clientId && clientSecret) {
    await window.electronAPI.gmail.saveConfig({ clientId, clientSecret });
  } else if (clientId) {
    await window.electronAPI.gmail.saveConfig({ clientId });
  }

  document.getElementById('modal-overlay').classList.remove('visible');
  updateTemplateBlocks();
}

// ===== GMAIL DATA LOADING =====
async function loadInbox() {
  showSidebarEmpty('受信トレイを読み込み中...', false);

  const result = await window.electronAPI.gmail.fetchThreads();
  if (!result.ok) {
    showSidebarEmpty('読み込みエラー: ' + result.error, false);
    return;
  }

  contacts = result.contacts;
  renderContactList();

  if (contacts.length > 0) {
    enableCompose();
    await selectContact(0);
  }
}

// ===== UTIL =====
function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ===== INIT =====
async function init() {
  const cfg = await window.electronAPI.gmail.getConfig();
  gmailConnected = cfg.isAuthenticated;

  if (gmailConnected) {
    await loadInbox();
  } else {
    showSidebarEmpty('Gmail に接続すると受信トレイが表示されます。', true);
  }
}

init();
