# YT Dual Subs — English + Ukrainian

A Google Chrome extension that pulls YouTube subtitles out **below the video**:
top row — original (EN), bottom row — translation (UA). The picture is never
covered, and YouTube's native captions can be hidden. The goal is learning
English: you see the original and instantly the translation of unfamiliar
words, without losing the main text off-screen.

## Installing in developer mode (dev / unpacked)

The extension doesn't need building — it's plain files, Chrome loads the
folder directly.

1. Open `chrome://extensions` in Chrome.
2. Turn on the **Developer mode** toggle — top right corner.
3. Click **Load unpacked**.
4. In the dialog, pick the **extension folder**:
   `~/Projects/browser-extensions/google-chrome/yt-dual-subs`
   (the folder that contains `manifest.json`).
5. A "YT Dual Subs" card appears on the panel. Open any video at
   `https://www.youtube.com/watch?...` — a subtitle panel appears under the player.

### After changing the code

1. `chrome://extensions` → click the circular **↻ (reload)** arrow on the extension's card.
2. Hard-refresh the YouTube tab: **Ctrl+Shift+R**.

Without these two steps Chrome keeps running the old version of the code.

## How to use it

The extension **doesn't change YouTube's interface**. It adds a single 📖 button
to the player controls (next to CC / settings). You watch videos as usual, and
when you want to study — click that button → a **full-screen study mode** opens.

## Features

- **Full-screen study mode**: two subtitle rows — **EN** (original) above the
  fixed screen midline, translation below it. The English line is "anchored"
  to that line and **never jumps** regardless of sentence length.
- **Word-by-word reveal** of subtitles, like on YouTube (by each word's
  timecode), without breaking mid-sentence.
- **Custom playback controls**: ⏪ pause/play ⏩, **speed** (0.5×–2×), time,
  a clickable progress bar — control the video directly.
- **Shadowing mode ("Study" button)**: the video plays **one sentence** — from
  its start to the period — and stops. **← Previous · ↻ Repeat · Next →**
  buttons let you repeat a sentence in a loop until you've got it, then move
  on. Exiting study mode → the video plays normally again.
- **EN / UA toggles**, **translation language picker** (uk, en, pl, de, es, fr, it, ru).
- **Themes**: Sepia, Dark, Light. **Font size** (A− / A+).
- Exit — **✕** button or **Esc**.
- **"Log"** button — a built-in diagnostics log (see below).

### Shadowing

Technique: you repeat one sentence out loud right after the speaker, until it
sounds natural, then move to the next. Turn on **"Study"** — the video stops at
the end of the current sentence; hit **↻ Repeat** as many times as needed, then
**Next →**. Sentences are detected by punctuation (`.`, `!`, `?`, `…`)
regardless of how the captions are split into lines.

## How it's built

- `manifest.json` — Manifest V3, two content scripts on `www.youtube.com`.
- `injected.js` — page world (`world: MAIN`): intercepts the player's own
  requests to `/api/timedtext` (they carry a valid `pot` token), reads
  `getPlayerResponse()`, and enables captions when needed (clicks the CC button).
- `content.js` — isolated world: adds the button to the player, builds the
  full-screen study overlay, fetches captions, caches the valid URL, syncs
  the word-by-word reveal with `<video>.currentTime`.
- `content.css` — styles for the overlay, button, and controls.

### Where the subtitles come from

YouTube no longer serves subtitles from a "bare" URL taken from
`getPlayerResponse` (a `pot` token is required). So the extension **intercepts
the player's own request** to `/api/timedtext`, extracts a valid URL from it,
and reuses it: for the original (EN) and for the translation
(`&tlang=<language code>`). The URL is cached, so switching language doesn't
require a new interception.

## Diagnostics (the "Log" button)

Click **"Log"** in the panel — a black log window opens with events. Key lines:

- `tracks from playerResponse: N [...]` — how many subtitle tracks the player
  sees (`0` = the video has no YouTube captions).
- `intercepted timedtext (…, body=… bytes)` — the player made a captions
  request and whether the body was non-empty.
- `EN via valid URL: N` / `ready: EN N · UK M` — how many lines loaded.
- `using cached valid URL` — the cache kicked in (e.g. on language switch).

## Limitations

- Translation is **YouTube's auto-translate** (`&tlang=`). Quality is
  "readable" at best. Plan: replace with DeepL/LLM with a Postgres cache.
- If the video **has no YouTube captions** (text "burned" into the picture,
  as on some graded-reader channels) — there's nothing to read; would need
  speech recognition (Whisper).
- If captions are off in the player and the CC button doesn't trigger
  automatically — turn on **CC** manually once, and interception will pick it up.

## Roadmap

- [ ] Click a word → translate that single word (dictionary).
- [ ] DeepL instead of `tlang` + translation cache.
- [ ] Hotkeys (repeat / next sentence / pause).
- [x] Font size adjustment.
- [x] Playback speed adjustment.
- [x] Shadowing mode (sentence by sentence).
- [ ] Whisper for videos without captions.
