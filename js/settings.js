// ===== SETTINGS MODAL =====
function openSettings() {
  window.electronAPI.gmail.getConfig().then(cfg => {
    document.getElementById('modal-client-id').value = cfg.clientId || '';
    document.getElementById('modal-client-secret').value = '';
    updateGmailStatus(cfg.isAuthenticated);
  });

  const savedKey = getApiKey();
  document.getElementById('modal-apikey').value = savedKey;
  document.getElementById('apikey-status').textContent = savedKey ? '✓ Configured' : '';
  document.getElementById('apikey-status').className = 'api-key-status' + (savedKey ? ' ok' : '');
  document.getElementById('modal-llm-type').value = getLlmType();
  document.getElementById('modal-llm-model').value = getLlmModel();
  document.getElementById('modal-llm-endpoint').value = localStorage.getItem('chatmail_llm_endpoint') || '';
  onLlmTypeChange();
  if (savedKey && getLlmType() === 'claude') loadAvailableModels(true);

  document.getElementById('modal-auto-filter').checked = autoFilterEnabled;
  updateBlocklistInfo();

  document.getElementById('modal-overlay').classList.add('visible');
}

async function closeSettings(e) {
  if (e && e.target !== document.getElementById('modal-overlay')) return;
  await saveSettings();
}

function updateGmailStatus(connected) {
  gmailConnected = connected;
  const status = document.getElementById('gmail-status');
  const connectBtn = document.getElementById('btn-gmail-connect');
  const signoutBtn = document.getElementById('btn-gmail-signout');
  if (connected) {
    status.textContent = '✓ Connected to Gmail';
    status.className = 'api-key-status ok';
    connectBtn.textContent = 'Reconnect';
    signoutBtn.style.display = '';
  } else {
    status.textContent = 'Not connected';
    status.className = 'api-key-status';
    connectBtn.textContent = 'Connect to Gmail';
    signoutBtn.style.display = 'none';
  }
}

async function connectGmail() {
  const clientId = document.getElementById('modal-client-id').value.trim();
  const clientSecret = document.getElementById('modal-client-secret').value.trim();

  if (!clientId || !clientSecret) {
    alert('Please enter Client ID and Client Secret.');
    return;
  }

  await window.electronAPI.gmail.saveConfig({ clientId, clientSecret });

  const status = document.getElementById('gmail-status');
  status.textContent = 'Authenticating in browser...';
  status.className = 'api-key-status';

  const result = await window.electronAPI.gmail.authenticate();
  if (result.ok) {
    updateGmailStatus(true);
    closeSettings();
    await loadInbox();
  } else {
    status.textContent = 'Error: ' + result.error;
    status.className = 'api-key-status err';
  }
}

async function signoutGmail() {
  await window.electronAPI.gmail.signout();
  updateGmailStatus(false);
  contacts = [];
  currentContact = null;
  renderContactList();
  showSidebarEmpty('Connect Gmail to see your inbox.', true);
}

async function reloadInbox() {
  closeSettings();
  await loadInbox();
}

function openGCPHelp() {
  window.electronAPI.openExternal('https://console.cloud.google.com/apis/credentials');
}

async function loadAvailableModels(silent = false) {
  const key = document.getElementById('modal-apikey').value.trim() || getApiKey();
  if (!key) { if (!silent) showToast('Enter API key first'); return; }
  const btn = document.getElementById('btn-load-models');
  btn.disabled = true;
  btn.textContent = 'Loading...';
  try {
    const res = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      }
    });
    if (!res.ok) { if (!silent) showToast('Failed to load models'); return; }
    const data = await res.json();
    const models = data.data || [];
    const select = document.getElementById('modal-llm-model-select');
    const input = document.getElementById('modal-llm-model');
    const savedModel = getLlmModel() || 'claude-haiku-4-5-20251001';
    select.innerHTML = models.map(m =>
      `<option value="${esc(m.id)}" ${m.id === savedModel ? 'selected' : ''}>${esc(m.display_name)} (${esc(m.id)})</option>`
    ).join('');
    select.style.display = '';
    input.style.display = 'none';
    btn.textContent = '✓ Loaded';
  } catch {
    if (!silent) showToast('Failed to load models');
    btn.textContent = 'Load Models';
  } finally {
    btn.disabled = false;
  }
}

function onLlmTypeChange() {
  const isClaude = document.getElementById('modal-llm-type').value === 'claude';
  const endpointEl = document.getElementById('modal-llm-endpoint');
  endpointEl.style.display = isClaude ? 'none' : '';
  if (isClaude) {
    document.getElementById('modal-llm-model').placeholder = 'Model name (default: claude-haiku-4-5-20251001)';
  } else {
    document.getElementById('modal-llm-model').placeholder = 'Model name (e.g., gpt-4o, gemini-1.5-flash)';
  }
}

async function saveSettings() {
  autoFilterEnabled = document.getElementById('modal-auto-filter').checked;
  localStorage.setItem('chatmail_auto_filter', autoFilterEnabled ? 'true' : 'false');

  const apiKey = document.getElementById('modal-apikey').value.trim();
  if (apiKey) localStorage.setItem('chatmail_apikey', apiKey);

  localStorage.setItem('chatmail_llm_type', document.getElementById('modal-llm-type').value);
  const select = document.getElementById('modal-llm-model-select');
  const llmModel = select.style.display !== 'none'
    ? select.value
    : document.getElementById('modal-llm-model').value.trim();
  if (llmModel) localStorage.setItem('chatmail_llm_model', llmModel);
  else localStorage.removeItem('chatmail_llm_model');
  const llmEndpoint = document.getElementById('modal-llm-endpoint').value.trim();
  if (llmEndpoint) localStorage.setItem('chatmail_llm_endpoint', llmEndpoint);
  else localStorage.removeItem('chatmail_llm_endpoint');

  const clientId = document.getElementById('modal-client-id').value.trim();
  const clientSecret = document.getElementById('modal-client-secret').value.trim();
  if (clientId && clientSecret) {
    await window.electronAPI.gmail.saveConfig({ clientId, clientSecret });
  } else if (clientId) {
    await window.electronAPI.gmail.saveConfig({ clientId });
  }

  document.getElementById('modal-overlay').classList.remove('visible');
}

function showHeaderSettingsBtn(show) {
  document.getElementById('btn-header-settings').style.display = show ? '' : 'none';
}

function openContactSettings() {
  const contact = currentContact;
  if (!contact) return;
  document.getElementById('contact-settings-title').textContent = contact.name + ' - Settings';
  document.getElementById('cs-greeting-label').textContent = 'Greeting for ' + contact.name;
  document.getElementById('cs-greeting').value = getGreeting(contact.email);
  document.getElementById('cs-signature').value = globalSignature;
  document.getElementById('contact-settings-overlay').classList.add('visible');
}

function closeContactSettings(e) {
  if (e && e.target !== document.getElementById('contact-settings-overlay')) return;
  document.getElementById('contact-settings-overlay').classList.remove('visible');
}

function saveContactSettings() {
  if (currentContact) {
    setGreeting(currentContact.email, document.getElementById('cs-greeting').value);
  }
  globalSignature = document.getElementById('cs-signature').value;
  localStorage.setItem('chatmail_signature', globalSignature);
  document.getElementById('contact-settings-overlay').classList.remove('visible');
  updateTemplateBlocks();
}
