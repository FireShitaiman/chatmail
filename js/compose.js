// ===== DRAFTS =====
let draftSaveTimer = null;

function draftKey(email) {
  return 'chatmail_draft_' + email.toLowerCase();
}

function saveDraft() {
  if (!currentContact) return;
  const body = document.getElementById('compose-input').value;
  if (body) {
    localStorage.setItem(draftKey(currentContact.email), body);
  } else {
    localStorage.removeItem(draftKey(currentContact.email));
  }
  renderContactList();
}

function restoreDraft(email) {
  const body = localStorage.getItem(draftKey(email));
  const input = document.getElementById('compose-input');
  if (body) {
    input.value = body;
    onInputChange(input);
  }
}

function clearDraft(email) {
  localStorage.removeItem(draftKey(email));
  renderContactList();
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

// ===== INPUT HANDLERS =====
function onInputChange(el) {
  const hasText = el.value.trim().length > 0;
  document.getElementById('tone-buttons').classList.toggle('visible', hasText);
  document.getElementById('btn-ai').style.display = hasText ? 'none' : '';
  clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(saveDraft, 600);
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

// ===== AI =====
function getApiKey() {
  return localStorage.getItem('chatmail_apikey') || '';
}
function getLlmType() {
  return localStorage.getItem('chatmail_llm_type') || 'claude';
}
function getLlmModel() {
  return localStorage.getItem('chatmail_llm_model') || '';
}
function getLlmEndpoint() {
  return (localStorage.getItem('chatmail_llm_endpoint') || 'https://api.openai.com/v1').replace(/\/$/, '');
}

async function callLLM(system, userMsg) {
  const key = getApiKey();
  const type = getLlmType();
  if (!key) { showToast('Please enter your API key in Settings.'); return null; }

  if (type === 'claude') {
    const model = getLlmModel() || 'claude-haiku-4-5-20251001';
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({ model, max_tokens: 400, system, messages: [{ role: 'user', content: userMsg }] })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast('API error: ' + (err.error?.message || res.status));
      return null;
    }
    const data = await res.json();
    return data.content[0].text.trim();
  } else {
    const model = getLlmModel() || 'gpt-4o-mini';
    const endpoint = getLlmEndpoint();
    const res = await fetch(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({
        model,
        max_tokens: 400,
        messages: [{ role: 'system', content: system }, { role: 'user', content: userMsg }]
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast('API error: ' + (err.error?.message || res.status));
      return null;
    }
    const data = await res.json();
    return data.choices[0].message.content.trim();
  }
}

async function triggerAI() {
  if (!currentContact) return;
  const input = document.getElementById('compose-input');
  hideSuggestion();
  document.getElementById('ai-loading').classList.add('visible');

  try {
    const result = await callLLM(
      'You are an assistant that writes email replies. Based on the provided information, write a professional reply body. Do not include greetings or signatures.',
      `Contact: ${currentContact.name} (${currentContact.email})\nSubject: ${currentContact.subject}\n\nPlease write a reply.`
    );
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

  const toneMap = { 'Formal': 'formal and professional business tone', 'Casual': 'casual and friendly tone', 'Shorter': 'as short and concise as possible' };
  try {
    const result = await callLLM(
      `You are an assistant that adjusts email tone. Rewrite the given text in a "${toneMap[tone]}" style. Return only the body text.`,
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

// ===== SEND REPLY =====
async function sendMessage() {
  if (newMailMode) { await sendFromNewMailMode(); return; }
  if (!currentContact && !forwardData) return;
  const input = document.getElementById('compose-input');
  const body = input.value.trim();

  if (forwardData) {
    const to = (document.getElementById('reply-to-input').value || '').trim();
    if (!to) { alert('Please enter a forwarding address.'); return; }
    const cc = (document.getElementById('reply-cc-input').value || '').trim();
    const bcc = (document.getElementById('reply-bcc-input').value || '').trim();
    const fwSubject = forwardData.subject.startsWith('Fwd:') ? forwardData.subject : 'Fwd: ' + forwardData.subject;
    const fwBody = [
      body || null,
      body ? '' : null,
      '---------- Forwarded message ----------',
      `From: ${forwardData.fromName} <${forwardData.fromEmail}>`,
      `Subject: ${forwardData.subject}`,
      '',
      forwardData.text,
    ].filter(l => l !== null).join('\n');

    const btn = document.querySelector('.compose-area .btn-send');
    btn.disabled = true; btn.textContent = 'Sending...';
    const result = await window.electronAPI.gmail.send({ to, cc, bcc, subject: fwSubject, body: fwBody, attachments: replyAttachments });
    btn.disabled = false; btn.textContent = 'Forward';
    if (result.ok) {
      resetCompose();
    } else {
      alert('Forward error: ' + result.error);
    }
    return;

  }

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
    const replyCC = (document.getElementById('reply-cc-input').value || '').trim();
    const replyBCC = (document.getElementById('reply-bcc-input').value || '').trim();
    const result = await window.electronAPI.gmail.send({
      to: currentContact.email,
      cc: replyCC,
      bcc: replyBCC,
      subject: currentContact.subject,
      body: fullText,
      threadId: currentContact.threadId,
      attachments: replyAttachments,
    });
    if (!result.ok) {
      alert('Send error: ' + result.error);
      return;
    }
    replyAttachments = [];
    renderAttachmentList('reply');
  }
  appendSentMessage(fullText);

  clearDraft(currentContact.email);
  input.value = '';
  onInputChange(input);
  hideSuggestion();
  clearReplyContext();
}

function clearReplyContext() {
  document.getElementById('reply-context-bar').classList.add('hidden');
  document.querySelector('.compose-area').classList.remove('reply-active');
  document.getElementById('reply-context-sender').textContent = '';
  document.getElementById('reply-context-snippet').textContent = '';
  if (replyTargetEl) { replyTargetEl.classList.remove('reply-target'); replyTargetEl = null; }
  if (!forwardData) document.getElementById('compose-subject-display').classList.add('hidden');
}

function setSubjectDisplay(prefix, subject) {
  const el = document.getElementById('compose-subject-display');
  if (!subject) { el.classList.add('hidden'); return; }
  const prefixed = subject.startsWith(prefix + ':') ? subject : prefix + ': ' + subject;
  el.textContent = prefixed;
  el.classList.remove('hidden');
}

function populateReplyHeader(threadCC) {
  if (!currentContact) return;
  const toText = currentContact.name
    ? `${currentContact.name} <${currentContact.email}>`
    : currentContact.email;
  document.getElementById('reply-header-to-text').textContent = toText;
  document.getElementById('reply-cc-input').value = threadCC || '';
  document.getElementById('reply-bcc-input').value = '';
  document.getElementById('reply-header-bar').style.display = '';

  if (threadCC) {
    document.getElementById('reply-header-fields').classList.remove('hidden');
    document.getElementById('reply-header-chevron').textContent = '▴';
  } else {
    document.getElementById('reply-header-fields').classList.add('hidden');
    document.getElementById('reply-header-chevron').textContent = '▾';
  }
}

function toggleReplyHeader() {
  const fields = document.getElementById('reply-header-fields');
  const chevron = document.getElementById('reply-header-chevron');
  const hidden = fields.classList.toggle('hidden');
  chevron.textContent = hidden ? '▾' : '▴';
}

function resetCompose() {
  const input = document.getElementById('compose-input');
  input.value = '';
  input.style.height = 'auto';
  input.placeholder = 'Write your message...';
  document.getElementById('tone-buttons').classList.remove('visible');
  document.getElementById('btn-ai').style.display = '';
  hideSuggestion();
  document.getElementById('ai-loading').classList.remove('visible');
  document.getElementById('sig-checkbox').checked = true;
  document.getElementById('greeting-checkbox').checked = true;
  replyAttachments = [];
  renderAttachmentList('reply');
  document.getElementById('reply-header-bar').style.display = 'none';
  document.getElementById('reply-header-fields').classList.add('hidden');
  document.getElementById('reply-header-chevron').textContent = '▾';
  document.getElementById('reply-cc-input').value = '';
  document.getElementById('reply-bcc-input').value = '';
  document.getElementById('compose-subject-display').classList.add('hidden');
  exitNewMailMode();
  exitForwardMode();
  clearReplyContext();
  closeTaskSidePanel();
  document.querySelector('.compose-area').scrollLeft = 0;
}

// ===== FORWARD MODE =====
let forwardData = null;
let newMailMode = false;

function enterForwardMode(msgData) {
  if (!msgData) return;
  clearReplyContext();
  closeTaskSidePanel();
  forwardData = msgData;

  // C6: トグルボタンを非表示、フィールドを常時展開
  document.getElementById('reply-header-bar').style.display = 'none';
  document.getElementById('reply-header-fields').classList.remove('hidden');
  document.getElementById('reply-to-row').style.display = '';
  document.getElementById('reply-to-input').value = '';
  document.getElementById('reply-cc-input').value = '';
  document.getElementById('reply-bcc-input').value = '';

  const fromLine = msgData.fromName
    ? `${msgData.fromName} <${msgData.fromEmail}>`
    : (msgData.fromEmail || '');
  document.getElementById('forward-quoted-preview').textContent =
    `From: ${fromLine}\nSubject: ${msgData.subject || ''}\n\n${msgData.text || ''}`;
  document.getElementById('forward-quoted-area').classList.remove('hidden');

  replyAttachments = msgData.attachments && msgData.attachments.length > 0
    ? [...msgData.attachments]
    : [];
  renderAttachmentList('reply');

  document.querySelector('.compose-area .btn-send').textContent = 'Forward';
  const input = document.getElementById('compose-input');
  input.disabled = false;
  input.value = '';
  input.placeholder = 'Comment (optional)';
  onInputChange(input);

  // C2: 転送モード色
  document.querySelector('.compose-area').classList.add('forward-active');

  // C4: サブジェクト表示
  const subj = currentContact ? (currentContact.subject || '') : (msgData.subject || '');
  setSubjectDisplay('Fwd', subj);

  document.querySelector('.compose-area').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  setTimeout(() => document.getElementById('reply-to-input').focus(), 50);
}

function exitForwardMode() {
  if (!forwardData) return;
  forwardData = null;
  if (forwardTargetEl) { forwardTargetEl.classList.remove('forward-target'); forwardTargetEl = null; }
  document.getElementById('reply-to-row').style.display = 'none';
  document.getElementById('reply-to-input').value = '';
  document.getElementById('forward-quoted-area').classList.add('hidden');
  document.querySelector('.compose-area .btn-send').textContent = 'Send';
  document.getElementById('compose-input').placeholder = 'Write your message...';

  // C2: 転送モード色を解除
  document.querySelector('.compose-area').classList.remove('forward-active');

  // C4: サブジェクト非表示
  document.getElementById('compose-subject-display').classList.add('hidden');

  if (currentContact) {
    const toText = currentContact.name
      ? `${currentContact.name} <${currentContact.email}>`
      : currentContact.email;
    document.getElementById('reply-header-to-text').textContent = toText;
    document.getElementById('reply-header-to-label').style.display = '';
    document.getElementById('reply-header-bar').style.display = '';
    document.getElementById('reply-header-fields').classList.add('hidden');
    document.getElementById('reply-header-chevron').textContent = '▾';
  }
}

// ===== NEW MAIL MODE (right pane) =====
function enterNewMailMode() {
  clearReplyContext();
  closeTaskSidePanel();
  if (forwardData) exitForwardMode();
  newMailMode = true;

  document.getElementById('reply-header-bar').style.display = 'none';
  document.getElementById('reply-header-fields').classList.remove('hidden');
  document.getElementById('reply-to-row').style.display = '';
  document.getElementById('new-mail-subject-row').style.display = '';
  document.getElementById('reply-to-input').value = '';
  document.getElementById('new-mail-subject-input').value = '';
  document.getElementById('reply-cc-input').value = '';
  document.getElementById('reply-bcc-input').value = '';

  document.querySelector('.compose-area').classList.add('new-mail-active');
  document.getElementById('compose-subject-display').classList.add('hidden');

  const input = document.getElementById('compose-input');
  input.disabled = false;
  input.value = '';
  input.placeholder = 'Write your message...';
  onInputChange(input);
  updateSigVisual();
  hideSuggestion();
  replyAttachments = [];
  renderAttachmentList('reply');

  setTimeout(() => document.getElementById('reply-to-input').focus(), 50);
}

function onReplyToBlur() {
  setTimeout(hideSuggestions, 150);
  if (!newMailMode) return;
  const to = document.getElementById('reply-to-input').value.trim().toLowerCase();
  if (!to) return;
  const cc = document.getElementById('reply-cc-input').value.trim();
  const bcc = document.getElementById('reply-bcc-input').value.trim();
  if (cc || bcc) return;
  const idx = contacts.findIndex(c => c.email.toLowerCase() === to);
  if (idx !== -1) {
    exitNewMailMode();
    selectContact(idx);
  }
}

function exitNewMailMode() {
  if (!newMailMode) return;
  newMailMode = false;
  document.getElementById('new-mail-subject-row').style.display = 'none';
  document.getElementById('new-mail-subject-input').value = '';
  document.getElementById('reply-to-row').style.display = 'none';
  document.getElementById('reply-to-input').value = '';
  document.querySelector('.compose-area').classList.remove('new-mail-active');
}

async function sendFromNewMailMode() {
  const to = document.getElementById('reply-to-input').value.trim();
  const subject = document.getElementById('new-mail-subject-input').value.trim();
  const cc = document.getElementById('reply-cc-input').value.trim();
  const bcc = document.getElementById('reply-bcc-input').value.trim();
  const input = document.getElementById('compose-input');
  const body = input.value.trim();

  if (!to) { alert('Please enter a recipient.'); return; }
  if (!subject) { alert('Please enter a subject.'); return; }
  if (!body) { alert('Please enter a message body.'); return; }

  const sigOn = document.getElementById('sig-checkbox').checked;
  const fullBody = sigOn && globalSignature ? body + '\n\n' + globalSignature : body;

  const btn = document.querySelector('.compose-area .btn-send');
  btn.disabled = true;
  btn.textContent = 'Sending...';

  const result = await window.electronAPI.gmail.send({ to, cc, bcc, subject, body: fullBody, attachments: replyAttachments });
  btn.disabled = false;
  btn.textContent = 'Send';

  if (!result.ok) { alert('Send error: ' + result.error); return; }

  [to, cc, bcc].forEach(f => {
    if (!f) return;
    f.split(',').forEach(a => { a = a.trim(); if (a) addToAddressBook(a, a); });
  });
  saveAddressBook();

  exitNewMailMode();
  input.value = '';
  onInputChange(input);
  replyAttachments = [];
  renderAttachmentList('reply');

  await refreshInboxSilently();

  let idx = contacts.findIndex(c => c.threadId === result.threadId);
  if (idx === -1) {
    const now = new Date();
    const time = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
    contacts.unshift({ threadId: result.threadId, name: to, email: to, subject, preview: body.slice(0, 60), time, unread: false, _pendingSent: true });
    renderContactList();
    idx = 0;
  }
  await selectContact(idx);
  appendSentMessage(fullBody);
}

// ===== NEW MAIL COMPOSE =====
function openCompose() {
  enterNewMailMode();
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

  if (!to)      { alert('Please enter a recipient.'); return; }
  if (!subject) { alert('Please enter a subject.'); return; }
  if (!body)    { alert('Please enter a message body.'); return; }

  const btn = document.getElementById('compose-send-btn');
  btn.disabled = true;
  btn.textContent = 'Sending...';

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

    const sentThreadId = result.threadId;
    let idx = contacts.findIndex(c => c.threadId === sentThreadId);
    if (idx === -1) {
      const now = new Date();
      const time = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
      contacts.unshift({ threadId: sentThreadId, name: to, email: to, subject, preview: subject, time, unread: false });
      renderContactList();
      idx = 0;
    }
    await selectContact(idx);
  } else {
    alert('Send error: ' + result.error);
    btn.disabled = false;
    btn.textContent = 'Send';
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
      alert(`${file.name} exceeds 25MB and cannot be attached.`);
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
      <button class="attachment-remove" onclick="removeAttachment('${target}',${i})" title="Remove">&#10005;</button>
    </div>`
  ).join('');
}

function handleFileInputChange(event, target) {
  addFilesToList(Array.from(event.target.files), target);
  event.target.value = '';
}
