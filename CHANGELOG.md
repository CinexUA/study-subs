# Changelog

What changed between released versions, in the words of someone using the
extension rather than writing it. Why a change was made and how it works lives
in the commit that made it.

`Unreleased` is what is finished on disk but not yet in the Chrome Web Store.
A bug introduced and fixed before a release is not listed: nobody ever had it.

## Unreleased

### Fixed

- Subtitles sometimes never loaded on the first video opened in a tab: the
  overlay sat on *enabling player captions…* for half a minute and then gave
  up, and switching YouTube's own **CC** off and on by hand was the only way
  through. The extension now does that off→on itself.

## 1.1.0 — 2026-08-01

### Added

- **Sentence tail** — how long study mode keeps playing after the last word of
  a sentence, in **Settings → Playback**. Raise it when endings sound cut off,
  lower it when the pause before the stop drags. Default 300 ms.
- **Reset playback settings** — returns the settings in that group to their
  defaults, and leaves the language, theme, text size and speed alone.

### Fixed

- The playback speed you set in YouTube's own menu was reset to 1× on its own,
  even if you had never opened the overlay. Outside study mode the speed on
  YouTube is now left alone.
- Clicking **Dual subtitles** could do nothing at all — no overlay, no error —
  on a tab that had been open since before Chrome last updated or reloaded the
  extension. Most often the first tab restored after starting the browser. The
  overlay now opens anyway, and says once that the page needs a reload before
  settings can be saved again.

## 1.0.0 — 2026-07-30

First public release in the Chrome Web Store.

- Full-screen study overlay: the original subtitle track on a fixed reading
  line, its translation below, both revealed word by word.
- Shadowing: the video stops by itself at the end of every sentence, with
  Previous / Repeat / Next, and a play button that replays the sentence it just
  stopped on instead of running past it.
- Translation into any of uk, en, pl, de, es, fr, it, ru, through YouTube's own
  auto-translate.
- Playback speed 0.5×–2×, and a scrubber whose notches are sentence boundaries.
- Remembers the sentence you stopped on and offers to continue from it.
- Subtitles are cached on your device, so re-watching needs no network request.
- Sepia / Dark / Light themes, five text sizes, keyboard shortcuts.
