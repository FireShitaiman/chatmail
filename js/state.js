// ===== GLOBAL STATE =====
let addressBook = JSON.parse(localStorage.getItem('chatmail_address_book') || '[]');
let acActiveInput = null;
let acActiveIndex = -1;

let contacts = [];
let currentContact = null;
let gmailConnected = false;
let currentView = 'inbox'; // 'inbox' | 'trash' | 'tasks'
let globalSignature = localStorage.getItem('chatmail_signature') || '';
let autoFilterEnabled = localStorage.getItem('chatmail_auto_filter') !== 'false';
let myEmail = '';
let replyAttachments = [];
let newMailAttachments = [];
let replyTargetEl = null;
let forwardTargetEl = null;
let nextPageToken = null;
let isLoadingMore = false;
let currentMessages = [];
let currentGroupKey = null;
let currentTaskId = null;
let isSearchMode = false;
