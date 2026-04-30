// ===== TASK SIDE PANEL =====
function openTaskSidePanel() {
  document.getElementById('compose-inner').style.display = 'none';
  document.getElementById('task-side-panel').style.display = 'flex';
  document.querySelector('.compose-area').classList.remove('reply-active', 'forward-active');
  document.querySelector('.compose-area').classList.add('task-side-active');
  renderTaskSidePanel();
}

function closeTaskSidePanel() {
  if (document.getElementById('task-side-panel').style.display === 'none') return;
  document.getElementById('task-side-panel').style.display = 'none';
  document.getElementById('compose-inner').style.display = '';
  document.querySelector('.compose-area').classList.remove('task-side-active');
}

function renderTaskSidePanel() {
  const tasks = getTasks();
  const listEl = document.getElementById('tsp-list');
  if (tasks.length === 0) {
    listEl.innerHTML = '<div class="tsp-empty">No tasks yet</div>';
    return;
  }
  listEl.innerHTML = tasks.map(t => {
    const displayName = t.contactName || t.contactEmail || '(unknown)';
    return `<div class="tsp-item">
      <div class="tsp-item-avatar" style="background:${emailToColor(t.contactEmail || '')}">${(displayName[0]||'?').toUpperCase()}</div>
      <div class="tsp-item-info">
        <div class="tsp-item-name">${esc(displayName)}</div>
        <div class="tsp-item-sub">${esc(t.memo || t.snippet || t.subject || '')}</div>
      </div>
      <button class="tsp-item-delete" onclick="tspRemoveTask('${esc(t.id)}')" title="Delete">🗑</button>
    </div>`;
  }).join('');
}

function tspRemoveTask(id) {
  saveTasks(getTasks().filter(t => t.id !== id));
  renderTaskSidePanel();
  showToast('Task deleted');
}

// ===== TASK STORAGE =====
function getTasks() {
  return JSON.parse(localStorage.getItem('chatmail_tasks') || '[]');
}
function saveTasks(tasks) {
  localStorage.setItem('chatmail_tasks', JSON.stringify(tasks));
}
function removeTask(id) {
  saveTasks(getTasks().filter(t => t.id !== id));
  renderTaskList();
  showToast('Task deleted');
}

function addTaskDirectly(threadId, messageId, snippet) {
  if (!threadId) return;
  const tasks = getTasks();
  tasks.unshift({
    id: Date.now().toString(),
    threadId,
    messageId: messageId || '',
    contactEmail: currentContact ? currentContact.email : '',
    contactName: currentContact ? currentContact.name : '',
    subject: currentContact ? (currentContact.subject || '') : '',
    snippet: snippet || '',
    memo: '',
    createdAt: new Date().toISOString(),
  });
  saveTasks(tasks);
  showToast('Added to tasks ✓');
  openTaskSidePanel();
}

// ===== TASK DETAIL PANEL =====
function showTaskDetailPlaceholder() {
  document.getElementById('tdp-placeholder').style.display = '';
  document.getElementById('tdp-content').style.display = 'none';
  document.querySelectorAll('.task-pinned').forEach(el => el.classList.remove('task-pinned'));
}

async function showTaskDetail(taskId) {
  const task = getTasks().find(t => t.id === taskId);
  if (!task) return;
  currentTaskId = taskId;

  document.querySelectorAll('#contact-list .task-item').forEach(el => {
    el.classList.toggle('active', el.dataset.taskId === taskId);
  });

  const displayName = task.contactName || task.contactEmail || '(unknown)';
  document.getElementById('tdp-avatar').textContent = (displayName[0] || '?').toUpperCase();
  document.getElementById('tdp-avatar').style.background = emailToColor(task.contactEmail || '');
  document.getElementById('tdp-contact').textContent = displayName;
  document.getElementById('tdp-subject').textContent = task.subject || '';
  document.getElementById('tdp-snippet').textContent = task.snippet || '';
  document.getElementById('tdp-snippet').style.display = task.snippet ? '' : 'none';
  document.getElementById('tdp-memo').value = task.memo || '';

  document.getElementById('tdp-placeholder').style.display = 'none';
  document.getElementById('tdp-content').style.display = 'flex';
  document.getElementById('tdp-memo').focus();

  if (task.threadId && gmailConnected) {
    const msgs = document.getElementById('messages');
    msgs.innerHTML = '<div style="text-align:center;padding:40px;color:#aaa;font-size:13px">Loading...</div>';
    const result = await window.electronAPI.gmail.fetchMessages(task.threadId);
    if (result.ok) {
      await renderMessages(result.messages);
      if (task.messageId) {
        requestAnimationFrame(() => {
          document.querySelectorAll('.task-pinned').forEach(el => el.classList.remove('task-pinned'));
          const msgEl = document.querySelector(`.message-group[data-message-id="${CSS.escape(task.messageId)}"]`);
          if (!msgEl) return;
          msgEl.scrollIntoView({ behavior: 'instant', block: 'center' });
          msgEl.classList.add('task-pinned');
        });
      }
    } else {
      msgs.innerHTML = `<div style="text-align:center;padding:40px;color:#aaa;font-size:13px">${esc(task.subject || 'Could not load email')}</div>`;
    }
  }
}

function saveCurrentTask() {
  if (!currentTaskId) return;
  const tasks = getTasks();
  const task = tasks.find(t => t.id === currentTaskId);
  if (task) {
    task.memo = document.getElementById('tdp-memo').value.trim();
    saveTasks(tasks);
    showToast('Task saved');
    renderTaskList();
  }
}

function deleteCurrentTask() {
  if (!currentTaskId) return;
  removeTask(currentTaskId);
  currentTaskId = null;
  showTaskDetailPlaceholder();
}

async function jumpFromTaskDetail() {
  if (!currentTaskId) return;
  await gotoTask(currentTaskId);
}

// ===== TASK LIST =====
let dragTaskId = null;

function renderTaskList() {
  const tasks = getTasks();
  contacts = [];
  const list = document.getElementById('contact-list');

  if (tasks.length === 0) {
    list.innerHTML = `<div class="sidebar-empty"><p>No tasks yet.<br>Hover over an email to see<br>the "✓ Task" button.</p></div>`;
    if (currentView === 'tasks') showTaskDetailPlaceholder();
    return;
  }

  list.innerHTML = tasks.map((t, idx) => {
    const date = new Date(t.createdAt);
    const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;
    const displayName = t.contactName || t.contactEmail || '(unknown)';
    return `
      <div class="contact-item task-item"
           data-task-id="${esc(t.id)}"
           data-task-idx="${idx}"
           draggable="true"
           onclick="showTaskDetail('${esc(t.id)}')">
        <div class="task-drag-handle" title="Drag to reorder">⠿</div>
        <div class="avatar" style="background:${emailToColor(t.contactEmail || '')}">${(displayName[0] || '?').toUpperCase()}</div>
        <div class="contact-info">
          <div class="contact-name">${esc(displayName)}</div>
          <div class="contact-preview">${t.memo ? `📝 ${esc(t.memo)}` : esc(t.subject || t.snippet || '')}</div>
        </div>
        <div class="contact-meta"><span class="contact-time">${dateStr}</span></div>
        <div class="contact-actions" onclick="event.stopPropagation()">
          <button class="contact-action-btn trash" title="Delete task" onclick="removeTask('${esc(t.id)}')">🗑</button>
        </div>
      </div>`;
  }).join('');

  list.querySelectorAll('.task-item').forEach(el => {
    el.addEventListener('dragstart', e => {
      dragTaskId = e.currentTarget.dataset.taskId;
      setTimeout(() => e.currentTarget.classList.add('task-dragging'), 0);
      e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragend', e => {
      e.currentTarget.classList.remove('task-dragging');
      document.querySelectorAll('.task-item').forEach(x => x.classList.remove('task-drag-over'));
    });
    el.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      document.querySelectorAll('.task-item').forEach(x => x.classList.remove('task-drag-over'));
      if (e.currentTarget.dataset.taskId !== dragTaskId) e.currentTarget.classList.add('task-drag-over');
    });
    el.addEventListener('dragleave', e => e.currentTarget.classList.remove('task-drag-over'));
    el.addEventListener('drop', e => {
      e.preventDefault();
      e.currentTarget.classList.remove('task-drag-over');
      const targetId = e.currentTarget.dataset.taskId;
      if (!dragTaskId || dragTaskId === targetId) return;
      let tasks = getTasks();
      const srcIdx = tasks.findIndex(t => t.id === dragTaskId);
      const tgtIdx = tasks.findIndex(t => t.id === targetId);
      if (srcIdx === -1 || tgtIdx === -1) return;
      const [moved] = tasks.splice(srcIdx, 1);
      tasks.splice(tgtIdx, 0, moved);
      saveTasks(tasks);
      renderTaskList();
      dragTaskId = null;
    });
  });

  if (currentView === 'tasks') {
    if (currentTaskId && tasks.find(t => t.id === currentTaskId)) {
      showTaskDetail(currentTaskId);
    } else {
      showTaskDetailPlaceholder();
    }
  }
}

function editTaskMemo(taskId) {
  const tasks = getTasks();
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;
  const taskEl = document.querySelector(`.task-item[data-task-id="${CSS.escape(taskId)}"]`);
  if (!taskEl) return;
  const previewEl = taskEl.querySelector('.contact-preview');
  if (!previewEl) return;

  previewEl.innerHTML = '';
  const textarea = document.createElement('textarea');
  textarea.className = 'task-inline-edit';
  textarea.value = task.memo || '';
  textarea.rows = 2;
  textarea.onclick = e => e.stopPropagation();
  textarea.ondblclick = e => e.stopPropagation();

  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'task-inline-actions';
  actionsDiv.onclick = e => e.stopPropagation();

  const saveBtn = document.createElement('button');
  saveBtn.className = 'task-inline-save';
  saveBtn.textContent = 'Save';
  saveBtn.onclick = e => { e.stopPropagation(); saveTaskMemoInline(taskId, textarea.value); };

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'task-inline-cancel';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.onclick = e => { e.stopPropagation(); renderTaskList(); };

  actionsDiv.appendChild(saveBtn);
  actionsDiv.appendChild(cancelBtn);
  previewEl.appendChild(textarea);
  previewEl.appendChild(actionsDiv);
  textarea.focus();
}

function saveTaskMemoInline(taskId, memo) {
  const tasks = getTasks();
  const task = tasks.find(t => t.id === taskId);
  if (task) { task.memo = memo.trim(); saveTasks(tasks); }
  renderTaskList();
}

async function gotoTask(taskId) {
  const task = getTasks().find(t => t.id === taskId);
  if (!task) return;
  await switchView('inbox');
  const idx = contacts.findIndex(c => c.threadId === task.threadId);
  if (idx !== -1) {
    await selectContact(idx);
    if (task.messageId) {
      requestAnimationFrame(() => {
        const msgEl = document.querySelector(`.message-group[data-message-id="${CSS.escape(task.messageId)}"]`);
        if (!msgEl) return;
        document.querySelectorAll('.task-pinned').forEach(el => el.classList.remove('task-pinned'));
        msgEl.scrollIntoView({ behavior: 'instant', block: 'center' });
        msgEl.classList.add('task-pinned');
      });
    }
  } else {
    showToast('Thread not found in inbox');
  }
}
