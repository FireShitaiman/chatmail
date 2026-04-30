// ===== SEARCH =====
function highlight(text, query) {
  const escaped = esc(text || '');
  if (!query) return escaped;
  const safeQ = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escaped.replace(new RegExp(`(${safeQ})`, 'gi'), '<mark>$1</mark>');
}

function onSearchInput(el) {
  if (!el.value) {
    if (isSearchMode) clearSearch();
    else filterContacts('');
    return;
  }
  if (!isSearchMode) filterContacts(el.value);
}

function onSearchKeydown(event, el) {
  if (event.key === 'Enter' && el.value.trim()) triggerSearch(el.value.trim());
  if (event.key === 'Escape') clearSearch();
}

async function triggerSearch(query) {
  isSearchMode = true;
  document.getElementById('search-clear-btn').style.display = '';
  showSidebarEmpty('Searching...', false);
  const result = await window.electronAPI.gmail.fetchThreads({ q: query });
  if (!result.ok) { showSidebarEmpty('Search error: ' + result.error, false); return; }
  contacts = result.contacts;
  nextPageToken = null;
  renderContactList();
  if (contacts.length === 0) showSidebarEmpty(`No results for "${query}"`, false);
}

function clearSearch() {
  isSearchMode = false;
  document.getElementById('search-clear-btn').style.display = 'none';
  const input = document.getElementById('search-input');
  if (input) input.value = '';
  if (currentView === 'inbox') loadInbox();
  else if (currentView === 'trash') loadTrash();
}

// ===== SIDEBAR CONTACT LIST =====
function getDisplayItems() {
  if (isSearchMode) {
    return contacts.map((_, i) => ({ type: 'single', index: i }));
  }
  const byEmail = new Map();
  contacts.forEach((c, i) => {
    const key = c.email.toLowerCase();
    if (!byEmail.has(key)) byEmail.set(key, []);
    byEmail.get(key).push(i);
  });
  const items = [];
  const seen = new Set();
  contacts.forEach((c, i) => {
    const key = c.email.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const indices = byEmail.get(key);
    if (indices.length === 1) {
      items.push({ type: 'single', index: i });
    } else {
      items.push({ type: 'group', key, indices });
    }
  });
  return items;
}

function contactItemHTML(c, i) {
  const isActive = !currentGroupKey && currentContact && currentContact.threadId === c.threadId;
  const hasDraft = !!localStorage.getItem('chatmail_draft_' + c.email.toLowerCase());
  const actions = currentView === 'trash'
    ? `<button class="contact-action-btn" title="Restore to inbox" onclick="restoreThread('${esc(c.threadId)}',${i},'${esc(c.email)}')">${getBlocklist().includes(c.email.toLowerCase()) ? '🔓 Unblock & restore' : 'Restore'}</button>`
    : `${!c.unread ? `<button class="contact-action-btn unread" title="Mark as unread" onclick="markUnread('${esc(c.threadId)}',${i})">Unread</button>` : ''}
       <button class="contact-action-btn block-trash" title="Block & trash" onclick="blockAndTrash('${esc(c.threadId)}',${i},'${esc(c.email)}')">🚫</button>
       <button class="contact-action-btn trash" title="Move to trash" onclick="trashThread('${esc(c.threadId)}',${i})">🗑</button>`;
  const q = isSearchMode ? (document.getElementById('search-input')?.value || '') : '';
  const nameHtml = q ? highlight(c.name, q) : esc(c.name);
  const previewHtml = q ? highlight(c.preview || c.subject || '', q) : esc(c.preview || c.subject || '');
  return `
    <div class="contact-item${isActive ? ' active' : ''}"
         data-index="${i}" onclick="selectContact(${i})">
      <div class="avatar" style="background:${emailToColor(c.email)}">${(c.name[0] || '?').toUpperCase()}</div>
      <div class="contact-info">
        <div class="contact-name">${nameHtml}${c.isSpam ? ' <span class="spam-badge">Spam</span>' : ''}</div>
        <div class="contact-preview">${previewHtml}</div>
      </div>
      <div class="contact-meta">
        <span class="contact-time">${esc(c.time)}</span>
        ${hasDraft ? '<span class="draft-badge">Draft</span>' : ''}
        ${c.unread ? '<span class="unread-badge">●</span>' : ''}
      </div>
      <div class="contact-actions" onclick="event.stopPropagation()">${actions}</div>
    </div>`;
}

function renderContactList() {
  const list = document.getElementById('contact-list');
  if (contacts.length === 0) {
    list.innerHTML = '<div class="sidebar-empty"><p>Your inbox is empty.</p></div>';
    return;
  }
  list.innerHTML = getDisplayItems().map(item => {
    if (item.type === 'single') return contactItemHTML(contacts[item.index], item.index);

    const c0 = contacts[item.indices[0]];
    const unreadCount = item.indices.filter(i => contacts[i].unread).length;
    const isGroupActive = currentGroupKey === item.key;
    return `
      <div class="contact-group-wrap">
        <div class="contact-item group-header${isGroupActive ? ' active' : ''}"
             data-group-key="${esc(item.key)}"
             data-group-name="${esc(c0.name.toLowerCase())}"
             data-group-email="${esc(item.key)}"
             onclick="selectGroup('${esc(item.key)}')">
          <div class="avatar" style="background:${emailToColor(c0.email)}">${(c0.name[0] || '?').toUpperCase()}</div>
          <div class="contact-info">
            <div class="contact-name">${esc(c0.name)}</div>
            <div class="contact-preview">${item.indices.length} emails · ${esc(c0.preview || c0.subject || '')}</div>
          </div>
          <div class="contact-meta">
            <span class="contact-time">${esc(c0.time)}</span>
            ${unreadCount > 0 ? '<span class="unread-badge">●</span>' : ''}
          </div>
        </div>
      </div>`;
  }).join('');

  // リストが画面内に収まっていて次ページがあればすぐ追加読み込み
  requestAnimationFrame(() => {
    if (list.scrollHeight <= list.clientHeight && nextPageToken) {
      loadMoreThreads();
    }
  });
}

async function selectGroup(key) {
  const byEmail = new Map();
  contacts.forEach((c, i) => {
    const k = c.email.toLowerCase();
    if (!byEmail.has(k)) byEmail.set(k, []);
    byEmail.get(k).push(i);
  });
  const indices = byEmail.get(key);
  if (!indices || !indices.length) return;

  currentGroupKey = key;
  const c0 = contacts[indices[0]];
  currentContact = c0;

  document.getElementById('header-avatar').textContent = (c0.name[0] || '?').toUpperCase();
  document.getElementById('header-avatar').style.background = emailToColor(c0.email);
  document.getElementById('header-name').textContent = c0.name;
  document.getElementById('header-email').textContent = `${c0.email} (${indices.length} emails)`;

  renderContactList();

  const msgs = document.getElementById('messages');
  msgs.innerHTML = '<div style="text-align:center;padding:40px;color:#aaa;font-size:13px">Loading...</div>';

  const allMessages = [];
  let firstCC = null;
  const revIndices = [...indices].reverse();
  for (let gi = 0; gi < revIndices.length; gi++) {
    const c = contacts[revIndices[gi]];
    const result = await window.electronAPI.gmail.fetchMessages(c.threadId);
    if (result.ok) {
      if (gi > 0) allMessages.push({ isDivider: true, subject: c.subject || '(no subject)' });
      allMessages.push(...result.messages);
      if (gi === revIndices.length - 1 && result.threadCC) firstCC = result.threadCC;
      if (currentView === 'inbox' && c.unread) { c.unread = false; markRead(c.threadId); }
    }
  }

  currentMessages = allMessages;
  await renderMessages(allMessages);
  resetCompose();
  updateTemplateBlocks();

  populateReplyHeader(firstCC);
  restoreDraft(c0.email);
  showHeaderSettingsBtn(true);

  renderContactList();
}

function showSidebarEmpty(message, showConnectBtn) {
  document.getElementById('contact-list').innerHTML = `
    <div class="sidebar-empty">
      <p>${message}</p>
      ${showConnectBtn ? '<button class="btn-connect" onclick="openSettings()">Connect to Gmail</button>' : ''}
    </div>`;
}

function filterContacts(query) {
  const q = query.trim().toLowerCase();
  document.querySelectorAll('#contact-list .contact-item[data-index]').forEach(el => {
    const i = parseInt(el.dataset.index, 10);
    const c = contacts[i];
    const match = !q || c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q) || c.subject.toLowerCase().includes(q);
    el.style.display = match ? '' : 'none';
  });
  document.querySelectorAll('#contact-list .contact-group-wrap').forEach(wrap => {
    const headerEl = wrap.querySelector('.group-header');
    if (!headerEl) return;
    const name = headerEl.dataset.groupName || '';
    const email = headerEl.dataset.groupEmail || '';
    wrap.style.display = (!q || name.includes(q) || email.includes(q)) ? '' : 'none';
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
  const restoredContact = contacts[index] ? { ...contacts[index] } : null;
  const result = await window.electronAPI.gmail.restoreThread({ threadId });
  if (!result.ok) { alert('Restore error: ' + result.error); return; }
  if (email) {
    const list = getBlocklist().filter(e => e !== email.toLowerCase());
    saveBlocklist(list);
    updateBlocklistInfo();
  }
  showToast('Restored to inbox');
  await switchView('inbox');
  if (restoredContact && !contacts.find(c => c.threadId === restoredContact.threadId)) {
    restoredContact.unread = false;
    contacts.unshift(restoredContact);
    renderContactList();
  }
}

async function blockAndTrash(threadId, index, email) {
  if (!gmailConnected) return;
  addToBlocklist(email);
  await trashThread(threadId, index);
  showToast(`${email} blocked and moved to trash`);
}

async function trashThread(threadId, index) {
  if (!gmailConnected) return;
  const result = await window.electronAPI.gmail.trashThread({ threadId });
  if (!result.ok) { alert('Delete error: ' + result.error); return; }
  const wasSelected = currentContact?.threadId === threadId;
  contacts.splice(index, 1);
  if (wasSelected) {
    currentContact = null;
    document.getElementById('messages').innerHTML = '';
    document.getElementById('header-name').textContent = 'Chatmail';
    document.getElementById('header-email').textContent = 'Select a contact from the list';
    resetCompose();
  }
  if (wasSelected) showHeaderSettingsBtn(false);
  renderContactList();
  if (contacts.length === 0) showSidebarEmpty('Your inbox is empty.', false);
}

async function selectContact(index) {
  currentContact = contacts[index];

  const c = currentContact;
  const color = emailToColor(c.email);
  document.getElementById('header-avatar').textContent = (c.name[0] || '?').toUpperCase();
  document.getElementById('header-avatar').style.background = color;
  document.getElementById('header-name').textContent = c.name;
  document.getElementById('header-email').textContent = c.email;

  currentGroupKey = null;
  document.querySelectorAll('#contact-list .contact-item[data-index]').forEach(el => {
    el.classList.toggle('active', parseInt(el.dataset.index, 10) === index);
  });
  document.querySelectorAll('#contact-list .group-header').forEach(el => el.classList.remove('active'));

  resetCompose();
  updateTemplateBlocks();
  showHeaderSettingsBtn(true);

  const msgs = document.getElementById('messages');
  msgs.innerHTML = '<div style="text-align:center;padding:40px;color:#aaa;font-size:13px">Loading...</div>';

  const result = await window.electronAPI.gmail.fetchMessages(c.threadId);
  if (result.ok) {
    currentMessages = result.messages;
    await renderMessages(result.messages);
  } else {
    msgs.innerHTML = `<div style="text-align:center;padding:40px;color:#e8605a;font-size:13px">Load error: ${esc(result.error)}</div>`;
  }

  if (currentView === 'inbox' && c.unread) {
    c.unread = false;
    renderContactList();
    markRead(c.threadId);
  }

  populateReplyHeader(result.ok ? result.threadCC : '');
  restoreDraft(currentContact.email);
}
