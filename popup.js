// The toolbar popup. Before it existed, clicking the extension's icon did
// nothing at all, and that is the first thing many people try right after
// installing. It lists the channels from channels.js, in the theme the reader
// is set to.
(() => {
  'use strict';

  const THEMES = ['sepia', 'dark', 'light',
    'darcula', 'monokai', 'dracula', 'onedark', 'nord', 'gruvbox', 'solarized-dark', 'solarized-light', 'latte',
    'tokyonight', 'rosepine', 'rosepine-dawn', 'everforest', 'everforest-light', 'gruvbox-light', 'onelight',
    'cobalt2', 'synthwave', 'zenburn', 'contrast', 'paper'];

  // Read-only: the reader owns the `ytds` key. Outside the extension (the page
  // opened as a plain file) there is no storage, and sepia is the default.
  try {
    chrome.storage.local.get('ytds', (r) => {
      const t = r && r.ytds && r.ytds.theme;
      document.body.dataset.theme = THEMES.includes(t) ? t : 'sepia';
    });
  } catch (_) { /* stays sepia */ }

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const list = document.getElementById('list');
  for (const ch of globalThis.YTDS_CHANNELS || []) {
    const body = el('div');
    body.append(el('div', 'name', ch.name), el('div', 'handle', ch.handle), el('p', 'about', ch.about));
    const why = el('p', 'why');
    why.append(el('b', null, 'Why here:'), document.createTextNode(' ' + ch.why));
    const link = el('a', null, 'Open channel ↗');
    link.href = ch.url;
    link.target = '_blank';
    link.rel = 'noopener';
    body.append(why, link);
    const item = el('li');
    item.append(el('div', 'initials', ch.initials), body);
    list.appendChild(item);
  }
})();
