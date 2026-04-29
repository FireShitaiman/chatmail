// ===== ADDRESS BOOK =====
let addressBook = JSON.parse(localStorage.getItem('chatmail_address_book') || '[]');
let acActiveInput = null;
let acActiveIndex = -1;

function saveAddressBook() {
  localStorage.setItem('chatmail_address_book', JSON.stringify(addressBook));
}

function addToAddressBook(name, email) {
  if (!email) return;
  const key = email.toLowerCase();
  const idx = addressBook.findIndex(e => e.email.toLowerCase() === key);
  if (idx === -1) {
    addressBook.push({ name: name || email, email });
  } else if (name && name !== email) {
    addressBook[idx].name = name;
  }
}

function parseLastToken(value) {
  const parts = value.split(',');
  return parts[parts.length - 1].trim();
}

function replaceLastToken(value, replacement) {
  const parts = value.split(',');
  parts[parts.length - 1] = replacement;
  return parts.map(p => p.trim()).filter(Boolean).join(', ') + ', ';
}

function onAddressInput(inputEl) {
  const token = parseLastToken(inputEl.value);
  if (!token) { hideSuggestions(); return; }
  const q = token.toLowerCase();
  const matches = addressBook
    .filter(e => e.email.toLowerCase().includes(q) || (e.name && e.name.toLowerCase().includes(q)))
    .slice(0, 8);

  if (matches.length === 0) { hideSuggestions(); return; }

  acActiveInput = inputEl;
  acActiveIndex = -1;

  const dropdown = document.getElementById('addr-dropdown');
  dropdown.innerHTML = matches.map((e, i) =>
    `<div class="addr-option" data-email="${esc(e.email)}" data-name="${esc(e.name)}"
      onmousedown="selectSuggestion(this)"
      onmouseover="acActiveIndex=${i};highlightSuggestion()">
      <span class="addr-option-name">${esc(e.name)}</span>
      <span class="addr-option-email">${esc(e.email)}</span>
    </div>`
  ).join('');

  const rect = inputEl.getBoundingClientRect();
  dropdown.style.top = (rect.bottom + 2) + 'px';
  dropdown.style.left = rect.left + 'px';
  dropdown.style.width = Math.max(rect.width, 280) + 'px';
  dropdown.classList.add('visible');
}

function onAddressKeydown(e, inputEl) {
  const dropdown = document.getElementById('addr-dropdown');
  if (!dropdown.classList.contains('visible')) return;
  const items = dropdown.querySelectorAll('.addr-option');
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    acActiveIndex = Math.min(acActiveIndex + 1, items.length - 1);
    highlightSuggestion();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    acActiveIndex = Math.max(acActiveIndex - 1, -1);
    highlightSuggestion();
  } else if (e.key === 'Enter' && acActiveIndex >= 0) {
    e.preventDefault();
    const active = items[acActiveIndex];
    if (active) selectSuggestion(active);
  } else if (e.key === 'Escape') {
    hideSuggestions();
  }
}

function highlightSuggestion() {
  document.querySelectorAll('#addr-dropdown .addr-option').forEach((el, i) => {
    el.classList.toggle('active', i === acActiveIndex);
  });
}

function selectSuggestion(el) {
  if (!acActiveInput) return;
  acActiveInput.value = replaceLastToken(acActiveInput.value, el.dataset.email);
  hideSuggestions();
  acActiveInput.focus();
}

function hideSuggestions() {
  document.getElementById('addr-dropdown').classList.remove('visible');
  acActiveInput = null;
  acActiveIndex = -1;
}

// ===== BLOCKLIST =====
function getBlocklist() {
  return JSON.parse(localStorage.getItem('chatmail_blocklist') || '[]');
}
function saveBlocklist(list) {
  localStorage.setItem('chatmail_blocklist', JSON.stringify(list));
}
function addToBlocklist(email) {
  const list = getBlocklist();
  const key = email.toLowerCase();
  if (!list.includes(key)) { list.push(key); saveBlocklist(list); }
}

// ===== STATE =====
let contacts = [];
let currentContact = null;
let gmailConnected = false;
let currentView = 'inbox'; // 'inbox' | 'trash'
let globalSignature = localStorage.getItem('chatmail_signature') || '';
let autoFilterEnabled = localStorage.getItem('chatmail_auto_filter') !== 'false';
let myEmail = '';
let replyAttachments = [];
let newMailAttachments = [];
let nextPageToken = null;
let isLoadingMore = false;

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
        <div class="contact-name">${esc(c.name)}${c.isSpam ? ' <span class="spam-badge">迷惑</span>' : ''}</div>
        <div class="contact-preview">${esc(c.preview || c.subject || '')}</div>
      </div>
      <div class="contact-meta">
        <span class="contact-time">${esc(c.time)}</span>
        ${c.unread ? '<span class="unread-badge">●</span>' : ''}
      </div>
      <div class="contact-actions" onclick="event.stopPropagation()">
        ${currentView === 'trash'
          ? `<button class="contact-action-btn" title="受信トレイに戻す" onclick="restoreThread('${esc(c.threadId)}',${i},'${esc(c.email)}')">${getBlocklist().includes(c.email.toLowerCase()) ? '🔓 解除して戻す' : '戻す'}</button>`
          : `${!c.unread ? `<button class="contact-action-btn unread" title="未読にする" onclick="markUnread('${esc(c.threadId)}',${i})">未読</button>` : ''}
             <button class="contact-action-btn block-trash" title="ブロックしてゴミ箱へ" onclick="blockAndTrash('${esc(c.threadId)}',${i},'${esc(c.email)}')">🚫</button>
             <button class="contact-action-btn trash" title="ゴミ箱へ" onclick="trashThread('${esc(c.threadId)}',${i})">🗑</button>`
        }
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

async function markRead(threadId) {
  if (!gmailConnected) return;
  await window.electronAPI.gmail.markRead({ threadId });
}

async function markUnread(threadId, index) {
  if (!gmailConnected) return;
  const result = await window.electronAPI.gmail.markUnread({ threadId });
  if (result.ok) {
    contacts[index].unread = true;
    renderContactList();
  }
}

async function restoreThread(threadId, index, email) {
  if (!gmailConnected) return;
  const result = await window.electronAPI.gmail.restoreThread({ threadId });
  if (!result.ok) { alert('復元エラー: ' + result.error); return; }
  // ブロックリストにあれば自動解除（戻したのにすぐ再ゴミ箱されないように）
  if (email) {
    const list = getBlocklist().filter(e => e !== email.toLowerCase());
    saveBlocklist(list);
    updateBlocklistInfo();
  }
  showToast('受信トレイに戻しました');
  await switchView('inbox');
}

async function blockAndTrash(threadId, index, email) {
  if (!gmailConnected) return;
  addToBlocklist(email);
  await trashThread(threadId, index);
  showToast(`${email} をブロックしてゴミ箱へ移動しました`);
}

async function trashThread(threadId, index) {
  if (!gmailConnected) return;
  const result = await window.electronAPI.gmail.trashThread({ threadId });
  if (!result.ok) { alert('削除エラー: ' + result.error); return; }
  const wasSelected = currentContact?.threadId === threadId;
  contacts.splice(index, 1);
  if (wasSelected) {
    currentContact = null;
    document.getElementById('messages').innerHTML = '';
    document.getElementById('header-name').textContent = 'Chatmail';
    document.getElementById('header-email').textContent = '左のリストから相手を選択';
    resetCompose();
  }
  renderContactList();
  if (contacts.length === 0) showSidebarEmpty('受信トレイが空です。', false);
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

  // 自動既読（ゴミ箱ビューでは不要）
  if (currentView === 'inbox' && c.unread) {
    c.unread = false;
    renderContactList();
    markRead(c.threadId);
  }



  resetCompose();
  updateTemplateBlocks();

  if (result.ok && result.threadCC) {
    document.getElementById('reply-cc-text').textContent = result.threadCC;
    document.getElementById('reply-cc-checkbox').checked = true;
    document.getElementById('reply-cc-row').classList.remove('hidden');
  }
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
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

    const atts = m.attachments && m.attachments.length > 0
      ? `<div class="msg-attachments${m.text ? ' has-text' : ''}">${
          m.attachments.map(att => {
            if (att.mimeType && att.mimeType.startsWith('image/')) {
              return `<img class="inline-img"
                data-msg="${esc(m.messageId)}"
                data-att="${esc(att.attachmentId)}"
                data-mime="${esc(att.mimeType)}"
                data-name="${esc(att.name)}"
                alt="${esc(att.name)}"
                onclick="openAttachment(this)">`;
            }
            return `<button class="msg-attachment-btn"
              data-msg="${esc(m.messageId)}"
              data-att="${esc(att.attachmentId)}"
              data-name="${esc(att.name)}"
              onclick="openAttachment(this)">
              &#128206; <span>${esc(att.name)}</span>${att.size ? `<em>${formatFileSize(att.size)}</em>` : ''}
            </button>`;
          }).join('')
        }</div>`
      : '';

    group.innerHTML = `<div class="bubble">${esc(m.text)}${atts}</div><div class="message-time">${esc(m.time)}</div>`;
    msgs.appendChild(group);
  });

  msgs.scrollTop = msgs.scrollHeight;
  loadInlineImages();
}

async function loadInlineImages() {
  const imgs = Array.from(document.querySelectorAll('#messages .inline-img:not([src])'));
  await Promise.all(imgs.map(async img => {
    const result = await window.electronAPI.gmail.getAttachmentData({
      messageId: img.dataset.msg,
      attachmentId: img.dataset.att,
    });
    if (result.ok) {
      img.src = `data:${img.dataset.mime};base64,${result.data}`;
    }
  }));
}

async function openAttachment(btn) {
  const result = await window.electronAPI.gmail.getAttachment({
    messageId: btn.dataset.msg,
    attachmentId: btn.dataset.att,
    filename: btn.dataset.name,
  });
  if (!result.ok) alert('添付ファイルを開けませんでした: ' + result.error);
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
  greetingEl.classList.toggle('hidden', !greeting);
  if (greeting) {
    document.getElementById('greeting-text').textContent = greeting;
    document.getElementById('greeting-checkbox').checked = true;
    updateGreetingVisual();
  }
  updateSigVisual();
}

function updateGreetingVisual() {
  const text = document.getElementById('greeting-text');
  text.style.opacity = document.getElementById('greeting-checkbox').checked ? '1' : '0.35';
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
  const greetingOn = document.getElementById('greeting-checkbox').checked;
  const sigOn = document.getElementById('sig-checkbox').checked;
  const fullText = [
    greetingOn && greeting ? greeting : '',
    body,
    sigOn && globalSignature ? '\n' + globalSignature : ''
  ].filter(Boolean).join('').trim();

  if (gmailConnected) {
    const ccRow = document.getElementById('reply-cc-row');
    const replyCC = !ccRow.classList.contains('hidden') && document.getElementById('reply-cc-checkbox').checked
      ? document.getElementById('reply-cc-text').textContent.trim()
      : '';
    const result = await window.electronAPI.gmail.send({
      to: currentContact.email,
      cc: replyCC,
      subject: currentContact.subject,
      body: fullText,
      threadId: currentContact.threadId,
      attachments: replyAttachments,
    });
    if (!result.ok) {
      alert('送信エラー: ' + result.error);
      return;
    }

    const refreshed = await window.electronAPI.gmail.fetchMessages(currentContact.threadId);
    if (refreshed.ok) {
      renderMessages(refreshed.messages);
    } else {
      appendSentMessage(fullText);
    }
    replyAttachments = [];
    renderAttachmentList('reply');
  } else {
    appendSentMessage(fullText);
  }

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
  document.getElementById('greeting-checkbox').checked = true;
  replyAttachments = [];
  renderAttachmentList('reply');
  document.getElementById('reply-cc-row').classList.add('hidden');
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

  document.getElementById('modal-auto-filter').checked = autoFilterEnabled;
  updateBlocklistInfo();

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

  autoFilterEnabled = document.getElementById('modal-auto-filter').checked;
  localStorage.setItem('chatmail_auto_filter', autoFilterEnabled ? 'true' : 'false');

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

// ===== NEW MAIL COMPOSE =====
function openCompose() {
  document.getElementById('compose-to').value = '';
  document.getElementById('compose-cc').value = '';
  document.getElementById('compose-bcc').value = '';
  document.getElementById('compose-subject').value = '';
  document.getElementById('compose-body').value = '';
  document.getElementById('compose-cc-row').style.display = 'none';
  document.getElementById('compose-bcc-row').style.display = 'none';
  document.getElementById('compose-cc-toggle').style.display = '';
  document.getElementById('compose-send-btn').disabled = false;
  document.getElementById('compose-send-btn').textContent = '送信';

  const sigText = document.getElementById('compose-sig-text');
  const sigBlock = document.getElementById('compose-sig-block');
  sigText.textContent = globalSignature;
  sigBlock.classList.toggle('hidden', !globalSignature);
  document.getElementById('compose-sig-checkbox').checked = true;
  updateComposeSig();

  newMailAttachments = [];
  renderAttachmentList('compose');
  document.getElementById('compose-overlay').classList.add('visible');
  setTimeout(() => document.getElementById('compose-to').focus(), 50);
}

function updateComposeSig() {
  document.getElementById('compose-sig-text').style.opacity =
    document.getElementById('compose-sig-checkbox').checked ? '1' : '0.35';
}

function closeCompose(e) {
  if (e && e.target !== document.getElementById('compose-overlay')) return;
  document.getElementById('compose-overlay').classList.remove('visible');
  hideSuggestions();
}

function toggleComposeCc() {
  document.getElementById('compose-cc-row').style.display = '';
  document.getElementById('compose-bcc-row').style.display = '';
  document.getElementById('compose-cc-toggle').style.display = 'none';
  document.getElementById('compose-cc').focus();
}

async function sendNewMail() {
  const to      = document.getElementById('compose-to').value.trim();
  const cc      = document.getElementById('compose-cc').value.trim();
  const bcc     = document.getElementById('compose-bcc').value.trim();
  const subject = document.getElementById('compose-subject').value.trim();
  const body    = document.getElementById('compose-body').value.trim();

  if (!to)      { alert('宛先を入力してください。'); return; }
  if (!subject) { alert('件名を入力してください。'); return; }
  if (!body)    { alert('本文を入力してください。'); return; }

  const btn = document.getElementById('compose-send-btn');
  btn.disabled = true;
  btn.textContent = '送信中...';

  const sigOn = document.getElementById('compose-sig-checkbox').checked;
  const sig = document.getElementById('compose-sig-text').textContent;
  const fullBody = sigOn && sig ? body + '\n\n' + sig : body;

  const result = await window.electronAPI.gmail.send({ to, cc, bcc, subject, body: fullBody, attachments: newMailAttachments });
  if (result.ok) {
    [to, cc, bcc].forEach(field => {
      if (!field) return;
      field.split(',').forEach(addr => { addr = addr.trim(); if (addr) addToAddressBook(addr, addr); });
    });
    saveAddressBook();
    document.getElementById('compose-overlay').classList.remove('visible');
    await refreshInboxSilently();

    // 送信したスレッドをサイドバーで選択・表示
    const sentThreadId = result.threadId;
    let idx = contacts.findIndex(c => c.threadId === sentThreadId);
    if (idx === -1) {
      // 受信トレイにない（新規送信）場合は先頭に仮エントリを追加
      const now = new Date();
      const time = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
      contacts.unshift({ threadId: sentThreadId, name: to, email: to, subject, preview: subject, time, unread: false });
      renderContactList();
      idx = 0;
    }
    await selectContact(idx);
  } else {
    alert('送信エラー: ' + result.error);
    btn.disabled = false;
    btn.textContent = '送信';
  }
}

// ===== GMAIL DATA LOADING =====
async function refreshInboxSilently() {
  if (!gmailConnected) return;
  const indicator = document.getElementById('refresh-indicator');
  indicator.classList.add('spinning');
  try {
    const result = await window.electronAPI.gmail.fetchThreads();
    if (!result.ok) return;
    const prevThreadId = currentContact?.threadId;
    contacts = result.contacts;
    nextPageToken = result.nextPageToken;
    contacts.forEach(c => addToAddressBook(c.name, c.email));
    saveAddressBook();

    // 自動フィルター: ブロックリスト対象を自動ゴミ箱
    if (autoFilterEnabled) {
      const blocklist = getBlocklist();
      const autoTrash = contacts.filter(c => blocklist.includes(c.email.toLowerCase()));
      if (autoTrash.length > 0) {
        autoTrash.forEach(c => window.electronAPI.gmail.trashThread({ threadId: c.threadId }));
        const autoIds = new Set(autoTrash.map(c => c.threadId));
        contacts = contacts.filter(c => !autoIds.has(c.threadId));
        if (currentContact && autoIds.has(currentContact.threadId)) {
          currentContact = null;
          document.getElementById('messages').innerHTML = '';
          document.getElementById('header-name').textContent = 'Chatmail';
          document.getElementById('header-email').textContent = '左のリストから相手を選択';
          resetCompose();
        }
        showToast(`${autoTrash.length}件を自動でゴミ箱に移動しました`);
      }
    }

    if (prevThreadId) {
      const updated = contacts.find(c => c.threadId === prevThreadId);
      if (updated) currentContact = updated;
    }
    renderContactList();
  } finally {
    indicator.classList.remove('spinning');
  }
}

async function loadInbox() {
  showSidebarEmpty('受信トレイを読み込み中...', false);

  const result = await window.electronAPI.gmail.fetchThreads();
  if (!result.ok) {
    showSidebarEmpty('読み込みエラー: ' + result.error, false);
    return;
  }

  contacts = result.contacts;
  nextPageToken = result.nextPageToken;
  contacts.forEach(c => addToAddressBook(c.name, c.email));
  saveAddressBook();
  renderContactList();

  if (contacts.length > 0) {
    enableCompose();
    await selectContact(0);
  }
}

async function loadMoreThreads() {
  if (!gmailConnected || !nextPageToken || isLoadingMore) return;
  isLoadingMore = true;
  const list = document.getElementById('contact-list');
  const loader = document.createElement('div');
  loader.id = 'load-more-indicator';
  loader.textContent = '読み込み中...';
  loader.style.cssText = 'text-align:center;padding:12px;font-size:12px;color:#aaa';
  list.appendChild(loader);

  try {
    const fetch = currentView === 'inbox'
      ? window.electronAPI.gmail.fetchThreads({ pageToken: nextPageToken })
      : window.electronAPI.gmail.fetchTrash({ pageToken: nextPageToken });
    const result = await fetch;
    if (result.ok) {
      nextPageToken = result.nextPageToken;
      result.contacts.forEach(c => {
        if (!contacts.some(e => e.threadId === c.threadId)) contacts.push(c);
        if (currentView === 'inbox') addToAddressBook(c.name, c.email);
      });
      if (currentView === 'inbox') saveAddressBook();
      renderContactList();
    }
  } finally {
    isLoadingMore = false;
    document.getElementById('load-more-indicator')?.remove();
  }
}

// ===== ATTACHMENTS =====
function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve({
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      data: e.target.result.split(',')[1],
    });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function addFilesToList(files, target) {
  const list = target === 'reply' ? replyAttachments : newMailAttachments;
  for (const file of files) {
    if (file.size > 25 * 1024 * 1024) {
      alert(`${file.name} は25MBを超えているため添付できません。`);
      continue;
    }
    list.push(await readFileAsBase64(file));
  }
  renderAttachmentList(target);
}

function removeAttachment(target, index) {
  (target === 'reply' ? replyAttachments : newMailAttachments).splice(index, 1);
  renderAttachmentList(target);
}

function renderAttachmentList(target) {
  const el = document.getElementById(target === 'reply' ? 'reply-attachment-list' : 'compose-attachment-list');
  if (!el) return;
  const list = target === 'reply' ? replyAttachments : newMailAttachments;
  if (list.length === 0) { el.innerHTML = ''; el.style.display = 'none'; return; }
  el.style.display = 'flex';
  el.innerHTML = list.map((att, i) =>
    `<div class="attachment-chip">
      <span class="attachment-name">${esc(att.name)}</span>
      <button class="attachment-remove" onclick="removeAttachment('${target}',${i})" title="削除">&#10005;</button>
    </div>`
  ).join('');
}

function handleFileInputChange(event, target) {
  addFilesToList(Array.from(event.target.files), target);
  event.target.value = '';
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

// ===== TOAST =====
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('visible');
  setTimeout(() => el.classList.remove('visible'), 3000);
}

// ===== FILTER =====
const SPAM_SENDER_KEYWORDS = [
  'noreply', 'no-reply', 'newsletter', 'mailer', 'campaign', 'promo',
  'marketing', 'bulk', 'donotreply', 'do-not-reply', 'mail-service', 'mailing',
];
const SPAM_SUBJECT_PATTERNS = [
  /ポイント\d*倍/, /【[^】]*セール[^】]*】/, /【[^】]*限定[^】]*】/,
  /【[^】]*キャンペーン[^】]*】/, /\d+%OFF/i, /メールマガジン/,
  /配信停止/, /購読解除/, /お得な情報/, /\bUnsubscribe\b/i,
];

function isSpamByRules(contact) {
  const emailLower = contact.email.toLowerCase();
  if (SPAM_SENDER_KEYWORDS.some(k => emailLower.includes(k))) return true;
  if (SPAM_SUBJECT_PATTERNS.some(p => p.test(contact.subject || ''))) return true;
  return false;
}

async function detectSpamWithClaude(candidates) {
  if (!candidates.length) return [];
  const key = getApiKey();
  if (!key) return candidates.map(() => false);

  const list = candidates.map((c, i) => ({
    id: i, from: c.email, subject: c.subject || '', snippet: c.snippet || '',
  }));
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        system: '受信トレイのメールを分析し、広告・ニュースレター・プロモーション・不要な一斉送信メール（楽天・リクルート等のマーケティングメール含む）を特定してください。JSON配列（true/false）のみを返してください。例: [true, false, true]',
        messages: [{ role: 'user', content: JSON.stringify(list) }],
      }),
    });
    if (!res.ok) return candidates.map(() => false);
    const data = await res.json();
    const flags = JSON.parse(data.content[0].text.match(/\[[\s\S]*?\]/)[0]);
    return candidates.map((_, i) => !!flags[i]);
  } catch {
    return candidates.map(() => false);
  }
}

let filterCandidates = [];

async function scanFilter() {
  if (!gmailConnected || currentView !== 'inbox') return;
  const btn = document.getElementById('btn-filter-scan');
  btn.disabled = true;
  btn.textContent = '🤖 スキャン中...';
  try {
    const blocklist = getBlocklist();
    const notBlocked = contacts.filter(c => !blocklist.includes(c.email.toLowerCase()));

    const ruleCandidates = notBlocked
      .filter(c => isSpamByRules(c))
      .map(c => ({ ...c, reason: 'ルール検出' }));
    const ruleIds = new Set(ruleCandidates.map(c => c.threadId));
    const remaining = notBlocked.filter(c => !ruleIds.has(c.threadId));

    let aiCandidates = [];
    if (getApiKey() && remaining.length > 0) {
      const flags = await detectSpamWithClaude(remaining);
      aiCandidates = remaining
        .filter((_, i) => flags[i])
        .map(c => ({ ...c, reason: 'AI判定' }));
    }

    filterCandidates = [...ruleCandidates, ...aiCandidates];
    openFilterModal(filterCandidates);
  } finally {
    btn.disabled = false;
    btn.textContent = '🤖 広告・不要メールを探す';
  }
}

function openFilterModal(candidates) {
  const list = document.getElementById('filter-list');
  const applyBtn = document.getElementById('btn-apply-filter');
  document.getElementById('filter-modal-title').textContent =
    candidates.length > 0 ? `不要メールの候補 (${candidates.length}件)` : '不要メールの候補';

  if (candidates.length === 0) {
    list.innerHTML = '<div class="filter-empty">不要なメールは見つかりませんでした。</div>';
    applyBtn.style.display = 'none';
  } else {
    applyBtn.style.display = '';
    list.innerHTML = candidates.map((c, i) => `
      <div class="filter-item">
        <input type="checkbox" class="filter-check" id="fc-${i}" checked data-index="${i}">
        <label for="fc-${i}" class="filter-item-info">
          <div class="filter-item-name">${esc(c.name || c.email)}</div>
          <div class="filter-item-subject">${esc(c.subject || '（件名なし）')}</div>
          <span class="filter-item-reason">${esc(c.reason)}</span>
        </label>
      </div>`).join('');
    updateFilterBtn();
    list.querySelectorAll('.filter-check').forEach(cb => cb.addEventListener('change', updateFilterBtn));
  }
  document.getElementById('filter-overlay').classList.add('visible');
}

function updateFilterBtn() {
  const checked = document.querySelectorAll('#filter-list .filter-check:checked').length;
  const btn = document.getElementById('btn-apply-filter');
  btn.textContent = checked > 0 ? `ゴミ箱へ移動 (${checked}件)` : 'ゴミ箱へ移動';
  btn.disabled = checked === 0;
}

function closeFilterModal(e) {
  if (e && e.target !== document.getElementById('filter-overlay')) return;
  document.getElementById('filter-overlay').classList.remove('visible');
}

async function applyFilter() {
  const checked = Array.from(document.querySelectorAll('#filter-list .filter-check:checked'));
  if (checked.length === 0) return;
  const btn = document.getElementById('btn-apply-filter');
  btn.disabled = true;
  btn.textContent = '処理中...';

  const toTrash = checked.map(cb => filterCandidates[parseInt(cb.dataset.index, 10)]);
  for (const c of toTrash) {
    addToBlocklist(c.email);
    await window.electronAPI.gmail.trashThread({ threadId: c.threadId });
    const idx = contacts.findIndex(x => x.threadId === c.threadId);
    if (idx !== -1) contacts.splice(idx, 1);
    if (currentContact?.threadId === c.threadId) {
      currentContact = null;
      document.getElementById('messages').innerHTML = '';
      document.getElementById('header-name').textContent = 'Chatmail';
      document.getElementById('header-email').textContent = '左のリストから相手を選択';
      resetCompose();
    }
  }

  renderContactList();
  if (contacts.length === 0) showSidebarEmpty('受信トレイが空です。', false);
  closeFilterModal();
  showToast(`${toTrash.length}件をゴミ箱に移動しました`);
}

function clearBlocklist() {
  if (!confirm('ブロックリストをリセットしますか？\n次回から自動フィルターが効かなくなります。')) return;
  saveBlocklist([]);
  updateBlocklistInfo();
  showToast('ブロックリストをリセットしました');
}

function updateBlocklistInfo() {
  const countEl = document.getElementById('blocklist-count');
  if (countEl) countEl.textContent = getBlocklist().length;
  renderBlocklistEntries();
}

function renderBlocklistEntries() {
  const el = document.getElementById('blocklist-entries');
  if (!el) return;
  const list = getBlocklist();
  if (list.length === 0) {
    el.innerHTML = '<div style="font-size:12px;color:#aaa;padding:4px 0">ブロック中の送信者はいません</div>';
    return;
  }
  el.innerHTML = list.map(email => `
    <div class="blocklist-entry">
      <span class="blocklist-email">${esc(email)}</span>
      <button class="blocklist-remove" onclick="removeFromBlocklist('${esc(email)}')" title="ブロック解除">✕</button>
    </div>`).join('');
}

function removeFromBlocklist(email) {
  const list = getBlocklist().filter(e => e !== email);
  saveBlocklist(list);
  updateBlocklistInfo();
}

function toggleBlocklistDetail() {
  const detail = document.getElementById('blocklist-detail');
  const link = document.getElementById('blocklist-toggle-link');
  const isOpen = detail.style.display !== 'none';
  detail.style.display = isOpen ? 'none' : '';
  link.textContent = isOpen ? '▶ 管理' : '▼ 管理';
  if (!isOpen) renderBlocklistEntries();
}

// ===== VIEW SWITCH =====
async function switchView(view) {
  if (currentView === view) return;
  currentView = view;
  currentContact = null;
  nextPageToken = null;
  document.getElementById('messages').innerHTML = '';
  document.getElementById('header-name').textContent = 'Chatmail';
  document.getElementById('header-email').textContent = '左のリストから相手を選択';
  resetCompose();

  document.getElementById('tab-inbox').classList.toggle('active', view === 'inbox');
  document.getElementById('tab-trash').classList.toggle('active', view === 'trash');
  document.getElementById('filter-row').style.display = view === 'inbox' ? '' : 'none';

  if (view === 'inbox') {
    await loadInbox();
  } else {
    await loadTrash();
  }
}

async function loadTrash() {
  showSidebarEmpty('ゴミ箱を読み込み中...', false);
  const result = await window.electronAPI.gmail.fetchTrash();
  if (!result.ok) { showSidebarEmpty('読み込みエラー: ' + result.error, false); return; }
  contacts = result.contacts;
  nextPageToken = result.nextPageToken;
  renderContactList();
  if (contacts.length === 0) showSidebarEmpty('ゴミ箱は空です。', false);
}

// ===== SIDEBAR RESIZE =====
function setupSidebarResize() {
  const resizer = document.getElementById('sidebar-resizer');
  const sidebar = document.querySelector('.sidebar');
  let startX, startWidth;

  resizer.addEventListener('mousedown', e => {
    startX = e.clientX;
    startWidth = sidebar.offsetWidth;
    resizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    function onMouseMove(e) {
      const w = Math.min(520, Math.max(200, startWidth + e.clientX - startX));
      sidebar.style.width = w + 'px';
    }
    function onMouseUp() {
      resizer.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      localStorage.setItem('chatmail_sidebar_width', sidebar.offsetWidth);
    }
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });

  const saved = localStorage.getItem('chatmail_sidebar_width');
  if (saved) sidebar.style.width = saved + 'px';
}

// ===== COMPOSE RESIZE =====
function setupComposeResize() {
  const resizer = document.getElementById('compose-resizer');
  const compose = document.querySelector('.compose-area');
  let startX, startWidth;

  resizer.addEventListener('mousedown', e => {
    startX = e.clientX;
    startWidth = compose.offsetWidth;
    resizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    function onMouseMove(e) {
      const w = Math.min(600, Math.max(240, startWidth + startX - e.clientX));
      compose.style.width = w + 'px';
    }
    function onMouseUp() {
      resizer.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      localStorage.setItem('chatmail_compose_width', compose.offsetWidth);
    }
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });

  const saved = localStorage.getItem('chatmail_compose_width');
  if (saved) compose.style.width = saved + 'px';
}

// ===== INIT =====
function setupDragDrop() {
  const replyArea = document.querySelector('.compose-area');
  replyArea.addEventListener('dragover', e => { e.preventDefault(); replyArea.classList.add('dragover'); });
  replyArea.addEventListener('dragleave', e => { if (!replyArea.contains(e.relatedTarget)) replyArea.classList.remove('dragover'); });
  replyArea.addEventListener('drop', e => {
    e.preventDefault();
    replyArea.classList.remove('dragover');
    if (currentContact) addFilesToList(Array.from(e.dataTransfer.files), 'reply');
  });

  const composeModal = document.querySelector('.compose-modal');
  composeModal.addEventListener('dragover', e => { e.preventDefault(); composeModal.classList.add('dragover'); });
  composeModal.addEventListener('dragleave', e => { if (!composeModal.contains(e.relatedTarget)) composeModal.classList.remove('dragover'); });
  composeModal.addEventListener('drop', e => {
    e.preventDefault();
    composeModal.classList.remove('dragover');
    addFilesToList(Array.from(e.dataTransfer.files), 'compose');
  });
}

async function init() {
  const cfg = await window.electronAPI.gmail.getConfig();
  gmailConnected = cfg.isAuthenticated;
  myEmail = cfg.myEmail || '';
  document.getElementById('account-email').textContent = myEmail;

  setupDragDrop();
  setupSidebarResize();
  setupComposeResize();

  document.getElementById('contact-list').addEventListener('scroll', function () {
    if (this.scrollTop + this.clientHeight >= this.scrollHeight - 80) {
      loadMoreThreads();
    }
  });

  if (gmailConnected) {
    await loadInbox();
    setInterval(refreshInboxSilently, 60000);
  } else {
    showSidebarEmpty('Gmail に接続すると受信トレイが表示されます。', true);
  }
}

init();
