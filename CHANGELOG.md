# Changelog

What changed between released versions, in the words of someone using the
extension rather than writing it. Why a change was made and how it works lives
in the commit that made it.

A heading here means a version was PACKAGED under that number. It does not mean
anyone received it: uploading is a separate act, and whether it happened is
written in the store listing, never in this file. `Unreleased` is work that is
finished on disk and carried by no package yet.

A bug introduced and fixed before a release is not listed: nobody ever had it.
One that shipped is listed even if it was fixed the same week — the test is
whether a stranger's browser ever ran it, and this file is the wrong place to
guess at that.

## Unreleased

### Added

- **Where to start: channels where the reader works as meant.** The first
  video a newcomer opens is often the wrong one for this: no subtitles, or
  subtitles without full stops, and then the extension looks broken when the
  video is the problem. The extension now points at channels whose subtitles
  have full stops and timing for every word (English Avenue, for now) in
  four places: clicking the extension's icon in the toolbar, which used to do
  nothing; a compass button in the reader's top bar; a card under the
  message when a video has nothing to read; and, once per video, a hint when
  the subtitles have no full stops and the sentences will run long. On a
  video with no subtitles at all, where the Dual subtitles button is greyed
  out, its tooltip now says to click the Study Subs icon for videos that
  work well.
- **Twenty-one more color schemes, 24 in all.** Nineteen are borrowed from
  code editors: Darcula, Monokai, Dracula, One Dark, One Light, Nord, Gruvbox,
  Gruvbox Light, Solarized Dark, Solarized Light, Catppuccin Latte, Tokyo
  Night, Rosé Pine, Rosé Pine Dawn, Everforest, Everforest Light, Cobalt2,
  SynthWave 84 and Zenburn. Each keeps its editor's background and signature
  colour, nudged where needed so both lines stay easy to read. Two are for
  reading itself: High Contrast (white and yellow on black) and Paper (black
  and grey, like an e-reader). The toolbar popup follows the scheme too.

- **A text menu, and a way to cover subtitles burned into the video.** A new
  **Aa** button in the reader's top bar, beside the color schemes, opens one
  menu for how the text looks. Size lives there now, and it is kept
  separately for the reader and for Video mode, so a large size picked to
  cover something on the picture no longer makes the reader large. There are
  five fonts: the one the reader always used, which stays the default, plus
  Literata, Inter, Andika and JetBrains Mono. These four ship inside the
  extension, so they look the same on every system and nothing is fetched
  from the web. Without video, a slider narrows the lines. Over video there
  are four settings: the background can stay a box behind each line or turn
  into one band across the picture; its opacity goes from 0 to 100%; a height
  slider moves the text anywhere from the bottom of the frame to near the
  top; and an outline around the letters keeps the text readable with no
  background at all. The band stays in place between sentences and does not
  grow word by word, so subtitles burned into the video stay hidden under it
  the whole time. **Reset text settings** puts back what the menu shows for
  the mode you are in. Until you change something, nothing looks different.

### Changed

- **Color schemes sit behind one button.** The three circles in the reader's
  top bar are now a single button that shows the current scheme; clicking it
  opens the schemes as a grid of circles, and picking one closes it. The top
  bar no longer grows with every scheme added.

- **Text size, Word by word and Previous line moved into the text menu.**
  The A · size · A tray is gone from the top bar, and the Text group is gone
  from the settings drawer; all three are in the Aa menu, with the same steps
  and the same defaults. Previous line is greyed out while Study is on, where
  it never did anything: Study always shows one sentence.

### Fixed

- **The translation stays under its own sentence on videos whose subtitles
  have no punctuation.** Some automatic subtitles come as plain lowercase
  words with no full stops at all. There the reader can only cut sentences at
  pauses, so they come out long and few, while YouTube's translation has full
  stops of its own and comes out in many short ones. The reader matched the
  two by length and lost track: the first few minutes of translation sat under
  the chapter title, the next long sentence had none, and the rest drifted.
  On a 93-minute audiobook only about a third of the translation stood under
  the sentence it belonged to. On such videos each word of the translation
  now goes under the sentence it is spoken in. Videos whose subtitles have
  punctuation are not affected.

- **The Transcript button works again after you change the translation
  language.** If the transcript was closed when you picked another language,
  the button went dead: it looked the same but did nothing until something
  else in the reader was clicked. The same could happen if you opened the
  reader before the subtitles had finished loading.

## 1.4.1 — 2026-09-21

### Fixed

- **A translation YouTube refused now comes back by itself.** When YouTube
  rate-limits subtitle requests, the reader used to pause for a minute, say the
  translation "will come back in a few minutes", and never go and get it: the
  only way back was Reload captions, and each press asked twice. It now asks
  once, waits longer after each refusal — a minute, then two, up to half an
  hour, or as long as YouTube itself names — and goes back for the translation
  when the wait is over, with the original staying on screen meanwhile. The
  hint says when the next attempt is. Found on a morning where the refusals
  lasted thirty-five minutes and three reloads by hand changed nothing.

- **A refusal the player itself receives no longer counts as subtitles.** The
  player's own request for a translation can be refused too, and its answer —
  a short error page — was kept as if it were a track, so switching to that
  language parsed it to nothing and then asked the network for the refusal
  again. The status is now read with the body; a refused answer is dropped,
  and the wait starts from there.

- **The videos you come back to stay in the cache.** Tracks were evicted by
  the date they were first saved, so a video re-watched every week left the
  cache as readily as one opened once, and the next open went to the network —
  the very request that gets refused. A re-watch now keeps its tracks at the
  front of the line.

### Changed

- **The subtitle cache holds 200 tracks instead of 20.** That is a hundred
  videos with their translation rather than ten. It needs the `unlimitedStorage`
  permission, which grants room only, not access, and Chrome asks nothing for
  it.

## 1.4.0 — 2026-09-12

### Added

- **Sound can be turned off without leaving the reader.** A speaker button sits
  in the transport row, and `M` does the same from the keyboard. It is there for
  reading a video aloud yourself — the narrator silent, the text arriving at the
  pace you set — with one key to bring the voice back when you want to hear how
  a word is actually said. It is the player's own mute, so the button shows the
  truth even when the video was silenced before the reader opened, the state is
  still there after you leave, and YouTube goes on remembering it from one video
  to the next.

- **`Shift+R` plays the sentence again and lets you hear it.** With the sound
  off, this is the one key that hands the voice back: the sentence starts over
  audibly, and the silence returns by itself when it reaches the full stop. A
  pause in the middle does not cut the sound short — it is the sentence you
  asked for, not a stretch of playback — while moving to another sentence,
  reaching for the mute yourself or an ad starting all end it there and then.
  Study mode only, and with the sound already on it is simply `R`.

## 1.3.1 — 2026-09-03

### Fixed

- **A video whose translation loaded and then never appeared.** The reader
  showed the original with an empty space under it, and the log said every
  sentence had no translation — while the translated track was in hand, fully
  downloaded, and correct. One caption in the middle of the video carried a time
  that put it after the caption following it, and from there the step that fits a
  translation to its original gave up on the whole video rather than on that one
  place. Found on a 36-minute video where all 681 sentences came out
  untranslated; all 681 now carry theirs.

- **Pointing at a line that holds two sentences no longer lights both.** A line
  in free reading may carry two short sentences, and pointing anywhere in it
  answered with the whole line and the whole translation under it. The end of a
  sentence now bounds a phrase the same way a comma does, so each sentence is
  its own answer, with its own part of the translation.

## 1.3.0 — 2026-08-09

### Added

- **Video** — a new mode in the top bar that keeps the picture and puts the text
  over it, instead of the reading page covering the player. The video is handed
  a narrower box and re-fits itself to it, so nothing is cropped, and the
  player's own controls step aside so there are not two of them on one screen —
  except during an ad, where Skip Ad lives. Leaving the mode gives the player
  back exactly as it was.
- **Transcript** — a column beside the reader listing every sentence of the
  video, with its translation under it. The unit is the sentence playback stops
  at, not a caption line, so it agrees with what the reader is doing; YouTube's
  own transcript already lists lines. The current sentence keeps itself in view
  and clicking any of them plays from its start. Scrolling by hand hands the
  list over, and **Follow** takes it back. On a video long enough that the list
  takes a moment to build, the button says so while it works.
- **Two smaller text sizes.** The old smallest was sized for a page of text; over
  a picture the same size covers the film it is supposed to caption.
- **The reader says where YouTube's translation ends.** On long videos the
  translation can simply stop while the source runs on. Past that point the
  bottom line used to be empty, which reads as a broken extension rather than as
  an answer; it now gives the time the translation reaches.
- **The text types itself out as it is spoken** on tracks that carry a time for
  each caption line rather than each word — which is every hand-made track. It
  used to arrive a whole line at a time. Both modes do it now: the sentence in
  study mode, the line in free reading.
  The pace comes from each caption's own time, so it follows the speaker, and a
  pause in the talk is a pause on screen. Inside a single caption, where the
  track knows nothing finer, the words are spread by length — about seven words
  wide, not a whole sentence.
  The text is drawn in full from the first frame and the unspoken words are
  simply invisible, so nothing on screen ever moves: a word appears, it does not
  push. Tracks timed word by word have real times for every word and are
  unchanged.
- **⚙ → Text → Word by word** turns that off. It is on to begin with; switch it
  off and every line is there in full the moment it starts, the way it was
  before — reading ahead of the speaker is a perfectly good way to use
  subtitles, and on a track timed word by word this is also how to stop waiting
  for the end of a sentence you can already read. The choice is remembered.
- **Pause in free reading and you can point at a phrase** to see which part of
  the translation belongs to it. It is the same pointing study mode has, on the
  line you stopped at. Nothing is marked until the cursor is on it. With the
  translation switched off, the phrase you point at is the only thing that
  appears, and it appears where it stands in the line.

### Changed

- **Free reading shows one line at a time.** The line that had just gone by used
  to stay above the current one, half-lit; it is gone unless you ask for it back
  at **⚙ → Text → Previous line**, where it works exactly as it did. Two lines of
  each language on screen is a lot to carry when only one of them is being
  spoken, so it is the reader's call now rather than the only way free reading
  looks. Study mode never showed it and is unchanged. The choice is remembered.
- **Sentence tail is a slider now**, 0 to 2000 ms in steps of 100, with the
  value beside it and the track filling as it moves. It was a typed box, and a
  typed box gives no sign of having been read: you enter a number, the ending
  sounds the same, and nothing tells a value that did nothing apart from a field
  that was never applied.
- Under the slider, **what the value does to the video you are watching** — how
  much it adds to the average ending, and how many sentences are already as late
  as the setting can make them. Those counts existed only in the Advanced log,
  which is two panels away from the hand on the control. The setting spends
  silence and never a word, so on a talk where the speaker runs from one
  sentence into the next there is nothing for it to spend — and now it says so
  where you are looking, instead of appearing broken.

### Fixed

- **Pointing at a phrase no longer answers with half of one.** Where several
  English phrases share a single translated one, each was given a slice of it
  cut by character count, so "I mentor," was answered with "працюю" — the first
  half of "працюю наставником". Phrases that share an answer are now marked
  together and given the whole of it. Coarser, and right.
  Boundaries can still land a fragment off where the two languages put their
  commas in different places; that is the limit of matching by length, not a
  new fault.

- **Pointing at a short sentence does something.** On a sentence with no comma
  in it there is only one phrase to point at, and the mark was suppressed on the
  grounds that it would say nothing the cursor had not already said. That is
  true and beside the point: nothing on screen changed, and nothing changing
  reads as broken. Such a sentence now marks like any phrase.

- **On a long video the translation no longer sits under the wrong sentence.**
  On a four-hour lesson every translated line was a different sentence from the
  one above it — connected Ukrainian text running across English about something
  else entirely. The two tracks are the same audio on one clock, and that is
  what pairs them now; before, they were paired by counting sentences from the
  start, which drifts further the longer the video runs and cannot recover.
  Videos short enough that this never went wrong are paired exactly as before.

- **Choosing a language that had not been loaded before no longer empties the
  bottom line.** With one translation already on disk, switching to another
  could leave nothing under the source text while the log called the load a
  success: only the source was checked, and the source came from disk. Both
  halves are checked now, and a translation that came back empty is retried
  rather than remembered.

- **A slow speaker no longer loses the end of every sentence.** Study mode
  stopped at the point where the words were *estimated* to end — a fixed rate of
  letters per second — even on tracks that record where the line actually
  finishes. Anyone speaking slower than that estimate was cut off by the
  difference: on one talk 86 sentences ended inside their own last word, one of
  them by 1.3 seconds. The recorded end is now believed where it exists.

- **The line about who typed the subtitles is no longer read as part of the
  video.** A TED track opens with "Transcriber: … Reviewer: …" timed at zero,
  which put those names on screen over the opening titles, made them the first
  sentence of the video, and gave them the first block of the transcript. They
  are gone from all three. Recognised by shape rather than by the words, so the
  same line in a translated track goes with it.

- **Sentence tail now reaches the endings it was added for.** On tracks timed
  one caption line at a time — every hand-written track — a line can hand over
  to the next one in the middle of the last word, and the setting was not
  allowed past that handover. Measured on one TED talk: the word *real* sounds
  until 294.16, the pause between the sentences runs 294.18–294.34, and the
  caption ends at 293.956 — so playback stopped mid-vowel, heard as "real e…",
  and every value from 0 to 2000 stopped in the same place. The tail may now
  spend past a caption boundary on such tracks, which is the only place the
  ending it was reaching for lives. Turn it up until endings sound whole and
  down when the next sentence starts bleeding in; both directions now do
  something. Tracks timed word by word are untouched.

- **Sentences no longer stop inside their own last word.** On tracks whose
  captions are one line at a time — every hand-written track — the end of a
  sentence was clipped by about 200 ms, and no value of Sentence tail reached
  it: "…about turning ideas into something real." was heard as "…something
  rea…" at 0, at 300 and at 2000 alike. A sentence on such a track now plays to
  the end of the caption it belongs to. On the talk this was reported from, the
  worst clip drops from 2.2 s to 30 ms, and 27 more sentences per talk reach
  their own ending. Tracks with word-by-word timings are untouched: there the
  next word really does start where the caption says, and the silence before it
  is still kept.

- **Sentence tail** now honours `0`. The field accepts it and shows it back,
  and every other value between it and the default did something — but `0`
  alone was read as the default, so the shortest ending the setting offers was
  the one value you could not get. Turned down to nothing, a sentence now stops
  where its last word does.

- The log in **⚙ → Advanced** now says what changing the Sentence tail did:
  how many sentence stops moved, and how many could not move because the next
  sentence follows too closely to give up the silence in between. The setting
  can only ever spend silence that is there, so on those the ending sounds the
  same at 800 ms as at 2000 — and until now there was nothing to tell that
  apart from a field doing nothing at all.

## 1.2.0 — 2026-08-03

### Added

- **Point at a phrase to see the phrase that translates it.** Once study mode
  has stopped on a sentence, moving the cursor over a phrase of the original
  lights its counterpart in the translation and steps the rest of the
  translation back. With the translation line switched off it is the only
  thing that appears — standing in the place it holds in the line, which is
  what says whether it is the start of the sentence or the end. The unit is a
  phrase between commas and never a single word: pairing single words across
  two languages needs a dictionary, and nothing here claims to know more than
  the subtitles do. A sentence with nothing finer inside it — no commas of its
  own, or a translation that carries none — answers with the whole line rather
  than not answering at all.

### Changed

- **Dual subtitles** no longer opens onto videos it has nothing to show. On a
  video without subtitles the pill under the video goes quiet and says why on
  hover, and the button in the player steps aside the way YouTube's own CC
  button does. Live streams are treated the same until they end: their
  subtitles have no finished timing to read against. The check costs nothing —
  it asks the page which subtitle tracks exist, and never switches captions on
  to find out.

### Fixed

- Study mode no longer opens on `[applause]`. Sound cues — `[Music]`,
  `[Applause]`, `(laughs)`, the `♪` between verses — are not speech, and they
  were being counted as sentences: on one TED talk, sentence 1 of 129 was the
  applause before the speaker said a word. They also pulled the translation out
  of line, so a real phrase could appear glued to the end of them. They are now
  left out of both languages, and the first sentence is the first thing anyone
  actually says. Song lines keep their words — only the notes around them go.
  The `>>` that transcripts put in front of a new speaker goes the same way:
  it is a note about the transcript rather than a word anyone said, and on the
  tracks that use it, it was the first thing on screen. Only where it opens a
  line — `»` is a closing quote in half the languages this has to survive.

- Ads are no longer treated as part of the video you are studying. The reader
  steps aside for the whole ad — the ad stays visible and its **Skip** button
  stays clickable — and comes back on its own when the ad is over, replaying
  the sentence the ad interrupted from its beginning. Along the way the ad
  stops being paused by the sentence stop, stops being played at your study
  speed, and its own subtitles can no longer end up saved as the video's.
  Nothing here changes for YouTube Premium, which is why it went unnoticed
  for so long.

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
