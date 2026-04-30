// ===== AVATAR COLOR =====
const AVATAR_COLORS = ['#4f6ef7','#e8605a','#2ab37a','#f5a623','#9b59b6','#e67e22','#1abc9c','#e91e63'];
function emailToColor(email) {
  let hash = 0;
  for (const c of email) hash = c.charCodeAt(0) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('visible');
  setTimeout(() => el.classList.remove('visible'), 3000);
}

function getGreeting(email) {
  const map = JSON.parse(localStorage.getItem('chatmail_greetings') || '{}');
  return map[email] || '';
}

function setGreeting(email, text) {
  const map = JSON.parse(localStorage.getItem('chatmail_greetings') || '{}');
  map[email] = text;
  localStorage.setItem('chatmail_greetings', JSON.stringify(map));
}
