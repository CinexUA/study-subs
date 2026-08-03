# Changelog

What changed between released versions, in the words of someone using the
extension rather than writing it. Why a change was made and how it works lives
in the commit that made it.

`Unreleased` is what is finished on disk but not yet in the Chrome Web Store.
A bug introduced and fixed before a release is not listed: nobody ever had it.

## Unreleased

### Fixed

- Study mode no longer opens on `[applause]`. Sound cues — `[Music]`,
  `[Applause]`, `(laughs)`, the `♪` between verses — are not speech, and they
  were being counted as sentences: on one TED talk, sentence 1 of 129 was the
  applause before the speaker said a word. They also pulled the translation out
  of line, so a real phrase could appear glued to the end of them. They are now
  left out of both languages, and the first sentence is the first thing anyone
  actually says. Song lines keep their words — only the notes around them go.

- Ads are no longer treated as part of the video you are studying. The reader
  steps aside for the whole ad — the ad stays visible and its **Skip** button
  stays clickable — and comes back on its own when the ad is over, replaying
  the sentence the ad interrupted from its beginning. Along the way the ad
  stops being paused by the sentence stop, stops being played at your study
  speed, and its own subtitles can no longer end up saved as the video's.
  Nothing here changes for YouTube Premium, which is why it went unnoticed
  for so long.

### Changed

- **Dual subtitles** no longer opens onto videos it has nothing to show. On a
  video without subtitles the pill under the video goes quiet and says why on
  hover, and the button in the player steps aside the way YouTube's own CC
  button does. Live streams are treated the same until they end: their
  subtitles have no finished timing to read against. The check costs nothing —
  it asks the page which subtitle tracks exist, and never switches captions on
  to find out.

### Fixed

- The extension no longer switches YouTube's own captions on behind your back.
  It used to do that on every video you opened, whether or not you ever opened
  the reader — and since YouTube remembers that setting, one video was enough
  to leave CC turned on across your whole feed, for good. The player is now
  only ever touched while the reader is open, and its captions are put back the
  way they were when the subtitles have been loaded. Watching normally is
  untouched again. If yours are still stuck on from an earlier version, switch
  CC off once in the player and they will stay off.

## 1.1.1 — 2026-08-02

### Added

- The version you are running, in **Settings → Advanced**, named — *Study Subs
  1.1.1*, not a bare number beside a heading. It is also the first line of what
  **Copy log** puts on your clipboard, so a bug report says which build
  produced it.

### Changed

- On videos whose subtitles carry a time for each whole line rather than each
  word — most hand-made tracks — a sentence now appears complete instead of
  arriving in two pieces mid-thought. Those tracks never had the per-word times
  such a reveal needs. Where they do exist, in YouTube's automatic captions,
  the word-by-word reveal is unchanged.

### Fixed

- **Dual subtitles** could appear twice under the video — once in the row of
  buttons and once stretched across the row below it. Most likely on the first
  video you opened after installing the extension.
- The settings button tipped its icon over on hover. The turn was written for
  a cog; the glyph is a pair of sliders, and sliders do not turn.
- On videos whose subtitles arrive as whole lines rather than single words —
  most hand-made tracks, TED talks among them — study mode stopped in the
  middle of a thought, at the line break instead of the end of the sentence,
  and clipped the last word before it (*blank* heard as *bla…*). Raising
  **Sentence tail** did nothing about it, because nothing was wrong with the
  tail. Sentences now run to their own end.
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
