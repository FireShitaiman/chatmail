// ===== ADDRESS BOOK =====
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

document.addEventListener('mousedown', function(e) {
  const dropdown = document.getElementById('addr-dropdown');
  if (dropdown.classList.contains('visible') && !dropdown.contains(e.target)) {
    hideSuggestions();
  }
});

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
