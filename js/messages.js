// ===== MESSAGE RENDERING =====
async function renderMessages(messages) {
  const msgs = document.getElementById('messages');
  msgs.innerHTML = '';
  msgs.style.visibility = 'hidden';

  const hasSent = messages.some(m => m.type === 'sent');
  msgs.classList.toggle('received-only', !hasSent);

  messages.forEach(m => {
    if (m.isDivider) {
      const div = document.createElement('div');
      div.className = 'thread-divider';
      div.textContent = m.subject;
      msgs.appendChild(div);
      return;
    }
    if (m.date) {
      const div = document.createElement('div');
      div.className = 'date-divider';
      div.textContent = m.date;
      msgs.appendChild(div);
    }
    const group = document.createElement('div');
    group.className = `message-group ${m.type}`;
    if (m.messageId) group.dataset.messageId = m.messageId;

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

    group.innerHTML = `<div class="bubble-wrap"><div class="bubble">${esc(m.text)}${atts}</div></div><div class="message-time">${esc(m.time)}</div>`;
    const wrap = group.querySelector('.bubble-wrap');

    if (m.type === 'received') {
      const replyBtn = document.createElement('button');
      replyBtn.className = 'msg-action-btn msg-reply-btn';
      replyBtn.textContent = '↩ Reply';
      replyBtn.title = 'Reply to this email';
      replyBtn.addEventListener('click', e => {
        e.stopPropagation();
        exitForwardMode();
        closeTaskSidePanel();
        if (replyTargetEl) replyTargetEl.classList.remove('reply-target');
        replyTargetEl = group;
        group.classList.add('reply-target');

        const senderName = currentContact ? (currentContact.name || currentContact.email) : '';
        const snippet = (m.text || '').slice(0, 80).replace(/\n+/g, ' ');
        document.getElementById('reply-context-sender').textContent = senderName;
        document.getElementById('reply-context-snippet').textContent = snippet;
        document.getElementById('reply-context-bar').classList.remove('hidden');
        document.querySelector('.compose-area').classList.add('reply-active');

        const subj = currentContact ? (currentContact.subject || '') : '';
        setSubjectDisplay('Re', subj);

        const input = document.getElementById('compose-input');
        input.disabled = false;
        input.focus();
        document.querySelector('.compose-area').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
      wrap.appendChild(replyBtn);
    }

    const fwdBtn = document.createElement('button');
    fwdBtn.className = 'msg-action-btn msg-forward-btn';
    fwdBtn.textContent = '↪ Forward';
    fwdBtn.title = 'Forward this email';
    fwdBtn.addEventListener('click', async e => {
      e.stopPropagation();
      if (replyTargetEl) { replyTargetEl.classList.remove('reply-target'); replyTargetEl = null; }
      if (forwardTargetEl) forwardTargetEl.classList.remove('forward-target');
      forwardTargetEl = group;
      group.classList.add('forward-target');

      const fromName = m.type === 'received'
        ? (currentContact ? currentContact.name : '')
        : (myEmail || 'Me');
      const fromEmail = m.type === 'received'
        ? (currentContact ? currentContact.email : '')
        : myEmail;

      let fetchedAttachments = [];
      if (m.attachments && m.attachments.length > 0) {
        const results = await Promise.all(m.attachments.map(async att => {
          const r = await window.electronAPI.gmail.getAttachmentData({
            messageId: m.messageId,
            attachmentId: att.attachmentId,
          });
          if (r.ok) return { name: att.name, mimeType: att.mimeType, data: r.data };
          return null;
        }));
        fetchedAttachments = results.filter(Boolean);
      }

      enterForwardMode({
        text: m.text || '',
        fromName,
        fromEmail,
        subject: currentContact ? (currentContact.subject || '') : '',
        attachments: fetchedAttachments,
      });
    });
    wrap.appendChild(fwdBtn);

    const taskBtn = document.createElement('button');
    taskBtn.className = 'msg-action-btn msg-task-btn';
    taskBtn.textContent = '✓ Task';
    taskBtn.title = 'Add to tasks';
    taskBtn.addEventListener('click', e => {
      e.stopPropagation();
      addTaskDirectly(
        currentContact ? currentContact.threadId : '',
        m.messageId || '',
        (m.text || '').slice(0, 100)
      );
    });
    wrap.appendChild(taskBtn);

    msgs.appendChild(group);
  });

  await loadInlineImages();
  msgs.scrollTop = msgs.scrollHeight;
  msgs.style.visibility = '';
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
  if (!result.ok) alert('Could not open attachment: ' + result.error);
}

function appendSentMessage(text) {
  const msgs = document.getElementById('messages');
  const now = new Date();
  const time = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
  const group = document.createElement('div');
  group.className = 'message-group sent';
  group.innerHTML = `<div class="bubble-wrap"><div class="bubble">${esc(text)}</div></div><div class="message-time">${time}</div>`;
  msgs.appendChild(group);
  msgs.scrollTop = msgs.scrollHeight;
}
