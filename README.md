# Study Subs — dual subtitles for YouTube

A Chrome extension that turns a YouTube video with subtitles into a language
lesson. It opens a full-screen study overlay with two subtitle rows: the original
track on a fixed reading line, its translation right below. Both appear word by
word, in time with the speaker.

Translation goes through YouTube's own auto-translate, into any of uk, en, pl,
de, es, fr, it, ru.

**→ [Install from the Chrome Web Store](https://chromewebstore.google.com/detail/study-subs-%E2%80%94-dual-subtitl/lodajmmoenlnkiplbeigflgnngojkada)** — free, no account, no sign-up.

> Not affiliated with, endorsed by, or sponsored by YouTube or Google LLC.
> Privacy policy: [`PRIVACY.md`](PRIVACY.md) — nothing is collected, nothing
> leaves your computer.

## Shadowing

Shadowing means repeating a sentence out loud right after the speaker until it
sounds natural. Turn on **Study** and the video stops by itself at the end of
every sentence. Then **Repeat** replays that same sentence, **Next** / **Previous**
move one sentence at a time, and **Play** replays the sentence instead of running
on once it has played out.

Sentences are found by punctuation (`.`, `!`, `?`, `…`), not by how YouTube split
the captions into lines, so one sentence stays one sentence.

## What else it does

- **Word-by-word reveal**; the previous line stays above, dimmed.
- **Playback speed** 0.5×–2×, and a **scrubber whose notches are sentence
  boundaries** — clicking snaps to the start of a sentence, never into the middle.
- **Remembers where you stopped** and offers to continue from that sentence.
- **Translation language, text size (XS…XL) and color scheme** — 24 of them: Sepia, Dark,
  Light, High Contrast, Paper, and nineteen borrowed from code editors (Darcula, Monokai,
  Dracula, One Dark and One Light, Nord, Gruvbox and Gruvbox Light, Solarized Dark and Light,
  Catppuccin Latte, Tokyo Night, Rosé Pine and Rosé Pine Dawn, Everforest and Everforest Light,
  Cobalt2, SynthWave 84, Zenburn)
  switch mid-video. The translation row hides with one click.
- **Subtitles are cached on your device**, so re-watching needs no network request.
- **Keyboard**: `Space` play/pause/replay, `←`/`→` previous / next sentence,
  `R` repeat, `Esc` exit. With Study off, `Space` and `R` go to the player and
  `←`/`→` seek ±5 s.

## Install

The published build lives in the
[Chrome Web Store](https://chromewebstore.google.com/detail/study-subs-%E2%80%94-dual-subtitl/lodajmmoenlnkiplbeigflgnngojkada);
that is the version to use unless you intend to change the code. It asks for
`storage`, `unlimitedStorage` (room for the subtitle cache) and access to
`www.youtube.com`, and nothing else.

Open any video on `youtube.com` afterwards — a **📖 Dual subtitles** pill appears
in the row of actions under the video, and a matching button in the player's
control bar next to CC. Either one opens the overlay.

### From source

The extension needs no build step — Chrome loads the folder as it is.

1. Download or clone this repository.
2. Open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and pick the folder that contains `manifest.json`.

After changing the code: press **↻** on the extension's card in
`chrome://extensions`, then hard-refresh the YouTube tab with **Ctrl+Shift+R**.
Chrome keeps running the old code otherwise.

## Packaging

```sh
./build.sh          # -> dist/study-subs-<version>.zip
```

Zips exactly the files `manifest.json` references, so nothing unwanted ships and
nothing referenced can be forgotten. Icons are cut from the source artwork with
`python3 tools/make-icons.py`.

## How it works

- `manifest.json` — Manifest V3, two content scripts on `www.youtube.com`,
  permissions `storage`, `unlimitedStorage` and that one host.
- `injected.js` — page world (`world: MAIN`): watches the player's own requests
  for the subtitle track and reads `getPlayerResponse()`.
- `content.js` — isolated world: adds the two entry points, builds the overlay,
  loads and caches captions, keeps the word-by-word reveal in step with
  `<video>.currentTime`.
- `content.css` — the overlay's styles; all sizes derive from one
  container-relative unit, so the layout scales with the viewport.

A diagnostics log lives in the overlay's ⚙ settings → **Advanced**, with a
**Copy log** button — that is the first place to look if captions don't load.

## Limitations

- Translation is YouTube's own auto-translate. It is readable, not literary.
- The video must have YouTube subtitles. If the text is burned into the picture,
  there is nothing to read.
- Subtitle delivery on YouTube is undocumented and can change without notice; if
  captions stop loading, that is the likely reason.
- If captions are switched off in the player and it doesn't pick them up
  automatically, turn **CC** on by hand once.
