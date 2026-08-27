// Voice-follow matching: pure functions, shared by app.js and test-matcher.mjs.

// Normalise text into comparable word tokens.
export function normWords(text) {
  return text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .split(/\s+/)
    .map(w => w.replace(/^'+|'+$/g, ''))
    .filter(Boolean);
}

// Longest common subsequence of two short word arrays.
// Returns { count, matched } where matched lists the common words in order.
function lcs(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  const matched = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) { matched.unshift(a[i - 1]); i--; j--; }
    else if (dp[i - 1][j] >= dp[i][j - 1]) i--;
    else j--;
  }
  return { count: dp[m][n], matched };
}

// Given the script tokens, the current position (tokens already spoken) and the
// most recently heard words, return the new position. Never moves backwards.
// Tolerates mis-recognised words (scores overlap, not exact sequence) and
// refuses to advance on filler/stopword-only matches.
export function advance(scriptTokens, pos, heard, opts = {}) {
  const lookahead = opts.lookahead ?? 40;
  const tailLen = opts.tail ?? 8;
  const tail = heard.slice(-tailLen);
  if (tail.length < 2) return pos;

  const maxEnd = Math.min(scriptTokens.length, pos + lookahead);
  let bestPos = pos, bestScore = 0;

  // Candidate c = number of script tokens spoken if the tail ends at token c-1.
  for (let c = pos + 1; c <= maxEnd; c++) {
    const winStart = Math.max(0, c - tail.length - 2); // slack of 2 absorbs skipped words
    const { count, matched } = lcs(tail, scriptTokens.slice(winStart, c));
    // Require the last heard word to be near the window end, else the same
    // score repeats for every larger c and we'd overshoot.
    const endsHere = scriptTokens[c - 1] === tail[tail.length - 1] ||
                     scriptTokens[c - 1] === tail[tail.length - 2];
    if (!endsHere) continue;
    const strong = matched.some(w => w.length >= 5);
    const ok = count >= 3 || (count >= 2 && strong);
    if (ok && count > bestScore) { bestScore = count; bestPos = c; }
  }
  return bestPos;
}
