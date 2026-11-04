// Channels where the reader works the way it is meant to: subtitles with full
// stops and timing for every word. Shown to a newcomer who has just installed
// the extension and does not know what to open first. The first video picked
// at random often has no captions, or captions with no punctuation at all, and
// then the extension looks broken when the video is the problem.
//
// Two pages read this list: the reader (content.js, same isolated world) and
// the toolbar popup. Hence globalThis rather than a module.
//
// The list ships inside the extension on purpose. Fetching it from a page we
// host would need a new host permission, and Chrome disables an installed
// extension until its user accepts a new permission. A new channel is a new
// version.
//
// Each claim in `why` was measured, not guessed: four recent English Avenue
// videos (35–90 min, 2026-11-04) carry word-timed ASR with punctuation, a
// median of 9 words per sentence and 38 at most.
globalThis.YTDS_CHANNELS = Object.freeze([
  Object.freeze({
    name: 'English Avenue',
    handle: '@EnglishAvenuee',
    url: 'https://www.youtube.com/@EnglishAvenuee',
    initials: 'EA',
    about: 'Graded stories and podcasts, levels 2–3.',
    why: 'Its subtitles have full stops and timing for every word, so Study stops at the end of each sentence and the words light up as they are spoken.'
  })
]);
