# AutoCue

A personal teleprompter that runs as an installable web app (PWA) on a phone,
tablet or PC — built for delivering speeches and ceremonial ritual from a
device in hand.

- **Voice-follow** — the text scrolls as it hears you speak, gently
  brightening the passage you are about to deliver (Chrome, online).
- **Autoscroll** — steady adjustable pace, tap to pause, drag to scrub,
  one-touch "back four lines".
- **Manual** — nothing moves unless you move it.
- Pieces organised into ceremonies with an ordered running order,
  next/previous piece controls and search.
- Stage directions in `[square brackets]` render dim and italic and are
  ignored by voice-follow.
- Adjustable text size (buttons or pinch), screen wake-lock, dark theme.
- Works fully offline once visited; **all content stays in the browser's
  local storage on your device** — nothing is uploaded anywhere. Transfer
  between devices with Export / Import (a single JSON file).

No build step, no dependencies: plain HTML/CSS/JS. Run the matcher
self-check with `node test-matcher.mjs`. Serve the folder with any static
server, or use the hosted copy via GitHub Pages.
