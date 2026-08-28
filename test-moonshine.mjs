// End-to-end check of the vendored offline voice model: synthesise a spoken
// sentence with Windows TTS, transcribe it with the SAME model files the app
// serves (models/moonshine-tiny), assert most words come through.
//   npm install && node test-moonshine.mjs
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import assert from 'node:assert';
import { pipeline, env } from '@huggingface/transformers';
import { normWords } from './matcher.js';

const SENTENCE = 'Brethren, it is my intention to open the lodge in due form for the despatch of business';
const WAV = new URL('.tmp-test-speech.wav', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');

if (!existsSync(WAV)) {
  const ps = `Add-Type -AssemblyName System.Speech; ` +
    `$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ` +
    `$f = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono); ` +
    `$s.SetOutputToWaveFile('${WAV}', $f); $s.Speak('${SENTENCE.replace(/'/g, "''")}'); $s.Dispose()`;
  execSync(`powershell -NoProfile -Command "${ps.replace(/"/g, '\\"')}"`);
}

// Minimal RIFF reader for the 16 kHz mono 16-bit file we just generated.
const buf = readFileSync(WAV);
assert.strictEqual(buf.readUInt32LE(24), 16000, 'wav must be 16 kHz');
const dataIdx = buf.indexOf('data');
const n = buf.readUInt32LE(dataIdx + 4) / 2;
const audio = new Float32Array(n);
for (let i = 0; i < n; i++) audio[i] = buf.readInt16LE(dataIdx + 8 + 2 * i) / 32768;
console.log(`audio: ${(n / 16000).toFixed(1)}s of synthesised speech`);

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = new URL('models/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
// Same dtype config the app uses in the browser (see moonshine.js PIPELINE_OPTS).
const asr = await pipeline('automatic-speech-recognition', 'moonshine-tiny',
  { dtype: { encoder_model: 'int8', decoder_model_merged: 'q4' } });
const out = await asr(audio);
console.log('transcript:', out.text);

const expected = [...new Set(normWords(SENTENCE))];
const got = new Set(normWords(out.text || ''));
const hits = expected.filter(w => got.has(w));
console.log(`matched ${hits.length}/${expected.length} expected words`);
assert.ok(hits.length >= expected.length * 0.5,
  `offline model recognised too little: ${hits.length}/${expected.length}`);
console.log('moonshine self-check: PASS');
