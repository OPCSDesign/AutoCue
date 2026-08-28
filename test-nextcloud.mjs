// Self-check for the Nextcloud sync helpers: node test-nextcloud.mjs
import assert from 'node:assert';
import {
  parseMultistatus, assembleLibrary, stripPrefix, titleOf, naturalSort, nextFilename,
} from './nextcloud.js';

// ── multistatus parsing (shape matches Nextcloud's sabre/dav output) ──
const ROOT = '/remote.php/dav/files/steve/AutoCue/';
const xml = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns" xmlns:oc="http://owncloud.org/ns">
 <d:response>
  <d:href>/remote.php/dav/files/steve/AutoCue/</d:href>
  <d:propstat><d:prop><d:getetag>&quot;root1&quot;</d:getetag><d:resourcetype><d:collection/></d:resourcetype></d:prop>
  <d:status>HTTP/1.1 200 OK</d:status></d:propstat>
 </d:response>
 <d:response>
  <d:href>/remote.php/dav/files/steve/AutoCue/01%20-%20Installation/</d:href>
  <d:propstat><d:prop><d:getetag>&quot;dir1&quot;</d:getetag><d:resourcetype><d:collection/></d:resourcetype></d:prop>
  <d:status>HTTP/1.1 200 OK</d:status></d:propstat>
 </d:response>
 <d:response>
  <d:href>/remote.php/dav/files/steve/AutoCue/Loose%20note.md</d:href>
  <d:propstat><d:prop><d:getetag>&quot;e-loose&quot;</d:getetag><d:resourcetype/></d:prop>
  <d:status>HTTP/1.1 200 OK</d:status></d:propstat>
 </d:response>
 <d:response>
  <d:href>/remote.php/dav/files/steve/AutoCue/Notes%20%26%20Aide.txt</d:href>
  <d:propstat><d:prop><d:getetag>&quot;e-amp&quot;</d:getetag><d:resourcetype/></d:prop>
  <d:status>HTTP/1.1 200 OK</d:status></d:propstat>
 </d:response>
</d:multistatus>`;

const entries = parseMultistatus(xml, ROOT);
assert.strictEqual(entries.length, 3, 'collection itself excluded');
const dir = entries.find(e => e.isDir);
assert.strictEqual(dir.path, '01 - Installation');
assert.strictEqual(dir.etag, 'dir1');
assert.ok(entries.some(e => e.name === 'Notes & Aide.txt'), 'entity + percent decoding');

// ── naming ──
assert.strictEqual(stripPrefix('01 - Opening'), 'Opening');
assert.strictEqual(stripPrefix('10. Closing'), 'Closing');
assert.strictEqual(stripPrefix('2nd Degree Working'), '2nd Degree Working', 'no separator = no prefix');
assert.strictEqual(titleOf('03 - Address to the Brethren.md'), 'Address to the Brethren');
const sorted = naturalSort([{ name: '10 - b.md' }, { name: '2 - a.md' }]);
assert.strictEqual(sorted[0].name, '2 - a.md', 'natural sort: 2 before 10');

// ── etag-diff assembly ──
const root = [
  { path: '01 - Installation', name: '01 - Installation', isDir: true, etag: 'dir1' },
  { path: 'Loose note.md', name: 'Loose note.md', isDir: false, etag: 'e-loose' },
];
const perDir = {
  '01 - Installation': [
    { path: '01 - Installation/01 - Opening.md', name: '01 - Opening.md', isDir: false, etag: 'e-open' },
    { path: '01 - Installation/02 - Address.md', name: '02 - Address.md', isDir: false, etag: 'e-addr-NEW' },
    { path: '01 - Installation/skip.pdf', name: 'skip.pdf', isDir: false, etag: 'e-pdf' },
  ],
};
const prev = [
  { id: '01 - Installation/01 - Opening.md', etag: 'e-open', body: 'kept body', title: 'x', ceremonyId: 'y', order: 9 },
  { id: '01 - Installation/02 - Address.md', etag: 'e-addr-OLD', body: 'stale' },
  { id: '01 - Installation/Deleted.md', etag: 'e-gone', body: 'gone' },
];
const lib = assembleLibrary(root, perDir, prev);
assert.strictEqual(lib.ceremonies.length, 1);
assert.strictEqual(lib.ceremonies[0].name, 'Installation');
assert.strictEqual(lib.kept.length, 1, 'unchanged etag reused without fetch');
assert.strictEqual(lib.kept[0].body, 'kept body');
assert.strictEqual(lib.kept[0].order, 0, 'metadata refreshed on kept pieces');
assert.deepStrictEqual(lib.toFetch.map(f => f.id).sort(),
  ['01 - Installation/02 - Address.md', 'Loose note.md'], 'changed + new fetched; pdf ignored');
assert.ok(!lib.kept.concat(lib.toFetch).some(p => p.id.includes('Deleted')), 'vanished file dropped');
assert.strictEqual(lib.toFetch.find(f => f.id === 'Loose note.md').ceremonyId, null, 'root files are Unfiled');

// ── new-piece filenames ──
assert.strictEqual(nextFilename(['01 - A.md', '02 - B.md'], 'New One'), '03 - New One.md');
assert.strictEqual(nextFilename([], 'First'), '01 - First.md');
assert.strictEqual(nextFilename(['Plain.md'], 'Another'), 'Another.md', 'unnumbered folder stays unnumbered');
assert.strictEqual(nextFilename(['01 - A.md'], 'Bad/Name: x'), '02 - Bad-Name- x.md', 'filesystem-unsafe chars replaced');

console.log('nextcloud self-check: all assertions passed');
