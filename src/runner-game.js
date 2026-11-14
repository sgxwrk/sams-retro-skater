// <sams-retro-skater>: Skater-Endless-Runner als Web Component (Shadow DOM,
// ohne Abhängigkeiten, ohne Build-Schritt).
//
// Theming über CSS-Variablen am Element (oder einem Elternelement):
//   --runner-fg, --runner-bg, --runner-muted, --runner-accent
//   --runner-font (Standard: Pixelify Sans), --runner-radius, --runner-title-size
// Standardfarben folgen prefers-color-scheme (light-dark()).
//
// Attribute (alle optional):
//   start-score   Score, bei dem das Spiel startet (Test: 6000 = Regen)
//   storage-key   localStorage-Schlüssel für den Highscore
//   label-score / label-ready / label-gameover / hint-start / hint-restart
//                 Texte (Zeilenumbruch im Hinweis mit "\n")
//   no-font       Schrift nicht selbst laden (eigene --runner-font nutzen)
//   debug         legt window.__runner für Balance-Tests ab
// Events: "gamestart", "gameover" (detail: { score, hi })
import { boot } from './engine.js';

const FONT_STYLE_ID = 'sams-retro-skater-font';

// @font-face wirkt nicht im Shadow DOM — die Schrift muss einmalig im Dokument stehen.
function ensureFont() {
  if (document.getElementById(FONT_STYLE_ID)) return;
  const url = new URL('../fonts/PixelifySans-latin-wght.woff2', import.meta.url).href;
  const style = document.createElement('style');
  style.id = FONT_STYLE_ID;
  style.textContent = `@font-face{font-family:"Pixelify Sans";font-style:normal;font-weight:400 700;font-display:swap;src:url("${url}") format("woff2");unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD;}`;
  document.head.appendChild(style);
}

const STYLES = `
  :host {
    display: block;
    color-scheme: light dark;
    --_fg: var(--runner-fg, light-dark(#1a1a1a, #f5f5f2));
    --_bg: var(--runner-bg, light-dark(#ffffff, #020202));
    --_muted: var(--runner-muted, light-dark(#6b6b66, #8a8a85));
    --_accent: var(--runner-accent, light-dark(#8fa000, #d2ff00));
    font-family: var(--runner-font, "Pixelify Sans", ui-monospace, monospace);
    color: var(--_fg);
    -webkit-user-select: none; user-select: none;
    touch-action: manipulation;
  }
  [hidden] { display: none !important; }
  .head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 1rem; color: var(--_muted); }
  .label { font-size: .875rem; letter-spacing: .1em; text-transform: uppercase; }
  .nums { font-size: 1.25rem; letter-spacing: .08em; font-variant-numeric: tabular-nums; color: var(--_fg); }
  .nums b { font-weight: 400; color: var(--_accent); }
  .nums .cur { margin-left: 1rem; color: var(--_muted); }
  .stage { position: relative; overflow: hidden; cursor: pointer; border: 1px solid color-mix(in srgb, var(--_fg) 15%, transparent); border-radius: var(--runner-radius, 12px); outline-offset: 3px; }
  canvas { display: block; width: 100%; aspect-ratio: 16 / 9; min-height: 280px; image-rendering: pixelated; }
  .overlay { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; gap: .75rem; padding-bottom: 3.5rem; pointer-events: none; }
  .title { margin: 0; font-size: var(--runner-title-size, 1.75rem); font-weight: 400; }
  .final { margin: 0; font-size: 2.5rem; font-weight: 500; color: var(--_accent); font-variant-numeric: tabular-nums; }
  .hint { margin: 0; font-size: 1rem; line-height: 1.5; color: var(--_muted); white-space: pre-line; }
  .probe { position: absolute; width: 0; height: 0; visibility: hidden; }
`;

const DEFAULTS = {
  labelScore: 'Score',
  labelReady: 'Ready?',
  labelGameover: 'Game over',
  hintStart: 'Space, click or tap\nto jump',
  hintRestart: 'Space, click or tap\nto restart',
};

class SamsRetroSkater extends HTMLElement {
  connectedCallback() {
    if (this._game) return;
    const attr = (n, d) => (this.hasAttribute(n) ? this.getAttribute(n).replace(/\\n/g, '\n') : d);
    if (!this.hasAttribute('no-font')) ensureFont();

    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>${STYLES}</style>
      <div class="head" part="head">
        <span class="label">${attr('label-score', DEFAULTS.labelScore)}</span>
        <span class="nums">HI <b id="hi">00000</b><span class="cur" id="score">00000</span></span>
      </div>
      <div class="stage" id="stage" part="stage" role="button" tabindex="0" aria-label="${attr('label-ready', DEFAULTS.labelReady)}">
        <canvas id="game"></canvas>
        <div class="overlay" id="overlay">
          <p class="title" id="title" part="title">${attr('label-ready', DEFAULTS.labelReady)}</p>
          <p class="final" id="final" hidden></p>
          <p class="hint" id="hint" part="hint">${attr('hint-start', DEFAULTS.hintStart)}</p>
        </div>
      </div>
      <span class="probe" id="probe"></span>`;

    this._game = boot(root, this, {
      startScore: Number(this.getAttribute('start-score')) || 0,
      storageKey: this.getAttribute('storage-key') || 'sams-retro-skater:hi',
      debug: this.hasAttribute('debug'),
      text: {
        gameOver: attr('label-gameover', DEFAULTS.labelGameover),
        hintRestart: attr('hint-restart', DEFAULTS.hintRestart),
      },
    });
  }

  // Nach manuellen Theme-Änderungen, die das Element nicht selbst bemerkt.
  recolor() { this._game?.recolor(); }

  disconnectedCallback() {
    this._game?.destroy();
    this._game = null;
    this.shadowRoot.innerHTML = '';
  }
}

if (!customElements.get('sams-retro-skater')) customElements.define('sams-retro-skater', SamsRetroSkater);
export { SamsRetroSkater };
