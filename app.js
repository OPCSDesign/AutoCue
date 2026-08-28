import { normWords, advance } from './matcher.js';
import {
  startVoice as voiceStart, stopVoice as voiceStop,
  nativeLocalAvailability, installNativePack, downloadMoonshine, removeMoonshine,
} from './voice.js';
import * as NC from './webdav.js';

const ncMode = () => !!NC.ncConfig();

const $ = s => document.querySelector(s);
const uuid = () => crypto.randomUUID();
const KEY = 'autocue.v1';
const CUR_LEN = 10;          // tokens highlighted as the "current passage"

/* ─────────────────────────── store ─────────────────────────── */

let store;
function load() {
  try { store = JSON.parse(localStorage.getItem(KEY)); } catch { store = null; }
  if (!store || !Array.isArray(store.pieces))
    store = ncMode() ? { ceremonies: [], pieces: [], settings: {} } : seed();
  store.settings = Object.assign({ fs: 28, speed: 1.0, mode: 'auto' }, store.settings);
}
function save() { localStorage.setItem(KEY, JSON.stringify(store)); }

function seed() {
  const cid = uuid();
  return {
    ceremonies: [{ id: cid, name: 'Start here', order: 0 }],
    pieces: [
      {
        id: uuid(), title: 'Welcome to TracingBoard', ceremonyId: cid, order: 0,
        body: `[This is a stage direction — shown dim and italic. Voice-follow ignores it.]

Welcome, Worshipful Master. This is TracingBoard, your personal ritual prompter.

Tap anywhere to pause or resume. Drag with a finger to move through the text freely. The arrow button below steps back four lines whenever you need to retrace your words.

The mode button switches between Voice, Auto and Manual. In Voice mode the text follows your speech and gently brightens the passage you are about to deliver. In Auto mode the text scrolls at a steady, adjustable pace. In Manual mode nothing moves unless you move it.

Use the tortoise and the hare to change the pace, and the A buttons — or a two-finger pinch — to change the size of the text.

When you are ready, press Exit and add your first piece.`
      },
      {
        id: uuid(), title: 'Writing and transferring pieces', ceremonyId: cid, order: 1,
        body: `There are two ways to manage your pieces.

The simple way: create and edit them right here, using the pencil and the plus Piece button. Everything then lives on this device alone.

The better way, if you use more than one device: keep the whole library in your own cloud storage — Nextcloud, or any WebDAV provider. Open the menu, choose Cloud sync, connect with an app password, and pick or create the folder you want the library to live in. The one-off server preparation is described in the NEXTCLOUD guide in the app's code repository.

[In your cloud folder: one subfolder per ceremony, one .md file per piece.]

Give files a number to set the running order, such as 01 - Opening Address.md — the numbers stay hidden here. A blank line starts a new paragraph, and directions go in square brackets.

Once connected, edit pieces anywhere: in any editor on your computer, in your cloud provider's apps, or right here — edits made here are saved straight back. Rename, reorder, move or delete pieces in your provider's files app, then tap Sync. The app always keeps an offline copy, so nothing depends on a connection when it matters.

Two last things live in the menu: Voice packs, where one download makes Voice mode work without internet, and the Cloud sync dialog's Export and Import, kept as an occasional backup.`
      },
    ],
    settings: { fs: 28, speed: 1.0, mode: 'auto', openCeremonies: [cid] }, // tutorial starts open
  };
}

const piecesIn = cid =>
  store.pieces.filter(p => (p.ceremonyId || null) === cid).sort((a, b) => a.order - b.order);
const ceremonies = () => [...store.ceremonies].sort((a, b) => a.order - b.order);

/* ─────────────────────── screens & history ─────────────────────── */

let screen = 'library';
function show(name) {
  screen = name;
  for (const n of ['library', 'editor', 'prompter'])
    $('#screen-' + n).classList.toggle('active', n === name);
}
function enterSub(name) { history.pushState({ sub: name }, ''); show(name); }
function backToLibrary() { if (history.state?.sub) history.back(); else closeSub(); }
function closeSub() {
  stopEngines(); releaseLock();
  show('library'); renderLibrary();
}
addEventListener('popstate', () => { if (screen !== 'library') closeSub(); });

/* ─────────────────────────── toast ─────────────────────────── */

let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2600);
}

/* ─────────────────────────── library ─────────────────────────── */

function renderLibrary() {
  const list = $('#lib-list'); list.textContent = '';
  const q = $('#search').value.trim().toLowerCase();
  if (q) {
    const hits = store.pieces
      .filter(p => p.title.toLowerCase().includes(q) || p.body.toLowerCase().includes(q))
      .sort((a, b) => b.title.toLowerCase().includes(q) - a.title.toLowerCase().includes(q));
    if (!hits.length) list.innerHTML = '<p class="empty">No matches.</p>';
    for (const p of hits) list.appendChild(pieceRow(p, { showCeremony: true }));
    return;
  }
  for (const c of ceremonies()) list.appendChild(groupEl(c));
  if (piecesIn(null).length) list.appendChild(groupEl(null));
  if (!store.pieces.length)
    list.innerHTML = '<p class="empty">Nothing here yet — press “+ Piece” to add your first speech.</p>';
}

function groupEl(c) {
  const d = document.createElement('details');
  d.className = 'cer';
  // collapsed by default; the set of open ceremonies persists across visits
  const key = c ? c.id : '__unfiled';
  d.open = (store.settings.openCeremonies || []).includes(key);
  d.addEventListener('toggle', () => {
    const set = new Set(store.settings.openCeremonies || []);
    d.open ? set.add(key) : set.delete(key);
    store.settings.openCeremonies = [...set];
    save();
  });
  const sum = document.createElement('summary');
  const items = piecesIn(c ? c.id : null);
  sum.innerHTML = `<span>${esc(c ? c.name : 'Unfiled')}</span><span class="count">${items.length}</span><span class="spacer"></span>`;
  if (c && !ncMode()) {
    for (const [label, fn] of [
      ['↑', () => moveCeremony(c.id, -1)], ['↓', () => moveCeremony(c.id, 1)],
      ['✎', () => renameCeremony(c.id)], ['🗑', () => deleteCeremony(c.id)],
    ]) {
      const b = document.createElement('button');
      b.className = 'iconbtn'; b.textContent = label;
      b.onclick = e => { e.preventDefault(); e.stopPropagation(); fn(); };
      sum.appendChild(b);
    }
  }
  d.appendChild(sum);
  if (!items.length) d.insertAdjacentHTML('beforeend', '<p class="empty">Empty.</p>');
  for (const p of items) d.appendChild(pieceRow(p));
  return d;
}

function pieceRow(p, { showCeremony } = {}) {
  const row = document.createElement('div'); row.className = 'piece-row';
  const t = document.createElement('div'); t.className = 'title';
  const cname = showCeremony && p.ceremonyId
    ? ` <span class="count">· ${esc(store.ceremonies.find(c => c.id === p.ceremonyId)?.name || '')}</span>` : '';
  t.innerHTML = esc(p.title) + cname;
  t.onclick = () => openPrompter(p.id);
  row.appendChild(t);
  const actions = ncMode()
    ? [['✎', () => openEditor(p.id)]] // rename/move/reorder happen in Nextcloud files
    : [['↑', () => movePiece(p.id, -1)], ['↓', () => movePiece(p.id, 1)], ['✎', () => openEditor(p.id)]];
  for (const [label, fn] of actions) {
    const b = document.createElement('button');
    b.className = 'iconbtn'; b.textContent = label; b.onclick = fn;
    row.appendChild(b);
  }
  return row;
}

const esc = s => s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

function reindex(arr) { arr.forEach((x, i) => (x.order = i)); }
function movePiece(id, dir) {
  const p = store.pieces.find(x => x.id === id);
  const sibs = piecesIn(p.ceremonyId || null);
  const i = sibs.indexOf(p), j = i + dir;
  if (j < 0 || j >= sibs.length) return;
  [sibs[i], sibs[j]] = [sibs[j], sibs[i]];
  reindex(sibs); save(); renderLibrary();
}
function moveCeremony(id, dir) {
  const cs = ceremonies();
  const i = cs.findIndex(c => c.id === id), j = i + dir;
  if (j < 0 || j >= cs.length) return;
  [cs[i], cs[j]] = [cs[j], cs[i]];
  reindex(cs); save(); renderLibrary();
}
async function newCeremony() {
  const name = prompt('Ceremony name:');
  if (!name?.trim()) return null;
  if (ncMode()) {
    // folder gets the next "NN - " prefix; reuse the piece-filename numbering rules
    const folder = NC.nextFilename(store.ceremonies.map(c => c.id), name.trim()).replace(/\.md$/, '');
    try { await NC.mkcol(NC.ncConfig(), folder); } catch (e) { toast('Could not create folder: ' + e.message); return null; }
    await syncNow({ silent: true });
    return store.ceremonies.find(c => c.id === folder) || null;
  }
  const c = { id: uuid(), name: name.trim(), order: store.ceremonies.length };
  store.ceremonies.push(c); save(); renderLibrary();
  return c;
}
function renameCeremony(id) {
  const c = store.ceremonies.find(x => x.id === id);
  const name = prompt('Ceremony name:', c.name);
  if (name?.trim()) { c.name = name.trim(); save(); renderLibrary(); }
}
function deleteCeremony(id) {
  const c = store.ceremonies.find(x => x.id === id);
  if (!confirm(`Delete ceremony “${c.name}”? Its pieces are kept and become Unfiled.`)) return;
  store.pieces.forEach(p => { if (p.ceremonyId === id) p.ceremonyId = null; });
  store.ceremonies = store.ceremonies.filter(x => x.id !== id);
  save(); renderLibrary();
}

/* ─────────────────────── export / import ─────────────────────── */

function doExport() {
  const data = { app: 'autocue', version: 1, exported: new Date().toISOString(),
                 ceremonies: store.ceremonies, pieces: store.pieces };
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `tracingboard-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click(); URL.revokeObjectURL(a.href);
  toast('Backup downloaded');
}
async function doImport(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.pieces) || !Array.isArray(data.ceremonies)) throw 0;
    if (!confirm(`Import “${file.name}”?\nThis replaces all pieces and ceremonies on this device (display settings are kept).`)) return;
    store.ceremonies = data.ceremonies; store.pieces = data.pieces;
    save(); renderLibrary();
    toast(`Imported ${data.pieces.length} pieces`);
  } catch { toast('That file is not a TracingBoard backup.'); }
}

/* ─────────────────────── nextcloud sync ─────────────────────── */

const timeNow = () => new Date().toTimeString().slice(0, 5);
let syncing = false;

function setSyncStatus(msg) {
  const el = $('#sync-status');
  $('#btn-sync').hidden = !ncMode();
  $('#lib-foot').textContent = ncMode()
    ? 'Library synced from your cloud folder — an offline copy is kept on this device.'
    : 'Content lives only on this device — Export regularly as a backup.';
  if (!ncMode()) { el.hidden = true; return; }
  el.hidden = false;
  el.textContent = msg ||
    (store.settings.lastSync ? `☁ Synced ${store.settings.lastSync}` : '☁ Not synced yet');
}

async function syncNow({ silent } = {}) {
  const cfg = NC.ncConfig();
  if (!cfg || syncing) return;
  syncing = true; setSyncStatus('☁ Syncing…');
  try {
    const { ceremonies, pieces } = await NC.pull(cfg, store.pieces);
    if (!pieces.length && store.pieces.length && !store.settings.ncSynced) {
      // never wipe a local library against a still-empty remote — offer upload instead
      setSyncStatus();
      if (!silent) toast('Your library folder is empty — use Upload in the ☁ dialog first');
    } else {
      store.ceremonies = ceremonies; store.pieces = pieces;
      store.settings.lastSync = timeNow();
      if (pieces.length) store.settings.ncSynced = true;
      save(); renderLibrary(); setSyncStatus();
    }
  } catch (e) {
    setSyncStatus();
    if (!silent) toast('Sync failed — using the copy on this device');
  }
  syncing = false;
}

let ncPending = null; // validated credentials awaiting a folder choice
let browsePath = '';

function showNcSection(name) {
  for (const s of ['signin', 'browse', 'connected'])
    $('#nc-' + s).hidden = s !== name;
}

function refreshNcDialog() {
  const cfg = NC.ncConfig();
  showNcSection(cfg ? 'connected' : 'signin');
  $('#btn-import').disabled = !!cfg;
  $('#btn-import').title = cfg ? 'Sign out of cloud sync to import a backup file' : '';
  if (cfg) {
    $('#nc-account').textContent = `${cfg.user} @ ${cfg.server.replace(/^https?:\/\//, '')}`;
    $('#nc-folder').textContent = '/' + (cfg.path || '');
    $('#nc-status').textContent = store.settings.lastSync ? `Last sync ${store.settings.lastSync}` : 'Not synced yet';
  } else providerHelp();
}

function providerHelp() {
  const webdav = $('#nc-provider').value === 'webdav';
  $('#nc-server').placeholder = webdav ? 'https://server/dav/ (full WebDAV address)' : 'https://cloud.example.com';
  $('#nc-provider-help').textContent = webdav
    ? 'Enter your provider’s full WebDAV address, plus username and password (use an app password where offered). The server must allow browser access (CORS) — see the guide in the repository.'
    : 'Use a dedicated app password (Nextcloud → Settings → Security). The one-off server setup for browser access (CORS) is described in NEXTCLOUD.md in the repository.';
}

async function ncConnect() {
  const cfg = {
    mode: $('#nc-provider').value,
    server: NC.normalizeServer($('#nc-server').value),
    user: $('#nc-user').value.trim(),
    pass: $('#nc-pass').value,
    path: '',
  };
  const msg = $('#nc-msg');
  if (!cfg.server || !cfg.user || !cfg.pass) { msg.textContent = 'Fill in all three fields.'; return; }
  const btn = $('#nc-connect');
  btn.disabled = true; msg.textContent = 'Connecting…';
  const status = await NC.checkAuth(cfg);
  btn.disabled = false;
  if (status === 'auth') { msg.textContent = 'Sign-in failed — check the username and password.'; return; }
  if (status === 'network') {
    msg.textContent = 'Could not reach the server. Check the address — and that the one-off CORS setup from the guide is in place.';
    return;
  }
  msg.textContent = '';
  ncPending = cfg; browsePath = '';
  showNcSection('browse');
  renderBrowse();
}

async function renderBrowse() {
  $('#nc-crumb').textContent = '/' + browsePath;
  $('#nc-use').disabled = !browsePath; // the account root itself can't be the library
  const listEl = $('#nc-dirs');
  listEl.innerHTML = '<p class="empty">Loading…</p>';
  let dirs;
  try { dirs = await NC.listFolders(ncPending, browsePath); }
  catch (e) { listEl.innerHTML = `<p class="empty">Could not list folders (${esc(e.message)}).</p>`; return; }
  listEl.textContent = '';
  if (browsePath) {
    const up = document.createElement('button');
    up.className = 'dir-row'; up.textContent = '⬑  ..';
    up.onclick = () => { browsePath = browsePath.split('/').slice(0, -1).join('/'); renderBrowse(); };
    listEl.appendChild(up);
  }
  for (const d of dirs) {
    const b = document.createElement('button');
    b.className = 'dir-row'; b.textContent = '📁 ' + d.name;
    b.onclick = () => { browsePath = d.path; renderBrowse(); };
    listEl.appendChild(b);
  }
  if (!dirs.length && !browsePath)
    listEl.innerHTML = '<p class="empty">No folders here yet — create one below.</p>';
}

async function ncNewFolder() {
  const name = prompt('New folder name:', browsePath ? '' : 'TracingBoard');
  if (!name?.trim()) return;
  const path = (browsePath ? browsePath + '/' : '') + NC.safeName(name.trim());
  try { await NC.mkcolAt(ncPending, path); browsePath = path; renderBrowse(); }
  catch (e) { toast('Could not create folder: ' + e.message); }
}

async function ncUseFolder() {
  const cfg = { ...ncPending, path: browsePath };
  const btn = $('#nc-use'); btn.disabled = true;
  try {
    const remote = await NC.pull(cfg, []);
    const hasLocal = store.pieces.length > 0;
    if (remote.pieces.length && hasLocal &&
        !confirm('That folder already holds a library. Replace the content on this device with it?\n(Export a backup first if unsure.)')) {
      btn.disabled = false; return;
    }
    NC.ncSave(cfg); ncPending = null;
    $('#nc-pass').value = '';
    if (remote.pieces.length || !hasLocal) {
      store.ceremonies = remote.ceremonies; store.pieces = remote.pieces;
      store.settings.lastSync = timeNow(); store.settings.ncSynced = remote.pieces.length > 0;
      save(); renderLibrary();
      toast('Cloud sync connected');
      $('#nc-migrate-row').hidden = true;
    } else {
      store.settings.ncSynced = false; save();
      $('#nc-migrate-row').hidden = false; // empty folder + local content → offer upload
    }
    refreshNcDialog(); setSyncStatus();
  } catch (e) {
    toast('Could not read that folder: ' + e.message);
    btn.disabled = false;
  }
}

function ncChangeFolder() {
  ncPending = { ...NC.ncConfig() };
  browsePath = '';
  showNcSection('browse');
  renderBrowse();
}

function ncBrowseCancel() {
  ncPending = null;
  refreshNcDialog();
}

async function ncMigrate() {
  const btn = $('#nc-migrate');
  btn.disabled = true; $('#nc-migrate-msg').textContent = 'Uploading…';
  try {
    await NC.migrate(NC.ncConfig(), store);
    store.settings.ncSynced = true; save();
    await syncNow({ silent: true });
    $('#nc-migrate-row').hidden = true;
    toast('Library uploaded to Nextcloud');
    refreshNcDialog();
  } catch (e) {
    $('#nc-migrate-msg').textContent = 'Upload failed: ' + e.message;
  } finally { btn.disabled = false; }
}

function ncSignOut() {
  if (!confirm('Sign out of cloud sync on this device? The library stays here as a local copy.')) return;
  NC.ncSignOut();
  store.settings.ncSynced = false; save();
  refreshNcDialog(); setSyncStatus(); renderLibrary();
}

/* ────────────────────── voice packs dialog ────────────────────── */

async function openVoicePacks() {
  const dlg = $('#dlg-voice');
  dlg.showModal();
  refreshMoonRow();
  $('#vp-native').textContent = 'checking…'; $('#vp-native-btn').hidden = true;
  const avail = await nativeLocalAvailability();
  $('#vp-native').textContent = {
    available: 'Installed — Voice mode uses it automatically',
    downloadable: 'Available — Chrome downloads it once',
    downloading: 'Downloading…',
    unavailable: 'Not offered for this device/language yet',
    unsupported: 'Not supported by this browser yet',
  }[avail] || avail;
  $('#vp-native-btn').hidden = avail !== 'downloadable';
}
function refreshMoonRow() {
  const ready = store.settings.moonshine === 'ready';
  $('#vp-moon').textContent = ready
    ? 'Downloaded — Voice works fully offline'
    : 'Not downloaded (~80 MB, one-off, needs internet)';
  $('#vp-moon-btn').textContent = ready ? 'Remove' : 'Download';
}
async function nativePackInstall() {
  const btn = $('#vp-native-btn');
  btn.disabled = true; $('#vp-native').textContent = 'Downloading…';
  const ok = await installNativePack();
  btn.disabled = false;
  $('#vp-native').textContent = ok ? 'Installed — Voice mode uses it automatically'
                                   : 'Download failed — try again later';
  btn.hidden = !!ok;
}
async function moonPackToggle() {
  const btn = $('#vp-moon-btn');
  if (store.settings.moonshine === 'ready') {
    await removeMoonshine();
    store.settings.moonshine = 'none'; save(); refreshMoonRow();
    return;
  }
  btn.disabled = true;
  $('#vp-moon').textContent = 'Downloading — takes a minute or two…';
  const seen = {};
  try {
    await downloadMoonshine(p => {
      if (p.status === 'progress' && p.file) {
        seen[p.file] = p.loaded || 0;
        const mb = Object.values(seen).reduce((a, b) => a + b, 0) / 1048576;
        $('#vp-moon').textContent = `Downloading… ${mb.toFixed(0)} MB`;
      } else if (p.status === 'ready') {
        $('#vp-moon').textContent = 'Preparing engine…';
      }
    });
    store.settings.moonshine = 'ready'; save();
    try { await navigator.storage.persist(); } catch {} // ask the browser not to evict it
  } catch (e) {
    console.warn('offline voice download failed:', e);
    $('#vp-moon').textContent = 'Download failed — are you online?';
  }
  btn.disabled = false; refreshMoonRow();
}

/* ─────────────────────────── editor ─────────────────────────── */

let editingId = null;
function openEditor(id) {
  editingId = id;
  const p = id ? store.pieces.find(x => x.id === id) : null;
  const locked = ncMode() && !!p; // rename/move via Nextcloud files, not here
  $('#ed-title').value = p?.title || '';
  $('#ed-title').disabled = locked;
  $('#ed-text').value = p?.body || '';
  fillCeremonySelect(p?.ceremonyId || '');
  $('#ed-ceremony').disabled = locked;
  $('#ed-delete').style.visibility = p && !ncMode() ? 'visible' : 'hidden';
  $('#ed-help').textContent = ncMode()
    ? 'Text edits save back to your cloud folder. Rename, move, reorder or delete pieces in your cloud storage’s files app. [Square brackets] = stage directions; blank line = new paragraph.'
    : 'Wrap stage directions in [square brackets] — shown dim & italic, ignored by voice-follow. Blank line starts a new paragraph.';
  renderScriptInto($('#ed-preview'), p?.body || '');
  enterSub('editor');
}
function fillCeremonySelect(sel) {
  const s = $('#ed-ceremony'); s.textContent = '';
  s.append(new Option('— No ceremony —', ''));
  for (const c of ceremonies()) s.append(new Option(c.name, c.id, false, c.id === sel));
  s.append(new Option('+ New ceremony…', '__new'));
}
async function saveEditor() {
  let cid = $('#ed-ceremony').value;
  if (cid === '__new') { const c = await newCeremony(); cid = c ? c.id : ''; fillCeremonySelect(cid); }
  const title = $('#ed-title').value.trim() || 'Untitled';
  const body = $('#ed-text').value;

  if (ncMode()) {
    const cfg = NC.ncConfig();
    let p = editingId && store.pieces.find(x => x.id === editingId);
    if (p) {
      const r = await NC.pushBody(cfg, p.id, body, p.etag);
      if (r.conflict) {
        await syncNow({ silent: true });
        toast('Changed on another device — refreshed. Your text is still here; Save again to overwrite.');
        return null; // editor keeps the user's text
      }
      p.body = body; p.etag = r.etag; save();
      return p;
    }
    const siblings = store.pieces.filter(x => (x.ceremonyId || null) === (cid || null)).map(x => x.id.split('/').pop());
    const { path } = await NC.createPiece(cfg, cid || '', NC.nextFilename(siblings, title), body);
    await syncNow({ silent: true });
    editingId = path;
    return store.pieces.find(x => x.id === path) || null;
  }

  let p = editingId && store.pieces.find(x => x.id === editingId);
  if (!p) {
    p = { id: uuid(), title, ceremonyId: cid || null, order: piecesIn(cid || null).length, body };
    store.pieces.push(p); editingId = p.id;
  } else {
    if ((p.ceremonyId || null) !== (cid || null)) p.order = piecesIn(cid || null).length;
    Object.assign(p, { title, ceremonyId: cid || null, body });
  }
  save();
  $('#ed-delete').style.visibility = 'visible';
  return p;
}
function deletePiece() {
  const p = store.pieces.find(x => x.id === editingId);
  if (!p || !confirm(`Delete “${p.title}”? This cannot be undone.`)) return;
  store.pieces = store.pieces.filter(x => x.id !== editingId);
  save(); backToLibrary();
}

/* ─────────────────── script rendering (shared) ─────────────────── */

function renderScriptInto(root, body) {
  root.textContent = '';
  const tokens = [], spans = [];
  for (const block of body.replace(/\r/g, '').split(/\n{2,}/)) {
    if (!block.trim()) continue;
    const p = document.createElement('p');
    block.split('\n').forEach((line, li) => {
      if (li) p.appendChild(document.createElement('br'));
      for (const seg of line.split(/(\[[^\]]*\])/)) {
        if (!seg) continue;
        if (seg.startsWith('[') && seg.endsWith(']')) {
          const s = document.createElement('span');
          s.className = 'dir'; s.textContent = seg.slice(1, -1);
          p.appendChild(s);
        } else {
          for (const w of seg.split(/(\s+)/)) {
            if (!w) continue;
            if (/^\s+$/.test(w)) { p.appendChild(document.createTextNode(' ')); continue; }
            const toks = normWords(w);
            if (!toks.length) { p.appendChild(document.createTextNode(w)); continue; }
            const s = document.createElement('span');
            s.className = 'w'; s.textContent = w;
            p.appendChild(s);
            for (const t of toks) { tokens.push(t); spans.push(s); }
          }
        }
      }
    });
    root.appendChild(p);
  }
  return { tokens, spans };
}

/* ─────────────────────────── prompter ─────────────────────────── */

const P = {
  piece: null, tokens: [], spans: [], offsets: [],
  pos: 0, mode: 'auto', playing: false,
  raf: 0, lastT: 0, scrollF: 0, wl: null,
};
const scroller = () => $('#scroller');
const readingOffset = () => scroller().clientHeight * 0.33;
const lineHeight = () => store.settings.fs * 1.6;
const pxPerSec = () => lineHeight() * 10 * store.settings.speed / 60; // ×1.0 ≈ 10 lines/min

function openPrompter(id) {
  stopEngines();
  P.piece = store.pieces.find(x => x.id === id);
  store.settings.lastPieceId = id; save();
  const { tokens, spans } = renderScriptInto($('#script'), P.piece.body);
  P.tokens = tokens; P.spans = spans; P.pos = 0;
  P.mode = store.settings.mode;
  applyFont();
  $('#p-title').textContent = P.piece.title;
  updateModeBtn(); updateSpeedRo(); updateNav();
  if (screen !== 'prompter') enterSub('prompter');
  scroller().scrollTop = 0; P.scrollF = 0;
  computeOffsets(); setPos(0, true);
  pause(P.mode === 'manual' ? 'Manual — swipe to scroll' : 'Tap to start');
  acquireLock();
}

function updateNav() {
  const sibs = piecesIn(P.piece.ceremonyId || null);
  const i = sibs.findIndex(x => x.id === P.piece.id);
  $('#p-prev').disabled = i <= 0;
  $('#p-next').disabled = i < 0 || i >= sibs.length - 1;
}
function stepPiece(dir) {
  const sibs = piecesIn(P.piece.ceremonyId || null);
  const i = sibs.findIndex(x => x.id === P.piece.id) + dir;
  if (i < 0 || i >= sibs.length) return;
  openPrompter(sibs[i].id);
  toast(sibs[i].title);
}

/* position & highlight */
function classify(i, pos) {
  const el = P.spans[i]; if (!el) return;
  el.classList.toggle('past', i < pos);
  el.classList.toggle('cur', i >= pos && i < pos + CUR_LEN);
}
function setPos(np, force) {
  np = Math.max(0, Math.min(np, P.tokens.length));
  if (np === P.pos && !force) return;
  const lo = Math.min(P.pos, np), hi = Math.max(P.pos, np);
  const a = Math.max(0, lo - CUR_LEN - 2), b = Math.min(P.spans.length, hi + CUR_LEN + 2);
  for (let i = a; i < b; i++) classify(i, np);
  P.pos = np;
}
function computeOffsets() {
  P.offsets = P.spans.map(s => s.offsetTop);
}
function posIdxFromScroll() {
  const y = scroller().scrollTop + readingOffset() + lineHeight() / 2;
  let lo = 0, hi = P.offsets.length - 1, ans = 0;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (P.offsets[m] <= y) { ans = m; lo = m + 1; } else hi = m - 1;
  }
  return ans;
}
function scrollToPos(instant) {
  const i = Math.min(P.pos, P.offsets.length - 1);
  if (i < 0) return;
  const target = Math.max(0, P.offsets[i] - readingOffset());
  if (Math.abs(scroller().scrollTop - target) < 4) return;
  P.progScroll = Date.now();
  scroller().scrollTo({ top: target, behavior: instant ? 'instant' : 'smooth' });
}

/* autoscroll engine */
function tick(t) {
  if (!P.playing || P.mode !== 'auto') { P.raf = 0; return; }
  const dt = Math.min(0.1, (t - P.lastT) / 1000); P.lastT = t;
  const sc = scroller();
  if (Math.abs(sc.scrollTop - P.scrollF) > 2) P.scrollF = sc.scrollTop; // user scrubbed
  P.scrollF += pxPerSec() * dt;
  sc.scrollTop = P.scrollF;
  if (sc.scrollTop >= sc.scrollHeight - sc.clientHeight - 1) {
    pause('End of piece'); return;
  }
  P.raf = requestAnimationFrame(tick);
}

/* voice engine — the chain (on-device → offline engine → online) lives in voice.js */
function startVoice() {
  voiceStart({
    scriptTokens: P.tokens,
    moonshineReady: store.settings.moonshine === 'ready',
    onWords: words => {
      const np = advance(P.tokens, P.pos, words);
      if (np > P.pos) { setPos(np); scrollToPos(); }
    },
    onEngine: name => {
      toast(`Listening — ${name}`);
      if (name === 'online' && !store.settings.voiceTipShown) {
        store.settings.voiceTipShown = true; save();
        setTimeout(() => toast('Tip: “🎙 Voice packs” in the library enables offline voice'), 3200);
      }
    },
    onFatal: () => {
      toast('Voice unavailable — switched to Auto');
      setMode('auto'); play();
    },
  });
}
function stopVoice() { voiceStop(); }

/* play / pause / modes */
function play() {
  P.playing = true; pill(false); hideBarsSoon();
  if (P.mode === 'auto') {
    P.lastT = performance.now(); P.scrollF = scroller().scrollTop;
    if (!P.raf) P.raf = requestAnimationFrame(tick);
  } else if (P.mode === 'voice') startVoice();
}
function pause(msg = 'Paused — tap to resume') {
  P.playing = false; stopVoice();
  if (P.raf) { cancelAnimationFrame(P.raf); P.raf = 0; }
  pill(msg); showBars();
}
function stopEngines() { P.playing = false; stopVoice(); if (P.raf) { cancelAnimationFrame(P.raf); P.raf = 0; } }

function setMode(m) {
  stopEngines();
  P.mode = m; store.settings.mode = m; save();
  updateModeBtn();
  pause(m === 'manual' ? 'Manual — swipe to scroll' : 'Tap to start');
}
function cycleMode() {
  const order = ['auto', 'voice', 'manual'];
  setMode(order[(order.indexOf(P.mode) + 1) % order.length]);
}
function updateModeBtn() {
  $('#p-mode').textContent = { auto: 'Auto', voice: '🎙 Voice', manual: 'Manual' }[P.mode];
}
function pill(msg) {
  const el = $('#pill');
  if (!msg) { el.hidden = true; return; }
  el.textContent = msg; el.hidden = false;
}

/* control bars auto-hide */
let barsT;
function showBars() { $('#screen-prompter').classList.remove('bars-hidden'); clearTimeout(barsT); }
function hideBarsSoon() {
  clearTimeout(barsT);
  barsT = setTimeout(() => $('#screen-prompter').classList.add('bars-hidden'), 2500);
}

/* settings controls */
function applyFont() {
  document.documentElement.style.setProperty('--fs', store.settings.fs + 'px');
}
let refontT;
function changeFont(delta, absolute) {
  const fs = Math.round(Math.max(16, Math.min(72, absolute ?? store.settings.fs + delta)));
  if (fs === store.settings.fs) return;
  store.settings.fs = fs; applyFont(); save();
  clearTimeout(refontT);
  refontT = setTimeout(() => { computeOffsets(); scrollToPos(true); P.scrollF = scroller().scrollTop; }, 250);
}
function changeSpeed(d) {
  store.settings.speed = Math.round(Math.max(0.3, Math.min(3, store.settings.speed + d)) * 10) / 10;
  save(); updateSpeedRo();
}
function updateSpeedRo() { $('#p-speed').textContent = '×' + store.settings.speed.toFixed(1); }

function nudge(lines) {
  const sc = scroller();
  sc.scrollTop = Math.max(0, sc.scrollTop + lines * lineHeight());
  P.scrollF = sc.scrollTop;
  setPos(posIdxFromScroll());
  showBars(); if (P.playing) hideBarsSoon();
}

/* wake lock */
async function acquireLock() {
  try { P.wl = await navigator.wakeLock?.request('screen'); } catch {}
}
function releaseLock() { try { P.wl?.release(); } catch {} P.wl = null; }
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && screen === 'prompter') acquireLock();
});

/* gestures: tap = pause/resume · drag = scrub · pinch = font size */
function bindPrompterGestures() {
  const sc = scroller();
  const pointers = new Map();
  let startDist = 0, startFs = 0, moved = false, downT = 0;

  sc.addEventListener('pointerdown', e => {
    pointers.set(e.pointerId, e);
    moved = false; downT = Date.now();
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      startDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      startFs = store.settings.fs;
    }
  });
  sc.addEventListener('pointermove', e => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    if (Math.hypot(e.clientX - prev.clientX, e.clientY - prev.clientY) > 10) moved = true;
    pointers.set(e.pointerId, e);
    if (pointers.size === 2 && startDist) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      changeFont(0, startFs * d / startDist);
      moved = true;
    }
  });
  const up = e => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) startDist = 0;
    if (pointers.size) return;
    // pointercancel = the browser took the gesture as a native scroll — never a tap
    if (e.type !== 'pointercancel' && !moved && Date.now() - downT < 600) {
      if (P.mode === 'manual') {
        $('#screen-prompter').classList.contains('bars-hidden') ? showBars() : hideBarsSoon();
      } else P.playing ? pause() : play();
    }
  };
  sc.addEventListener('pointerup', up);
  sc.addEventListener('pointercancel', up);

  // Highlight follows the reading line whenever the user scrolls (including a
  // scrub in voice mode — that's how you move backwards past the forward-only
  // matcher). Ignore scroll events caused by our own smooth-scrolling.
  let scrollT = 0;
  sc.addEventListener('scroll', () => {
    if (scrollT) return;
    scrollT = setTimeout(() => {
      scrollT = 0;
      if (!P.offsets.length) return;
      if (P.mode === 'voice' && Date.now() - (P.progScroll || 0) < 600) return;
      setPos(posIdxFromScroll());
    }, 150);
  }, { passive: true });
}

/* keyboard (desktop testing / bluetooth keyboards) */
addEventListener('keydown', e => {
  if (screen !== 'prompter' || e.target.matches('input,textarea,select')) return;
  const k = e.key;
  if (k === ' ') { e.preventDefault(); P.mode === 'manual' ? showBars() : (P.playing ? pause() : play()); }
  else if (k === 'ArrowUp') { e.preventDefault(); nudge(-4); }
  else if (k === 'ArrowDown') { e.preventDefault(); nudge(4); }
  else if (k === '+' || k === '=') changeFont(2);
  else if (k === '-') changeFont(-2);
  else if (k === ']') changeSpeed(0.1);
  else if (k === '[') changeSpeed(-0.1);
});

addEventListener('resize', () => {
  if (screen !== 'prompter' || !P.spans.length) return;
  clearTimeout(refontT);
  refontT = setTimeout(() => { computeOffsets(); scrollToPos(true); P.scrollF = scroller().scrollTop; }, 250);
});

/* ─────────────────────────── wiring ─────────────────────────── */

function bind() {
  $('#btn-new-piece').onclick = () => openEditor(null);
  $('#lib-menu').addEventListener('click', e => {
    if (e.target.closest('button')) $('#lib-menu').hidePopover();
  });
  $('#btn-new-ceremony').onclick = newCeremony;
  $('#btn-export').onclick = doExport;
  $('#btn-import').onclick = () => $('#file-import').click();
  $('#btn-sync').onclick = () => syncNow();
  $('#btn-nc').onclick = () => { refreshNcDialog(); $('#dlg-nc').showModal(); };
  $('#nc-close').onclick = () => { ncPending = null; $('#dlg-nc').close(); };
  $('#nc-provider').onchange = providerHelp;
  $('#nc-connect').onclick = ncConnect;
  $('#nc-newfolder').onclick = ncNewFolder;
  $('#nc-use').onclick = ncUseFolder;
  $('#nc-browse-cancel').onclick = ncBrowseCancel;
  $('#nc-changefolder').onclick = ncChangeFolder;
  $('#nc-sync').onclick = () => { syncNow(); refreshNcDialog(); };
  $('#nc-migrate').onclick = ncMigrate;
  $('#nc-signout').onclick = ncSignOut;
  $('#btn-voice').onclick = openVoicePacks;
  $('#vp-close').onclick = () => $('#dlg-voice').close();
  $('#vp-native-btn').onclick = nativePackInstall;
  $('#vp-moon-btn').onclick = moonPackToggle;
  $('#file-import').onchange = e => { if (e.target.files[0]) doImport(e.target.files[0]); e.target.value = ''; };
  $('#search').oninput = renderLibrary;

  $('#ed-back').onclick = backToLibrary;
  $('#ed-save').onclick = async () => {
    try { if (await saveEditor()) toast('Saved'); }
    catch (e) { toast('Save failed: ' + e.message); }
  };
  $('#ed-prompt').onclick = async () => {
    try { const p = await saveEditor(); if (p) openPrompter(p.id); }
    catch (e) { toast('Save failed: ' + e.message); }
  };
  $('#ed-delete').onclick = deletePiece;
  let prevT;
  $('#ed-text').oninput = () => {
    clearTimeout(prevT);
    prevT = setTimeout(() => renderScriptInto($('#ed-preview'), $('#ed-text').value), 300);
  };

  $('#p-exit').onclick = backToLibrary;
  $('#p-prev').onclick = () => stepPiece(-1);
  $('#p-next').onclick = () => stepPiece(1);
  $('#p-mode').onclick = cycleMode;
  $('#p-nudge').onclick = () => nudge(-4);
  $('#p-restart').onclick = () => { setPos(0, true); scrollToPos(true); P.scrollF = 0; pause('Tap to start'); };
  $('#p-slow').onclick = () => changeSpeed(-0.1);
  $('#p-fast').onclick = () => changeSpeed(0.1);
  $('#p-smaller').onclick = () => changeFont(-2);
  $('#p-bigger').onclick = () => changeFont(2);
  for (const bar of document.querySelectorAll('.bar'))
    bar.addEventListener('pointerdown', showBars);

  bindPrompterGestures();
}

load();
bind();
applyFont();
renderLibrary();
setSyncStatus();
if (ncMode() && navigator.onLine) syncNow({ silent: true });

if ('serviceWorker' in navigator) {
  try { navigator.serviceWorker.register('sw.js'); } catch {}
}
