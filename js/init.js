// ===== VIEW SWITCH =====
async function switchView(view) {
  if (currentView === view) return;
  currentView = view;
  currentContact = null;
  showHeaderSettingsBtn(false);
  nextPageToken = null;
  document.getElementById('messages').innerHTML = '';
  document.getElementById('header-name').textContent = 'Chatmail';
  document.getElementById('header-email').textContent = 'Select a contact from the list';
  currentMessages = [];
  currentGroupKey = null;
  resetCompose();

  const isTasksView = view === 'tasks';
  document.getElementById('task-detail-panel').classList.toggle('visible', isTasksView);
  document.getElementById('task-side-panel').style.display = 'none';
  document.getElementById('compose-inner').style.display = isTasksView ? 'none' : '';
  document.getElementById('compose-resizer').style.display = isTasksView ? 'none' : '';
  document.querySelector('.compose-area').classList.remove('reply-active', 'forward-active', 'task-side-active');
  if (isTasksView) { currentTaskId = null; showTaskDetailPlaceholder(); }

  document.getElementById('tab-inbox').classList.toggle('active', view === 'inbox');
  document.getElementById('tab-tasks').classList.toggle('active', view === 'tasks');
  document.getElementById('tab-trash').classList.toggle('active', view === 'trash');
  document.getElementById('filter-row').style.display = view === 'inbox' ? '' : 'none';

  if (view === 'inbox') {
    await loadInbox();
  } else if (view === 'tasks') {
    renderTaskList();
  } else {
    await loadTrash();
  }
}

// ===== GMAIL DATA LOADING =====
async function refreshInboxSilently() {
  if (!gmailConnected || currentView !== 'inbox') return;
  const indicator = document.getElementById('refresh-indicator');
  indicator.classList.add('spinning');
  try {
    const result = await window.electronAPI.gmail.fetchThreads();
    if (!result.ok) return;
    const prevThreadId = currentContact?.threadId;
    const pendingSent = contacts.filter(c => c._pendingSent);
    contacts = result.contacts;
    pendingSent.forEach(p => {
      if (!contacts.find(c => c.threadId === p.threadId)) contacts.unshift(p);
    });
    nextPageToken = result.nextPageToken;
    contacts.forEach(c => addToAddressBook(c.name, c.email));
    saveAddressBook();

    if (autoFilterEnabled) {
      const blocklist = getBlocklist();
      const autoTrash = contacts.filter(c => blocklist.includes(c.email.toLowerCase()));
      if (autoTrash.length > 0) {
        autoTrash.forEach(c => window.electronAPI.gmail.trashThread({ threadId: c.threadId }));
        const autoIds = new Set(autoTrash.map(c => c.threadId));
        contacts = contacts.filter(c => !autoIds.has(c.threadId));
        if (currentContact && autoIds.has(currentContact.threadId)) {
          currentContact = null;
          showHeaderSettingsBtn(false);
          document.getElementById('messages').innerHTML = '';
          document.getElementById('header-name').textContent = 'Chatmail';
          document.getElementById('header-email').textContent = 'Select a contact from the list';
          resetCompose();
        }
        showToast(`${autoTrash.length} emails moved to trash automatically`);
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
  showSidebarEmpty('Loading inbox...', false);

  const result = await window.electronAPI.gmail.fetchThreads();
  if (!result.ok) {
    showSidebarEmpty('Load error: ' + result.error, false);
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
  loader.textContent = 'Loading...';
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
      const savedScroll = list.scrollTop;
      renderContactList();
      list.scrollTop = savedScroll;
    }
  } finally {
    isLoadingMore = false;
    document.getElementById('load-more-indicator')?.remove();
  }
}

async function loadTrash() {
  showSidebarEmpty('Loading trash...', false);
  const result = await window.electronAPI.gmail.fetchTrash();
  if (!result.ok) { showSidebarEmpty('Load error: ' + result.error, false); return; }
  contacts = result.contacts;
  nextPageToken = result.nextPageToken;
  renderContactList();
  if (contacts.length === 0) showSidebarEmpty('Trash is empty.', false);
}

// ===== RESIZE =====
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
  const w = Number(saved);
  if (w >= 200 && w <= 520) sidebar.style.width = w + 'px';
}

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
  const w = Number(saved);
  if (w >= 200 && w <= 600) compose.style.width = w + 'px';
}

// ===== DRAG & DROP =====
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

// ===== THEME =====
function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('chatmail_theme', next);
  document.getElementById('btn-theme-toggle').textContent = next === 'dark' ? '☀ Light' : '☾ Dark';
}

// ===== INIT =====
async function init() {
  const savedTheme = localStorage.getItem('chatmail_theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);
  document.getElementById('btn-theme-toggle').textContent = savedTheme === 'dark' ? '☀ Light' : '☾ Dark';

  const cfg = await window.electronAPI.gmail.getConfig();
  gmailConnected = cfg.isAuthenticated;
  myEmail = cfg.myEmail || '';
  document.getElementById('account-email').textContent = myEmail;

  setupDragDrop();
  setupSidebarResize();
  setupComposeResize();
  loadFilterMode();

  document.getElementById('contact-list').addEventListener('scroll', function () {
    if (this.scrollTop + this.clientHeight >= this.scrollHeight - 80) {
      loadMoreThreads();
    }
  });

  if (gmailConnected) {
    await loadInbox();
    setInterval(refreshInboxSilently, 60000);
  } else {
    showSidebarEmpty('Connect Gmail to see your inbox.', true);
  }
}

init();
