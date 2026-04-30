// ===== SPAM FILTER =====
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
        system: 'Analyze inbox emails and identify advertisements, newsletters, promotions, and unwanted mass-sent emails (including marketing emails). Return only a JSON array of true/false values. Example: [true, false, true]',
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

function saveFilterMode() {
  const useAI = document.getElementById('filter-ai-toggle')?.checked !== false;
  localStorage.setItem('chatmail_filter_mode', useAI ? 'both' : 'rule');
}

function loadFilterMode() {
  const mode = localStorage.getItem('chatmail_filter_mode') || 'both';
  const toggle = document.getElementById('filter-ai-toggle');
  if (toggle) toggle.checked = mode !== 'rule';
}

async function scanFilter() {
  if (!gmailConnected || currentView !== 'inbox') return;
  const useAI = document.getElementById('filter-ai-toggle')?.checked !== false;
  const btn = document.getElementById('btn-filter-scan');
  btn.disabled = true;
  btn.textContent = '🤖 Scanning...';
  try {
    const blocklist = getBlocklist();
    const notBlocked = contacts.filter(c => !blocklist.includes(c.email.toLowerCase()));

    const ruleCandidates = notBlocked
      .filter(c => isSpamByRules(c))
      .map(c => ({ ...c, reason: 'Rule match' }));
    const ruleIds = new Set(ruleCandidates.map(c => c.threadId));
    const remaining = notBlocked.filter(c => !ruleIds.has(c.threadId));

    let aiCandidates = [];
    if (useAI && getApiKey() && remaining.length > 0) {
      const flags = await detectSpamWithClaude(remaining);
      aiCandidates = remaining
        .filter((_, i) => flags[i])
        .map(c => ({ ...c, reason: 'AI detected' }));
    }

    filterCandidates = [...ruleCandidates, ...aiCandidates];
    openFilterModal(filterCandidates);
  } finally {
    btn.disabled = false;
    btn.textContent = '🤖 Scan';
  }
}

function openFilterModal(candidates) {
  const list = document.getElementById('filter-list');
  const applyBtn = document.getElementById('btn-apply-filter');
  document.getElementById('filter-modal-title').textContent =
    candidates.length > 0 ? `Spam Candidates (${candidates.length})` : 'Spam Candidates';

  if (candidates.length === 0) {
    list.innerHTML = '<div class="filter-empty">No spam found.</div>';
    applyBtn.style.display = 'none';
  } else {
    applyBtn.style.display = '';
    list.innerHTML = candidates.map((c, i) => `
      <div class="filter-item">
        <input type="checkbox" class="filter-check" id="fc-${i}" checked data-index="${i}">
        <label for="fc-${i}" class="filter-item-info">
          <div class="filter-item-name">${esc(c.name || c.email)}</div>
          <div class="filter-item-subject">${esc(c.subject || '(no subject)')}</div>
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
  btn.textContent = checked > 0 ? `Move to Trash (${checked})` : 'Move to Trash';
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
  btn.textContent = 'Processing...';

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
      document.getElementById('header-email').textContent = 'Select a contact from the list';
      resetCompose();
    }
  }

  renderContactList();
  if (contacts.length === 0) showSidebarEmpty('Your inbox is empty.', false);
  closeFilterModal();
  showToast(`Moved ${toTrash.length} to trash`);
}

function clearBlocklist() {
  if (!confirm('Reset blocklist? Auto-filter will stop working for previously blocked senders.')) return;
  saveBlocklist([]);
  updateBlocklistInfo();
  showToast('Blocklist reset');
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
    el.innerHTML = '<div style="font-size:12px;color:#aaa;padding:4px 0">No blocked senders</div>';
    return;
  }
  el.innerHTML = list.map(email => `
    <div class="blocklist-entry">
      <span class="blocklist-email">${esc(email)}</span>
      <button class="blocklist-remove" onclick="removeFromBlocklist('${esc(email)}')" title="Unblock">✕</button>
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
  link.textContent = isOpen ? '▶ Manage' : '▼ Manage';
  if (!isOpen) renderBlocklistEntries();
}
