# Privacy Policy — Study Subs

**Last updated:** 12 November 2026

> The canonical version of this policy lives at
> <https://cinexua.github.io/study-subs/privacy.html> — that is the URL given to the
> Chrome Web Store. This file is the same text; if the two ever disagree, the page
> is the one that counts, and this file needs updating.

## Short version

Study Subs collects nothing. No data is transmitted anywhere, to us or to anyone
else. There are no accounts, no analytics, no trackers, and no third-party
services. Everything the extension remembers stays in your browser, on your
computer.

## What the extension stores on your device

All of it lives in `chrome.storage.local`, the browser's own local storage for
extensions. It never leaves your machine, and uninstalling the extension deletes
all of it.

| What | Why it is kept |
|---|---|
| Your settings: translation language, theme, font size, playback speed, whether the translation line is shown, end-of-sentence pause | So the overlay opens the way you left it |
| A cache of subtitle text and its word timings for the videos you have opened, keyed by YouTube video ID — the 300 most recently used records, about 200 KB each | So re-watching a video needs no network request at all, and so the extension keeps working if YouTube rate-limits you |
| The phrases of those subtitles as translated on your device (see “Translation on your device” below), in the same cache and under the same video IDs | So a video you come back to is not translated a second time |
| Your study bookmark: the timestamp of the sentence you stopped at, per video ID — the 200 most recent videos, about 50 bytes each | So the extension can offer to continue where you left off |
| When YouTube last asked us to slow down, and how many times in a row | So the extension backs off politely, and waits longer each time, instead of retrying into a wall |

Be aware of what the cache and bookmark rows mean in practice: the list of video
IDs you have watched with the extension open is stored **locally**. It is never
sent anywhere, but it is on your disk. You can wipe it at any time — see below.

## How to delete the stored data

- **All of it:** remove the extension. Chrome deletes its local storage with it.
- **The subtitle cache for the current video:** open the overlay's ⚙ settings →
  **Advanced** → **Reload captions**.
- **The subtitle cache for every video:** the same place → **Clear all**. The
  line next to it says how much the cache holds.

## Network requests

The extension makes requests to exactly one place: **`youtube.com`**, the site
you already have open. It asks YouTube for the subtitle track of the video you
are watching, and for YouTube's own machine translation of that track. Nothing
is sent to any other host. There is no server of ours involved — the extension
has no backend.

## Translation on your device

Where the browser has a translator of its own (Chrome 138 and later), Study Subs
can translate each phrase of the subtitles with it, so that every phrase of the
translation stands exactly under the phrase it translates. That translation is
made **on your computer**: the subtitle text is not sent to us, to Google or to
anyone else. The language pack it needs is downloaded by Chrome itself, from
Google, the first time — after you press **Download** on the card that offers
it — and the extension does not make that request and sees nothing of it.
You can go back to YouTube's translation at any time in ⚙ → **Advanced** →
**Translation**.

## Permissions and why each one is needed

- **`storage`** — to keep the settings, the subtitle cache and the study
  bookmark listed above on your device. Nothing else uses it.
- **`unlimitedStorage`** — so the subtitle cache can hold 300 records; without
  it Chrome caps an extension's local storage at 10 MB. It grants no access to
  anything, only room.
- **Host access to `https://www.youtube.com/*`** — to read the subtitles of the
  video on the page you are already viewing, and to draw the overlay on that
  page. The extension has no access to any other website.

## What the extension never does

- It does not collect, transmit, sell or share any personal or usage data.
- It does not use analytics, telemetry, crash reporting or advertising.
- It does not read pages other than `youtube.com`.
- It does not load or execute any remote code; all of its code ships inside the
  extension package.
- It has no login, no account and no user identifier of any kind.

## Not affiliated with YouTube

Study Subs is an independent extension. It is not affiliated with, endorsed by,
or sponsored by YouTube or Google LLC. "YouTube" is a trademark of Google LLC.

## Contact

Questions about this policy, or about anything the extension does with your
data: open an issue at
**https://github.com/CinexUA/study-subs/issues**
