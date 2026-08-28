// Offline speech engine: Moonshine-tiny via transformers.js + ONNX Runtime,
// everything served same-origin from vendor/ and models/ so it works with no
// signal once downloaded. Lazy-loaded — only fetched when the user opts in.
import { normWords } from './matcher.js';

const WINDOW_S = 5;      // transcribe the last N seconds each pass
const INTERVAL_MS = 1200;

let asrP = null, ctx = null, stream = null, worklet = null, timer = 0, running = false;

async function tf() {
  const mod = await import('./vendor/transformers/transformers.min.js');
  const { env } = mod;
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.useBrowserCache = false; // the app's service worker is the single cache
  // MUST stay a relative path: transformers 4.2's local-file existence probe
  // (get_file_metadata) skips URL localPaths entirely, which silently breaks
  // tokenizer/processor discovery when remote models are disabled.
  env.localModelPath = 'models/';
  env.backends.onnx.wasm.wasmPaths = new URL('vendor/transformers/', document.baseURI).href;
  return mod;
}

// dtype chosen by experiment: quantised (q8/int8/uint8) MERGED decoders all
// fail ORT-wasm's weight prepack on this model's tied embeddings; the q4
// decoder uses MatMulNBits natively and loads fine. int8 encoder is safe.
// Plain wasm runs ~12x realtime on desktop — no webgpu needed.
const PIPELINE_OPTS = { dtype: { encoder_model: 'int8', decoder_model_merged: 'q4' }, device: 'wasm' };

// Concurrency-safe: repeated calls share one in-flight load; a failed load
// clears the slot so the user can retry.
export function loadPipeline(progress) {
  asrP ??= (async () => {
    const { pipeline } = await tf();
    const asr = await pipeline('automatic-speech-recognition', 'moonshine-tiny',
                               { ...PIPELINE_OPTS, progress_callback: progress });
    await asr(new Float32Array(1600)); // warm up so the first real pass is quick
    return asr;
  })();
  asrP.catch(() => { asrP = null; });
  return asrP;
}

// Everything the offline engine needs, guaranteed into the service-worker
// cache. Interception alone is not enough: files the browser answers from its
// HTTP cache can slip past, which only shows up later on a truly offline device.
const MODEL_FILES = [
  'config.json', 'generation_config.json', 'preprocessor_config.json',
  'special_tokens_map.json', 'tokenizer.json', 'tokenizer_config.json',
  'onnx/encoder_model_int8.onnx', 'onnx/decoder_model_merged_q4.onnx',
];

// One-off download for the Voice-packs dialog: load the pipeline once (which
// fetches runtime + model and lets the device pick its ORT wasm variant), then
// pin the deterministic file set into the cache and free the memory.
export async function download(progress) {
  await loadPipeline(progress);
  // find the app cache by prefix so sw.js version bumps don't need syncing here
  const name = (await caches.keys()).find(k => k.startsWith('tracingboard-')) || 'tracingboard-v1';
  const c = await caches.open(name);
  await c.addAll([
    ...MODEL_FILES.map(f => new URL('models/moonshine-tiny/' + f, document.baseURI).href),
    new URL('vendor/transformers/transformers.min.js', document.baseURI).href,
  ]);
  await unload();
}
export async function unload() {
  try { const asr = await asrP; await asr?.dispose(); } catch {}
  asrP = null;
}

export async function start({ onWords, onDead }) {
  const asr = await loadPipeline();
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  ctx = new AudioContext({ sampleRate: 16000 });
  const workletSrc = `class Grab extends AudioWorkletProcessor{
    process(inputs){ const c = inputs[0][0]; if (c) this.port.postMessage(c.slice(0)); return true; }
  } registerProcessor('grab', Grab);`;
  await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([workletSrc], { type: 'text/javascript' })));
  worklet = new AudioWorkletNode(ctx, 'grab');
  const chunks = []; let len = 0;
  worklet.port.onmessage = e => {
    chunks.push(e.data); len += e.data.length;
    while (len - chunks[0].length > 16000 * WINDOW_S) len -= chunks.shift().length;
  };
  const sink = ctx.createGain(); sink.gain.value = 0;
  ctx.createMediaStreamSource(stream).connect(worklet);
  worklet.connect(sink); sink.connect(ctx.destination);

  running = true;
  let busy = false, failures = 0;
  timer = setInterval(async () => {
    if (!running || busy || len < 16000) return;
    busy = true;
    try {
      const audio = new Float32Array(len); let o = 0;
      for (const c of chunks) { audio.set(c, o); o += c.length; }
      const out = await asr(audio);
      failures = 0;
      if (running) onWords(normWords(out.text || ''));
    } catch (e) {
      if (++failures >= 3 && running) { stop(); onDead(e.message || 'engine failure'); }
    }
    busy = false;
  }, INTERVAL_MS);
}

export function stop() {
  running = false;
  clearInterval(timer); timer = 0;
  try { worklet?.disconnect(); } catch {}
  try { ctx?.close(); } catch {}
  try { stream?.getTracks().forEach(t => t.stop()); } catch {}
  worklet = ctx = stream = null;
}
