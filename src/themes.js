'use strict';
// App themes: CSS variables + matching xterm palette.
const DARK_ANSI = {
  black: '#1b1f2a', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68', blue: '#7aa2f7', magenta: '#bb9af7', cyan: '#7dcfff', white: '#c0caf5',
  brightBlack: '#565f89', brightRed: '#ff899d', brightGreen: '#b4e08a', brightYellow: '#f0c987', brightBlue: '#8fb4ff', brightMagenta: '#cdb0ff', brightCyan: '#9be0ff', brightWhite: '#e6ebff',
};
const LIGHT_ANSI = {
  black: '#2b2a28', red: '#c8372d', green: '#2f7d32', yellow: '#a1620b', blue: '#2f5fd0', magenta: '#8a3fc4', cyan: '#0b7a8a', white: '#8a857d',
  brightBlack: '#6e6a63', brightRed: '#e0483c', brightGreen: '#3b9a40', brightYellow: '#bf7a14', brightBlue: '#4574e8', brightMagenta: '#a456e0', brightCyan: '#1496a8', brightWhite: '#3a3935',
};

const THEMES = {
  midnight: { name: 'Midnight', dark: true, v: { bg0: '#0b0d12', bg1: '#10131a', bg2: '#171b25', bg3: '#1f2431', line: '#232938', text: '#e7eaf3', dim: '#8a92a8', faint: '#576079' },
    term: { background: '#0b0d12', foreground: '#d8dcec', ...DARK_ANSI } },
  graphite: { name: 'Graphite', dark: true, v: { bg0: '#141414', bg1: '#1a1a1a', bg2: '#222222', bg3: '#2b2b2b', line: '#2f2f2f', text: '#ececec', dim: '#9a9a9a', faint: '#6a6a6a' },
    term: { background: '#141414', foreground: '#dcdcdc', ...DARK_ANSI, black: '#222222' } },
  nord: { name: 'Nord', dark: true, v: { bg0: '#242933', bg1: '#2a303c', bg2: '#323947', bg3: '#3b4252', line: '#3b4252', text: '#eceff4', dim: '#9aa5b8', faint: '#6b7689' },
    term: { background: '#242933', foreground: '#d8dee9', black: '#3b4252', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b', blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0', white: '#e5e9f0',
      brightBlack: '#6b7689', brightRed: '#d08770', brightGreen: '#b5d19e', brightYellow: '#f2d9a0', brightBlue: '#8fbcbb', brightMagenta: '#c6a0c0', brightCyan: '#9bd3e3', brightWhite: '#eceff4' } },
  dawn: { name: 'Dawn (light)', dark: false, v: { bg0: '#fbfaf8', bg1: '#f3f1ed', bg2: '#ffffff', bg3: '#e9e6e0', line: '#e1ddd5', text: '#25231f', dim: '#6c675e', faint: '#9d978c' },
    term: { background: '#fbfaf8', foreground: '#2b2a28', cursor: '#2b2a28', selectionBackground: '#cfdcf7', ...LIGHT_ANSI } },
};

const ACCENTS = {
  clay: '#d97757', violet: '#8b7cf6', azure: '#4c9aff', mint: '#34c38f', rose: '#ec6ca8', teal: '#2dd4bf', amber: '#f2b84b',
};

// Color tags for folders / sessions
const TAG_COLORS = ['#d97757', '#f2b84b', '#34c38f', '#2dd4bf', '#4c9aff', '#8b7cf6', '#ec6ca8', '#8a92a8'];

function applyTheme(themeKey, accentKey) {
  const t = THEMES[themeKey] || THEMES.midnight;
  const accent = ACCENTS[accentKey] || ACCENTS.clay;
  const r = document.documentElement.style;
  for (const [k, val] of Object.entries(t.v)) r.setProperty('--' + k, val);
  r.setProperty('--accent', accent);
  r.setProperty('--accent-soft', accent + '26');
  r.setProperty('--accent-line', accent + '66');
  document.documentElement.dataset.mode = t.dark ? 'dark' : 'light';
  const term = { cursor: accent, cursorAccent: t.term.background, selectionBackground: t.dark ? accent + '55' : '#cfdcf7', ...t.term };
  return { term, dark: t.dark, bg: t.v.bg0, symbol: t.v.dim };
}
