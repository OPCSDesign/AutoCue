// Voice engine chain: Chrome on-device → Moonshine (offline WASM) → cloud.
// Every engine delivers normalised words to onWords; the matcher in app.js is
// engine-agnostic. A fatal error in the active engine falls through to the
// next; an exhausted chain calls onFatal (app switches to autoscroll).
import { normWords } from './matcher.js';

const SR = () => window.SpeechRecognition || window.webkitSpeechRecognition;
const LANG = 'en-GB';

export async function nativeLocalAvailability() {
  const S = SR();
  if (!S?.available) return 'unsupported';
  try { return await S.available({ langs: [LANG], processLocally: true }); }
  catch { return 'unsupported'; }
}
export async function installNativePack(progress) {
  try { return await SR().install({ langs: [LANG], processLocally: true }, progress); }
  catch { return false; }
}

let session = 0;
let active = null; // { name, stop }

export function stopVoice() {
  session++;
  try { active?.stop(); } catch {}
  active = null;
}

export async function startVoice(opts) {
  stopVoice();
  const mySession = session;
  const live = () => session === mySession;

  const chain = [];
  if (await nativeLocalAvailability() === 'available') chain.push(startNative.bind(null, true));
  if (!live()) return;
  if (opts.moonshineReady) chain.push(startMoonshine);
  chain.push(startNative.bind(null, false)); // cloud, the last resort

  next();

  async function next() {
    if (!live()) return;
    const starter = chain.shift();
    if (!starter) { opts.onFatal('No voice engine could start'); return; }
    try { await starter(); } catch { next(); }
  }

  function startNative(local) {
    const S = SR();
    if (!S) throw new Error('no speech api');
    const r = new S();
    r.lang = LANG; r.continuous = true; r.interimResults = true;
    if (local) {
      r.processLocally = true; // throws on builds without on-device support
      try {
        if (window.SpeechRecognitionPhrase && opts.scriptTokens) {
          // Bias recognition toward this piece's distinctive vocabulary.
          const rare = [...new Set(opts.scriptTokens.filter(w => w.length >= 5))].slice(0, 100);
          r.phrases = rare.map(w => new SpeechRecognitionPhrase(w, 2.0));
        }
      } catch {}
    }
    r.onresult = e => {
      if (!live()) return;
      const words = [];
      for (let i = Math.max(0, e.results.length - 3); i < e.results.length; i++)
        words.push(...normWords(e.results[i][0].transcript));
      opts.onWords(words.slice(-10));
    };
    r.onerror = ev => {
      if (!live() || ev.error === 'no-speech' || ev.error === 'aborted') return;
      active = null;
      try { r.stop(); } catch {}
      next(); // this engine is dead — fall through to the next one
    };
    r.onend = () => {
      if (live() && active?.rec === r) setTimeout(() => { try { r.start(); } catch {} }, 250);
    };
    r.start();
    active = { name: local ? 'on-device' : 'online', rec: r, stop: () => { r.onend = null; try { r.stop(); } catch {} } };
    opts.onEngine?.(active.name);
  }

  async function startMoonshine() {
    const m = await import('./moonshine.js');
    if (!live()) return;
    await m.start({
      onWords: w => { if (live()) opts.onWords(w); },
      onDead: () => { if (live() && active?.name === 'offline engine') { active = null; next(); } },
    });
    if (!live()) { m.stop(); return; }
    active = { name: 'offline engine', stop: () => m.stop() };
    opts.onEngine?.(active.name);
  }
}

// Voice-packs dialog helpers.
export async function downloadMoonshine(progress) {
  const m = await import('./moonshine.js');
  await m.download(progress);
}
export async function removeMoonshine() {
  const keep = [];
  try {
    // find the app cache by prefix so sw.js version bumps don't need syncing here
    const name = (await caches.keys()).find(k => k.startsWith('autocue-'));
    if (!name) return 0;
    const cache = await caches.open(name);
    for (const req of await cache.keys()) {
      if (/\/vendor\/transformers\/|\/models\//.test(req.url)) await cache.delete(req);
      else keep.push(req.url);
    }
  } catch {}
  return keep.length;
}
