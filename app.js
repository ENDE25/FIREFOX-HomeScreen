// ── Constants ──────────────────────────────────────────────────
const STORAGE_KEY    = 'homescreen_v2';
const AI_STORAGE_KEY = 'homescreen_ai';
const WP_STORAGE_KEY = 'homescreen_wallpaper';
const SEARCH_KEY     = 'homescreen_search';
const WS_COLORS      = ['#7c6aff', '#ff6a8a', '#3ecf8e', '#f59e0b', '#38bdf8', '#f97316', '#a78bfa'];

const SEARCH_DEFAULTS = {
  engine: { name: 'Google', url: 'https://www.google.com/search?q={q}' },
  ai:     { name: 'Claude', url: 'https://claude.ai/new?q={q}' },
};

const AI_DEFAULTS = [
  { id: 'claude',   name: 'Claude',   url: 'https://claude.ai',         domain: 'claude.ai' },
  { id: 'gemini',   name: 'Gemini',   url: 'https://gemini.google.com', domain: 'gemini.google.com' },
  { id: 'chatgpt',  name: 'ChatGPT',  url: 'https://chatgpt.com',       domain: 'chatgpt.com' },
  { id: 'deepseek', name: 'DeepSeek', url: 'https://chat.deepseek.com', domain: 'deepseek.com' },
];

// ── Storage abstraction ────────────────────────────────────────
// Uses browser.storage when running as an extension (with sync),
// falls back to localStorage for local development.
const storage = (() => {
  const isExtension = typeof browser !== 'undefined' && browser?.storage;

  // localStorage helper: values stored as JSON except raw strings (legacy wallpaper)
  function lsGet(key) {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    try { return JSON.parse(raw); } catch { return raw; }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota */ }
  }

  if (isExtension) {
    return {
      async get(key)            { const r = await browser.storage.sync.get(key);  return r[key] ?? null; },
      async set(key, value)     { await browser.storage.sync.set({ [key]: value }); },
      async remove(key)         { await browser.storage.sync.remove(key); },
      // Wallpaper goes to local (too large for sync's 8 KB/key limit)
      async getLocal(key)       { const r = await browser.storage.local.get(key); return r[key] ?? null; },
      async setLocal(key, value){ await browser.storage.local.set({ [key]: value }); },
      async removeLocal(key)    { await browser.storage.local.remove(key); },
    };
  }

  return {
    async get(key)            { return lsGet(key); },
    async set(key, value)     { lsSet(key, value); },
    async remove(key)         { localStorage.removeItem(key); },
    async getLocal(key)       { return lsGet(key); },
    async setLocal(key, value){ lsSet(key, value); },
    async removeLocal(key)    { localStorage.removeItem(key); },
  };
})();

// ── In-memory state ────────────────────────────────────────────
// All reads come from these variables (fast, sync).
// All writes update the variable AND persist to storage.
let state;          // workspaces + links
let aiShortcuts;    // AI shortcut list
let searchSettings; // engine + AI URLs
let prefs;          // UI preferences (clock, search bars)
let currentWallpaper = null;

function defaultState() {
  return {
    workspaces: [
      {
        id: uid(), name: 'Personal', color: WS_COLORS[0],
        links: [
          { id: uid(), name: 'GitHub',    url: 'https://github.com',         clicks: 5 },
          { id: uid(), name: 'YouTube',   url: 'https://youtube.com',         clicks: 3 },
          { id: uid(), name: 'Wikipedia', url: 'https://wikipedia.org',       clicks: 1 },
        ]
      },
      {
        id: uid(), name: 'Work', color: WS_COLORS[1],
        links: [
          { id: uid(), name: 'Gmail',    url: 'https://mail.google.com',     clicks: 8 },
          { id: uid(), name: 'Drive',    url: 'https://drive.google.com',    clicks: 4 },
          { id: uid(), name: 'Calendar', url: 'https://calendar.google.com', clicks: 2 },
        ]
      },
    ]
  };
}

async function saveState()          { await storage.set(STORAGE_KEY,    state); }
async function saveAiShortcuts()    { await storage.set(AI_STORAGE_KEY,  aiShortcuts); }
async function saveSearch()         { await storage.set(SEARCH_KEY,      searchSettings); }
async function savePref(key, value) { await storage.set(key, value); }

// ── Utils ──────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2, 9); }

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function faviconUrl(url) {
  try { return `https://www.google.com/s2/favicons?domain=${new URL(url).origin}&sz=32`; }
  catch { return null; }
}

function firstLetter(name) { return name.trim()[0]?.toUpperCase() ?? '?'; }

function makeFaviconFallback(name) {
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  const div = document.createElement('div');
  div.className = 'favicon-fallback';
  div.textContent = firstLetter(name);
  div.style.background = `linear-gradient(135deg, hsl(${hue},55%,45%), hsl(${(hue+40)%360},65%,32%))`;
  return div;
}

// ── Inline delete confirmation ─────────────────────────────────
let pendingDeleteBtn = null;

function armDelete(btn, onConfirm) {
  if (pendingDeleteBtn === btn) { onConfirm(); resetPendingDelete(); return; }
  resetPendingDelete();
  pendingDeleteBtn = btn;
  btn.classList.add('confirm-pending');
  btn.textContent = 'sure?';
}

function resetPendingDelete() {
  if (!pendingDeleteBtn) return;
  pendingDeleteBtn.classList.remove('confirm-pending');
  pendingDeleteBtn.textContent = '✕';
  pendingDeleteBtn = null;
}

document.addEventListener('click', e => {
  if (pendingDeleteBtn && !pendingDeleteBtn.contains(e.target)) resetPendingDelete();
}, true);

// ── Render ─────────────────────────────────────────────────────
function renderAll() {
  const row = document.getElementById('workspaces-row');
  row.innerHTML = '';
  state.workspaces.forEach(ws => row.appendChild(buildWorkspaceCol(ws)));
  setupDragDrop();
}

function buildWorkspaceCol(ws) {
  const col = document.createElement('div');
  col.className = 'workspace-col';
  col.dataset.wsId = ws.id;
  col.style.setProperty('--ws-color', ws.color);

  col.innerHTML = `
    <div class="ws-header">
      <div class="ws-drag-handle" title="Drag to reorder">⠿</div>
      <div class="ws-dot"></div>
      <input class="ws-name" value="${escapeHtml(ws.name)}" maxlength="24" spellcheck="false" />
      <button class="add-link-btn" data-ws-id="${ws.id}" title="Add link">+</button>
      <button class="ws-delete-btn" title="Delete workspace">✕</button>
    </div>
    <div class="ws-links" data-ws-id="${ws.id}"></div>
  `;

  const linksEl = col.querySelector('.ws-links');
  [...ws.links]
    .sort((a, b) => b.clicks - a.clicks)
    .forEach(link => linksEl.appendChild(buildLinkCard(link, ws.id)));

  // Rename workspace
  const nameInput = col.querySelector('.ws-name');
  nameInput.addEventListener('blur', async () => {
    const val   = nameInput.value.trim();
    const wsObj = state.workspaces.find(w => w.id === ws.id);
    if (wsObj) wsObj.name = val || ws.name;
    nameInput.value = wsObj?.name ?? ws.name;
    await saveState();
  });
  nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') nameInput.blur(); });

  // Delete workspace
  col.querySelector('.ws-delete-btn').addEventListener('click', e => {
    e.stopPropagation();
    if (state.workspaces.length <= 1) return;
    armDelete(col.querySelector('.ws-delete-btn'), async () => {
      state.workspaces = state.workspaces.filter(w => w.id !== ws.id);
      await saveState();
      renderAll();
    });
  });

  // Add link
  col.querySelector('.add-link-btn').addEventListener('click', () => openModal(null, ws.id));

  // Workspace drag (reorder)
  const handle = col.querySelector('.ws-drag-handle');
  handle.addEventListener('mousedown', () => { col.draggable = true; });
  handle.addEventListener('mouseup',   () => { col.draggable = false; });

  col.addEventListener('dragstart', e => {
    if (e.target !== col) return;
    dragWsId   = ws.id;
    dragLinkId = null;
    col.classList.add('ws-dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  col.addEventListener('dragend', () => {
    col.draggable = false;
    col.classList.remove('ws-dragging');
    dragWsId = null;
    document.querySelectorAll('.workspace-col').forEach(c => c.classList.remove('drag-over'));
  });

  return col;
}

function buildLinkCard(link, wsId) {
  const card = document.createElement('a');
  card.className  = 'link-card';
  card.href       = link.url;
  card.target     = '_blank';
  card.rel        = 'noopener noreferrer';
  card.draggable  = true;
  card.dataset.linkId = link.id;
  card.dataset.wsId   = wsId;

  const iconUrl = faviconUrl(link.url);

  card.innerHTML = `
    <span class="link-name">${escapeHtml(link.name)}</span>
    <div class="card-controls">
      <button class="card-btn edit"   title="Edit">✎</button>
      <button class="card-btn delete" title="Delete">✕</button>
    </div>
  `;

  if (iconUrl) {
    const img = document.createElement('img');
    img.src = iconUrl;
    img.alt = '';
    img.onerror = () => img.replaceWith(makeFaviconFallback(link.name));
    card.insertBefore(img, card.firstChild);
  } else {
    card.insertBefore(makeFaviconFallback(link.name), card.firstChild);
  }

  card.addEventListener('click', e => {
    if (e.target.closest('.card-controls')) return;
    registerClick(link.id, wsId);
  });

  card.querySelector('.card-btn.edit').addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation();
    openModal(link.id, wsId);
  });

  card.querySelector('.card-btn.delete').addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation();
    armDelete(card.querySelector('.card-btn.delete'), () => deleteLink(link.id, wsId));
  });

  return card;
}

// ── Click tracking ─────────────────────────────────────────────
async function registerClick(linkId, wsId) {
  const ws   = state.workspaces.find(w => w.id === wsId);
  const link = ws?.links.find(l => l.id === linkId);
  if (!link) return;
  link.clicks = (link.clicks ?? 0) + 1;
  await saveState();

  const linksEl = document.querySelector(`.ws-links[data-ws-id="${wsId}"]`);
  if (!linksEl) return;
  [...ws.links]
    .sort((a, b) => b.clicks - a.clicks)
    .forEach(l => {
      const cardEl = linksEl.querySelector(`[data-link-id="${l.id}"]`);
      if (cardEl) linksEl.appendChild(cardEl);
    });
}

// ── Drag & drop ────────────────────────────────────────────────
let dragLinkId  = null;
let dragSrcWsId = null;
let dragWsId    = null;

function setupDragDrop() {
  document.querySelectorAll('.link-card').forEach(card => {
    card.addEventListener('dragstart', e => {
      dragLinkId  = card.dataset.linkId;
      dragSrcWsId = card.dataset.wsId;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      document.querySelectorAll('.workspace-col').forEach(c => c.classList.remove('drag-over'));
    });
  });

  document.querySelectorAll('.workspace-col').forEach(col => {
    col.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      document.querySelectorAll('.workspace-col').forEach(c => c.classList.remove('drag-over'));
      const isSelf = dragWsId
        ? col.dataset.wsId === dragWsId
        : col.dataset.wsId === dragSrcWsId;
      if (!isSelf) col.classList.add('drag-over');
    });

    col.addEventListener('dragleave', e => {
      if (!col.contains(e.relatedTarget)) col.classList.remove('drag-over');
    });

    col.addEventListener('drop', async e => {
      e.preventDefault();
      col.classList.remove('drag-over');
      const dstWsId = col.dataset.wsId;
      if (dragWsId) {
        if (dstWsId !== dragWsId) await reorderWorkspace(dragWsId, dstWsId);
      } else if (dragLinkId && dstWsId !== dragSrcWsId) {
        await moveLink(dragLinkId, dragSrcWsId, dstWsId);
      }
    });
  });
}

async function reorderWorkspace(srcWsId, dstWsId) {
  const srcIdx = state.workspaces.findIndex(w => w.id === srcWsId);
  const dstIdx = state.workspaces.findIndex(w => w.id === dstWsId);
  if (srcIdx === -1 || dstIdx === -1) return;
  const [ws] = state.workspaces.splice(srcIdx, 1);
  state.workspaces.splice(dstIdx, 0, ws);
  await saveState();
  renderAll();
}

async function moveLink(linkId, srcWsId, dstWsId) {
  const srcWs = state.workspaces.find(w => w.id === srcWsId);
  const dstWs = state.workspaces.find(w => w.id === dstWsId);
  if (!srcWs || !dstWs) return;
  const idx = srcWs.links.findIndex(l => l.id === linkId);
  if (idx === -1) return;
  const [link] = srcWs.links.splice(idx, 1);
  dstWs.links.push(link);
  await saveState();
  renderAll();
}

// ── CRUD links ─────────────────────────────────────────────────
async function deleteLink(linkId, wsId) {
  const ws = state.workspaces.find(w => w.id === wsId);
  if (!ws) return;
  ws.links = ws.links.filter(l => l.id !== linkId);
  await saveState();
  renderAll();
}

// ── Modal ──────────────────────────────────────────────────────
const overlay    = document.getElementById('modal-overlay');
const linkForm   = document.getElementById('link-form');
const inputName  = document.getElementById('input-name');
const inputUrl   = document.getElementById('input-url');
const editLinkId = document.getElementById('edit-link-id');
const editWsId   = document.getElementById('edit-ws-id');
const modalTitle = document.getElementById('modal-title');

function openModal(linkId, wsId) {
  editLinkId.value = linkId ?? '';
  editWsId.value   = wsId;
  if (linkId) {
    const ws   = state.workspaces.find(w => w.id === wsId);
    const link = ws?.links.find(l => l.id === linkId);
    modalTitle.textContent = 'Edit link';
    inputName.value = link?.name ?? '';
    inputUrl.value  = link?.url  ?? '';
  } else {
    modalTitle.textContent = 'New link';
    linkForm.reset();
  }
  overlay.classList.add('open');
  requestAnimationFrame(() => inputName.focus());
}

function closeModal() { overlay.classList.remove('open'); }

document.getElementById('cancel-btn').addEventListener('click', closeModal);
overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

linkForm.addEventListener('submit', async e => {
  e.preventDefault();
  const name   = inputName.value.trim();
  const url    = inputUrl.value.trim();
  const wsId   = editWsId.value;
  const linkId = editLinkId.value;
  const ws     = state.workspaces.find(w => w.id === wsId);
  if (!ws) return;
  if (linkId) {
    const link = ws.links.find(l => l.id === linkId);
    if (link) { link.name = name; link.url = url; }
  } else {
    ws.links.push({ id: uid(), name, url, clicks: 0 });
  }
  await saveState();
  renderAll();
  closeModal();
});

// ── Add workspace ──────────────────────────────────────────────
document.getElementById('add-ws-btn').addEventListener('click', async () => {
  const color = WS_COLORS[state.workspaces.length % WS_COLORS.length];
  state.workspaces.push({ id: uid(), name: 'New', color, links: [] });
  await saveState();
  renderAll();
  setTimeout(() => {
    const cols   = document.querySelectorAll('.workspace-col');
    const newCol = cols[cols.length - 1];
    const input  = newCol?.querySelector('.ws-name');
    if (input) { input.select(); input.focus(); }
  }, 50);
});

// ── AI shortcuts ───────────────────────────────────────────────
let dragAiId = null;

function renderAiShortcuts() {
  const container = document.getElementById('ai-shortcuts');
  container.innerHTML = '';

  aiShortcuts.forEach(data => {
    const a = document.createElement('a');
    a.className = 'ai-btn';
    a.href      = data.url;
    a.target    = '_blank';
    a.rel       = 'noopener noreferrer';
    a.title     = data.name;
    a.draggable = true;
    a.dataset.aiId = data.id;

    const img = document.createElement('img');
    img.src = `https://www.google.com/s2/favicons?domain=${data.domain}&sz=64`;
    img.alt = data.name;
    a.appendChild(img);
    container.appendChild(a);
  });

  container.querySelectorAll('.ai-btn').forEach(btn => {
    btn.addEventListener('dragstart', e => {
      dragAiId = btn.dataset.aiId;
      btn.classList.add('ai-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.stopPropagation();
    });

    btn.addEventListener('dragend', () => {
      btn.classList.remove('ai-dragging');
      container.querySelectorAll('.ai-btn').forEach(b => b.classList.remove('ai-drag-over'));
      dragAiId = null;
    });

    btn.addEventListener('dragover', e => {
      if (!dragAiId || btn.dataset.aiId === dragAiId) return;
      e.preventDefault();
      container.querySelectorAll('.ai-btn').forEach(b => b.classList.remove('ai-drag-over'));
      btn.classList.add('ai-drag-over');
    });

    btn.addEventListener('dragleave', () => btn.classList.remove('ai-drag-over'));

    btn.addEventListener('drop', async e => {
      e.preventDefault();
      e.stopPropagation();
      btn.classList.remove('ai-drag-over');
      const dstId  = btn.dataset.aiId;
      if (!dragAiId || dstId === dragAiId) return;
      const srcIdx = aiShortcuts.findIndex(a => a.id === dragAiId);
      const dstIdx = aiShortcuts.findIndex(a => a.id === dstId);
      const [item] = aiShortcuts.splice(srcIdx, 1);
      aiShortcuts.splice(dstIdx, 0, item);
      await saveAiShortcuts();
      renderAiShortcuts();
      renderAiSettingsList();
    });
  });
}

function renderAiSettingsList() {
  const list     = document.getElementById('ai-settings-list');
  list.innerHTML = '';

  aiShortcuts.forEach(data => {
    const row = document.createElement('div');
    row.className = 'ai-settings-row';

    const img = document.createElement('img');
    img.src = `https://www.google.com/s2/favicons?domain=${data.domain}&sz=32`;
    img.alt = data.name;

    const name = document.createElement('span');
    name.textContent = data.name;

    const del = document.createElement('button');
    del.className   = 'ai-settings-del';
    del.textContent = '✕';
    del.addEventListener('click', () => {
      armDelete(del, async () => {
        aiShortcuts = aiShortcuts.filter(a => a.id !== data.id);
        await saveAiShortcuts();
        renderAiShortcuts();
        renderAiSettingsList();
      });
    });

    row.appendChild(img);
    row.appendChild(name);
    row.appendChild(del);
    list.appendChild(row);
  });
}

document.getElementById('ai-add-form').addEventListener('submit', async e => {
  e.preventDefault();
  const nameVal = document.getElementById('ai-add-name').value.trim();
  const urlVal  = document.getElementById('ai-add-url').value.trim();
  let domain;
  try { domain = new URL(urlVal).hostname; } catch { return; }
  aiShortcuts.push({ id: uid(), name: nameVal, url: urlVal, domain });
  await saveAiShortcuts();
  renderAiShortcuts();
  renderAiSettingsList();
  document.getElementById('ai-add-form').reset();
});

// ── Clock toggle ───────────────────────────────────────────────
function applyClockVisibility(visible) {
  document.querySelector('header').classList.toggle('clock-hidden', !visible);
}

const toggleClock = document.getElementById('toggle-clock');
toggleClock.addEventListener('change', async () => {
  prefs.clock = toggleClock.checked;
  await savePref('homescreen_clock', prefs.clock);
  applyClockVisibility(prefs.clock);
});

// ── Search bar toggles ─────────────────────────────────────────
function applySearchVisibility() {
  document.getElementById('web-search-form').style.display = prefs.webSearch ? '' : 'none';
  document.getElementById('ai-search-form').style.display  = prefs.aiSearch  ? '' : 'none';
}

const toggleWebSearch = document.getElementById('toggle-web-search');
const toggleAiSearch  = document.getElementById('toggle-ai-search');

toggleWebSearch.addEventListener('change', async () => {
  prefs.webSearch = toggleWebSearch.checked;
  await savePref('homescreen_web_search', prefs.webSearch);
  applySearchVisibility();
});

toggleAiSearch.addEventListener('change', async () => {
  prefs.aiSearch = toggleAiSearch.checked;
  await savePref('homescreen_ai_search', prefs.aiSearch);
  applySearchVisibility();
});

// ── Search ─────────────────────────────────────────────────────
function openSearch(urlTemplate, query) {
  window.open(urlTemplate.replace('{q}', encodeURIComponent(query)), '_blank', 'noopener,noreferrer');
}

function updateSearchPlaceholders() {
  document.getElementById('ai-search-input').placeholder = `Ask ${searchSettings.ai.name}...`;
}

document.getElementById('web-search-form').addEventListener('submit', e => {
  e.preventDefault();
  const q = document.getElementById('web-search-input').value.trim();
  if (!q) return;
  openSearch(searchSettings.engine.url, q);
  e.target.reset();
});

document.getElementById('ai-search-form').addEventListener('submit', e => {
  e.preventDefault();
  const q = document.getElementById('ai-search-input').value.trim();
  if (!q) return;
  openSearch(searchSettings.ai.url, q);
  e.target.reset();
});

function initSearchSettings() {
  const engineInput = document.getElementById('engine-url-input');
  const aiInput     = document.getElementById('ai-url-input');

  engineInput.value = searchSettings.engine.url;
  aiInput.value     = searchSettings.ai.url;

  highlightPreset('engine-presets', searchSettings.engine.url);
  highlightPreset('ai-presets',     searchSettings.ai.url);

  document.getElementById('engine-presets').querySelectorAll('button').forEach(btn => {
    btn.onclick = async () => {
      searchSettings.engine = { name: btn.dataset.name, url: btn.dataset.url };
      await saveSearch();
      engineInput.value = btn.dataset.url;
      highlightPreset('engine-presets', btn.dataset.url);
    };
  });

  document.getElementById('ai-presets').querySelectorAll('button').forEach(btn => {
    btn.onclick = async () => {
      searchSettings.ai = { name: btn.dataset.name, url: btn.dataset.url };
      await saveSearch();
      aiInput.value = btn.dataset.url;
      highlightPreset('ai-presets', btn.dataset.url);
      updateSearchPlaceholders();
    };
  });

  engineInput.onblur = async () => {
    const url = engineInput.value.trim();
    if (!url) return;
    try { new URL(url.replace('{q}', 'test')); } catch { return; }
    searchSettings.engine = { name: new URL(url.replace('{q}', 'test')).hostname, url };
    await saveSearch();
    highlightPreset('engine-presets', url);
  };

  aiInput.onblur = async () => {
    const url = aiInput.value.trim();
    if (!url) return;
    try { new URL(url.replace('{q}', 'test')); } catch { return; }
    searchSettings.ai = { name: new URL(url.replace('{q}', 'test')).hostname, url };
    await saveSearch();
    highlightPreset('ai-presets', url);
    updateSearchPlaceholders();
  };
}

function highlightPreset(containerId, activeUrl) {
  document.getElementById(containerId).querySelectorAll('button').forEach(btn => {
    btn.classList.toggle('preset-active', btn.dataset.url === activeUrl);
  });
}

// ── Wallpaper ──────────────────────────────────────────────────
function applyWallpaper(src) {
  currentWallpaper = src;
  if (src) {
    document.body.style.backgroundImage     = `url(${src})`;
    document.body.style.backgroundSize      = 'cover';
    document.body.style.backgroundPosition  = 'center';
    document.body.style.backgroundAttachment = 'fixed';
    document.body.classList.add('has-wallpaper');
  } else {
    document.body.style.backgroundImage = '';
    document.body.classList.remove('has-wallpaper');
  }
  updateWallpaperHint();
}

function updateWallpaperHint() {
  const hint = document.getElementById('wallpaper-hint');
  if (hint) hint.textContent = currentWallpaper ? 'Wallpaper active' : 'No wallpaper set';
}

document.getElementById('wallpaper-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async ev => {
    const src = ev.target.result;
    await storage.setLocal(WP_STORAGE_KEY, src);
    applyWallpaper(src);
  };
  reader.readAsDataURL(file);
  e.target.value = '';
});

document.getElementById('wallpaper-clear').addEventListener('click', async () => {
  await storage.removeLocal(WP_STORAGE_KEY);
  applyWallpaper(null);
});

// ── Settings panel ─────────────────────────────────────────────
const settingsPanel   = document.getElementById('settings-panel');
const settingsOverlay = document.getElementById('settings-overlay');

function openSettings() {
  settingsPanel.classList.add('open');
  settingsOverlay.classList.add('open');
  renderAiSettingsList();
  updateWallpaperHint();
  initSearchSettings();
}

function closeSettings() {
  settingsPanel.classList.remove('open');
  settingsOverlay.classList.remove('open');
}

document.getElementById('settings-btn').addEventListener('click', openSettings);
document.getElementById('settings-close').addEventListener('click', closeSettings);
settingsOverlay.addEventListener('click', closeSettings);

// ── Clock ──────────────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  const h   = String(now.getHours()).padStart(2, '0');
  const m   = String(now.getMinutes()).padStart(2, '0');
  document.getElementById('clock').textContent = `${h}:${m}`;
  document.getElementById('date').textContent  =
    now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

updateClock();
setInterval(updateClock, 10_000);

// ── Export / Import ────────────────────────────────────────────
document.getElementById('export-btn').addEventListener('click', () => {
  const data = {
    version: 1,
    exported: new Date().toISOString(),
    state,
    aiShortcuts,
    searchSettings,
    prefs,
    wallpaper: currentWallpaper,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `homescreen-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('import-input').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  const hint = document.getElementById('import-hint');
  try {
    const data = JSON.parse(await file.text());
    if (!data.state || !data.aiShortcuts || !data.searchSettings) throw new Error('invalid');

    state          = data.state;
    aiShortcuts    = data.aiShortcuts;
    searchSettings = data.searchSettings;
    if (data.prefs) prefs = { ...prefs, ...data.prefs };

    await saveState();
    await saveAiShortcuts();
    await saveSearch();
    await savePref('homescreen_clock',      prefs.clock);
    await savePref('homescreen_web_search', prefs.webSearch);
    await savePref('homescreen_ai_search',  prefs.aiSearch);

    if (data.wallpaper) {
      await storage.setLocal(WP_STORAGE_KEY, data.wallpaper);
      applyWallpaper(data.wallpaper);
    } else {
      await storage.removeLocal(WP_STORAGE_KEY);
      applyWallpaper(null);
    }

    toggleClock.checked     = prefs.clock;
    toggleWebSearch.checked = prefs.webSearch;
    toggleAiSearch.checked  = prefs.aiSearch;
    applyClockVisibility(prefs.clock);
    applySearchVisibility();
    updateSearchPlaceholders();
    renderAll();
    renderAiShortcuts();
    renderAiSettingsList();
    initSearchSettings();

    hint.style.color = 'var(--accent)';
    hint.textContent = 'Import successful.';
  } catch {
    hint.style.color = '#ff6a8a';
    hint.textContent = 'Import failed: invalid file.';
  }
  e.target.value = '';
});

// ── Init ───────────────────────────────────────────────────────
(async () => {
  try {
    state          = await storage.get(STORAGE_KEY)    ?? defaultState();
    aiShortcuts    = await storage.get(AI_STORAGE_KEY) ?? [...AI_DEFAULTS];
    searchSettings = { ...SEARCH_DEFAULTS, ...(await storage.get(SEARCH_KEY) ?? {}) };
    currentWallpaper = await storage.getLocal(WP_STORAGE_KEY);

    prefs = {
      clock:     (await storage.get('homescreen_clock'))      ?? true,
      webSearch: (await storage.get('homescreen_web_search')) ?? true,
      aiSearch:  (await storage.get('homescreen_ai_search'))  ?? true,
    };
  } catch (err) {
    console.error('HomeScreen: storage init failed, using defaults.', err);
    state          = defaultState();
    aiShortcuts    = [...AI_DEFAULTS];
    searchSettings = { ...SEARCH_DEFAULTS };
    prefs          = { clock: true, webSearch: true, aiSearch: true };
  }

  toggleClock.checked     = prefs.clock;
  toggleWebSearch.checked = prefs.webSearch;
  toggleAiSearch.checked  = prefs.aiSearch;

  applyClockVisibility(prefs.clock);
  applySearchVisibility();
  applyWallpaper(currentWallpaper);
  updateSearchPlaceholders();
  renderAll();
  renderAiShortcuts();
})();
