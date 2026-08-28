// Nextcloud WebDAV sync — pull-mostly, tiny push surface.
// The library lives in {server}/remote.php/dav/files/{user}/AutoCue/:
// one folder per ceremony, one .md/.txt file per piece, "01 - " prefixes give
// the running order. Pure helpers (parse/assemble/naming) are exported for
// test-nextcloud.mjs; only pull/push/mkcol/migrate touch the network.

const NC_KEY = 'autocue.nc';

export function ncConfig() {
  try { return JSON.parse(localStorage.getItem(NC_KEY)); } catch { return null; }
}
export function ncSave(cfg) { localStorage.setItem(NC_KEY, JSON.stringify(cfg)); }
export function ncSignOut() { localStorage.removeItem(NC_KEY); }

export function normalizeServer(url) {
  url = url.trim().replace(/\/+$/, '');
  if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
  return url;
}

/* ── pure helpers ── */

export const isPieceFile = name => /\.(md|txt)$/i.test(name);
export const stripPrefix = name => name.replace(/^\s*\d+\s*[-–.)]\s+/, '');
export const titleOf = name => stripPrefix(name.replace(/\.(md|txt)$/i, ''));
export const naturalSort = arr =>
  [...arr].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
export const safeName = s => s.replace(/[\\/:*?"<>|]/g, '-').trim();
export const pad2 = n => String(n).padStart(2, '0');

// Minimal entity decoding for DAV hrefs/etags (sabre emits well-formed XML).
const unent = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                    .replace(/&quot;/g, '"').replace(/&apos;/g, "'");

// ponytail: regex extraction instead of DOMParser so the same code runs in the
// node tests; Nextcloud's sabre/dav multistatus output is stable and simple.
export function parseMultistatus(xml, rootAbs) {
  rootAbs = rootAbs.replace(/\/+$/, '') + '/';
  const out = [];
  const respRe = /<(?:[\w-]+:)?response(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w-]+:)?response>/g;
  for (const [, block] of xml.matchAll(respRe)) {
    const href = decodeURIComponent(unent(block.match(/<(?:[\w-]+:)?href(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w-]+:)?href>/)?.[1] || ''));
    const isDir = /<(?:[\w-]+:)?collection\s*\/?>/.test(block);
    const norm = href.replace(/\/+$/, '') + (isDir ? '/' : '');
    if (!norm.startsWith(rootAbs)) continue;
    const rel = norm.slice(rootAbs.length).replace(/\/+$/, '');
    if (!rel) continue; // the listed collection itself
    const etag = unent(block.match(/<(?:[\w-]+:)?getetag(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w-]+:)?getetag>/)?.[1] || '').replace(/^W\//, '').replace(/"/g, '');
    out.push({ path: rel, name: rel.split('/').pop(), isDir, etag });
  }
  return out;
}

// Decide the new library shape from listings + the previous pieces (etag diff).
// Returns { ceremonies, kept, toFetch } — kept are pieces reused as-is,
// toFetch = [{path, name, ceremonyId, order, etag}] whose bodies need a GET.
export function assembleLibrary(rootEntries, perDir, prevPieces) {
  const dirs = naturalSort(rootEntries.filter(e => e.isDir));
  const ceremonies = dirs.map((d, i) => ({ id: d.path, name: stripPrefix(d.name), order: i }));
  const groups = dirs.map(d => ({ cid: d.path, files: perDir[d.path] || [] }));
  groups.push({ cid: null, files: rootEntries.filter(e => !e.isDir) });

  const prev = new Map((prevPieces || []).map(p => [p.id, p]));
  const kept = [], toFetch = [];
  for (const g of groups) {
    naturalSort(g.files.filter(f => !f.isDir && isPieceFile(f.name))).forEach((f, i) => {
      const meta = { id: f.path, title: titleOf(f.name), ceremonyId: g.cid, order: i, etag: f.etag };
      const old = prev.get(f.path);
      if (old && old.etag === f.etag) kept.push({ ...old, ...meta });
      else toFetch.push(meta);
    });
  }
  return { ceremonies, kept, toFetch };
}

// Next filename for a new piece among existing sibling names.
export function nextFilename(siblingNames, title) {
  const prefixes = siblingNames.map(n => n.match(/^\s*(\d+)\s*[-–.)]\s+/)).filter(Boolean);
  const numbered = siblingNames.length === 0 || prefixes.length === siblingNames.length;
  const base = safeName(title) || 'Untitled';
  if (!numbered) return base + '.md';
  const next = prefixes.length ? Math.max(...prefixes.map(m => +m[1])) + 1 : 1;
  return `${pad2(next)} - ${base}.md`;
}

/* ── WebDAV client ── */

const davRoot = cfg => `${cfg.server}/remote.php/dav/files/${encodeURIComponent(cfg.user)}/`;
const base = cfg => davRoot(cfg) + 'AutoCue/';
const encodePath = p => p.split('/').map(encodeURIComponent).join('/');

async function dav(cfg, method, path, { headers = {}, body, root = false } = {}) {
  return fetch((root ? davRoot(cfg) : base(cfg)) + path, {
    method, body,
    headers: { Authorization: 'Basic ' + btoa(cfg.user + ':' + cfg.pass), ...headers },
  });
}

const PROPFIND_BODY =
  '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getetag/><d:resourcetype/></d:prop></d:propfind>';

async function list(cfg, relPath, depth = '1') {
  const res = await dav(cfg, 'PROPFIND', relPath ? encodePath(relPath) + '/' : '', {
    headers: { Depth: depth, 'Content-Type': 'application/xml' }, body: PROPFIND_BODY,
  });
  if (!res.ok) { const e = new Error('PROPFIND ' + res.status); e.status = res.status; throw e; }
  const rootAbs = new URL(base(cfg)).pathname + (relPath ? relPath + '/' : '');
  return parseMultistatus(await res.text(), decodeURIComponent(rootAbs))
    .map(x => relPath ? { ...x, path: relPath + '/' + x.path } : x);
}

export async function statEtag(cfg, path) {
  const res = await dav(cfg, 'PROPFIND', encodePath(path), {
    headers: { Depth: '0', 'Content-Type': 'application/xml' }, body: PROPFIND_BODY,
  });
  if (!res.ok) return null;
  const m = (await res.text()).match(/<(?:[\w-]+:)?getetag(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w-]+:)?getetag>/);
  return m ? unent(m[1]).replace(/^W\//, '').replace(/"/g, '') : null;
}

// status: 'ok' | 'missing' (auth fine, no AutoCue folder) | 'auth' | 'network'
export async function checkConnection(cfg) {
  try {
    const res = await dav(cfg, 'PROPFIND', '', { headers: { Depth: '0', 'Content-Type': 'application/xml' }, body: PROPFIND_BODY });
    if (res.ok) return 'ok';
    if (res.status === 401 || res.status === 403) return 'auth';
    if (res.status === 404) {
      const home = await dav(cfg, 'PROPFIND', '', { root: true, headers: { Depth: '0', 'Content-Type': 'application/xml' }, body: PROPFIND_BODY });
      return home.ok ? 'missing' : home.status === 401 || home.status === 403 ? 'auth' : 'network';
    }
    return 'network';
  } catch { return 'network'; } // CORS misconfig and offline both land here
}

export async function pull(cfg, prevPieces) {
  const rootEntries = await list(cfg, '');
  const dirs = rootEntries.filter(e => e.isDir);
  const perDir = {};
  await Promise.all(dirs.map(async d => { perDir[d.path] = await list(cfg, d.path); }));
  const { ceremonies, kept, toFetch } = assembleLibrary(rootEntries, perDir, prevPieces);
  const fetched = [];
  for (let i = 0; i < toFetch.length; i += 6) {
    await Promise.all(toFetch.slice(i, i + 6).map(async meta => {
      const res = await dav(cfg, 'GET', encodePath(meta.id));
      if (!res.ok) throw new Error('GET ' + res.status);
      fetched.push({ ...meta, body: await res.text() });
    }));
  }
  const pieces = [...kept, ...fetched];
  pieces.sort((a, b) => (a.ceremonyId || '').localeCompare(b.ceremonyId || '') || a.order - b.order);
  return { ceremonies, pieces };
}

// Save an edited body. Returns {etag} on success, {conflict:true} if the file
// changed on another device since we pulled it.
export async function pushBody(cfg, path, body, etag) {
  const res = await dav(cfg, 'PUT', encodePath(path), {
    headers: { 'If-Match': `"${etag}"`, 'Content-Type': 'text/markdown' }, body,
  });
  if (res.status === 412) return { conflict: true };
  if (!res.ok) throw new Error('PUT ' + res.status);
  return { etag: await statEtag(cfg, path) };
}

export async function createPiece(cfg, folder, filename, body) {
  const path = folder ? folder + '/' + filename : filename;
  const res = await dav(cfg, 'PUT', encodePath(path), {
    headers: { 'If-None-Match': '*', 'Content-Type': 'text/markdown' }, body,
  });
  if (res.status === 412) throw new Error('A file with that name already exists');
  if (!res.ok) throw new Error('PUT ' + res.status);
  return { path, etag: await statEtag(cfg, path) };
}

export async function mkcol(cfg, folder) {
  const res = await dav(cfg, 'MKCOL', folder ? encodePath(folder) + '/' : '');
  if (!res.ok && res.status !== 405) throw new Error('MKCOL ' + res.status); // 405 = already exists
}

// One-time upload of this device's library into an empty/missing AutoCue folder.
export async function migrate(cfg, store) {
  await mkcol(cfg, '');
  const ceremonies = [...store.ceremonies].sort((a, b) => a.order - b.order);
  const folderOf = {};
  for (let i = 0; i < ceremonies.length; i++) {
    const folder = `${pad2(i + 1)} - ${safeName(ceremonies[i].name)}`;
    folderOf[ceremonies[i].id] = folder;
    await mkcol(cfg, folder);
  }
  const groups = [...ceremonies.map(c => c.id), null];
  for (const cid of groups) {
    const items = store.pieces.filter(p => (p.ceremonyId || null) === cid).sort((a, b) => a.order - b.order);
    for (let i = 0; i < items.length; i++) {
      const folder = cid ? folderOf[cid] : '';
      const filename = `${pad2(i + 1)} - ${safeName(items[i].title)}.md`;
      const path = folder ? folder + '/' + filename : filename;
      await dav(cfg, 'PUT', encodePath(path), { headers: { 'Content-Type': 'text/markdown' }, body: items[i].body });
    }
  }
}
