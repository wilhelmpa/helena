export const terminalThemes = {
  dark: {
    background: '#050507',
    foreground: '#eeeaf6',
    cursor: '#bdaaff',
    selectionBackground: '#26212d',
    black: '#09080b',
    red: '#f4a3bf',
    green: '#7ee0b8',
    yellow: '#f4c46a',
    blue: '#9e99de',
    magenta: '#bdaaff',
    cyan: '#29e8b5',
    white: '#cfc6da',
    brightBlack: '#6f687a',
    brightRed: '#f5459e',
    brightGreen: '#9ff3ce',
    brightYellow: '#ffe0a0',
    brightBlue: '#bdaaff',
    brightMagenta: '#d9caff',
    brightCyan: '#8ff5df',
    brightWhite: '#eeeaf6',
  },
  light: {
    background: '#faf9f7',
    foreground: '#201b29',
    cursor: '#7051b5',
    selectionBackground: '#e7dbfa',
    black: '#201b29',
    red: '#a83862',
    green: '#227a58',
    yellow: '#86550a',
    blue: '#6254a8',
    magenta: '#7051b5',
    cyan: '#147e69',
    white: '#6f687a',
    brightBlack: '#6f687a',
    brightRed: '#c51d6c',
    brightGreen: '#169b71',
    brightYellow: '#ab7413',
    brightBlue: '#7866c5',
    brightMagenta: '#936cc9',
    brightCyan: '#1b9e85',
    brightWhite: '#3c3446',
  },
} as const;

type WettyTerminal = {
  options: {
    theme: typeof terminalThemes.dark | typeof terminalThemes.light;
    fontFamily: string;
    fontSize: number;
    lineHeight: number;
  };
  resizeTerm(): void;
};

type WettyWindow = Window & { wetty_term?: WettyTerminal };

export function attachTerminalTheme(frame: HTMLIFrameElement, mode: 'dark' | 'light') {
  const theme = terminalThemes[mode];
  let current: WettyTerminal | undefined;
  const apply = () => {
    let win: WettyWindow | null;
    try {
      win = frame.contentWindow as WettyWindow | null;
      if (!win?.document?.head) return;
    } catch {
      return;
    }
    const doc = win.document;
    let style = doc.getElementById('helena-terminal-theme') as HTMLStyleElement | null;
    if (!style) {
      style = doc.createElement('style');
      style.id = 'helena-terminal-theme';
      doc.head.appendChild(style);
    }
    if (style.dataset.helenaMode !== mode) {
      // Wetty's own keyboard and gear buttons are hidden (owner, 28.09., O29): Helena's
      // tab bar and the phone's key bar do their work.
      style.textContent = `@font-face{font-family:'Helena JetBrains Mono';src:url('/fonts/helena-jetbrains-mono-latin.woff2') format('woff2');font-weight:100 900;font-display:swap}html,body{background:${theme.background};color-scheme:${mode}}#terminal{box-sizing:border-box;padding:12px;background:${theme.background}}#functions,#options,.toggler{display:none!important}`;
      style.dataset.helenaMode = mode;
    }
    const term = win.wetty_term;
    if (!term) return;
    const isNewTerminal = term !== current;
    if (isNewTerminal || term.options.theme !== theme) term.options.theme = theme;
    if (!isNewTerminal) return;
    term.options.fontFamily = 'Helena JetBrains Mono, monospace';
    term.options.fontSize = 13;
    term.options.lineHeight = 1.25;
    current = term;
    term.resizeTerm();
    void doc.fonts?.ready.then(() => {
      if (win?.wetty_term === term) term.resizeTerm();
    });
  };
  apply();
  frame.addEventListener('load', apply);
  const interval = window.setInterval(apply, 500);
  return () => {
    frame.removeEventListener('load', apply);
    window.clearInterval(interval);
  };
}
