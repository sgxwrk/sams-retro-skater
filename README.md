# Sam’s Retro Skater

Pixel-art skater endless runner as a **dependency-free web component**. No build step, no framework. The longer you survive, the faster it gets, and the weather turns from sun to snow to thunderstorm.

**Play it:** https://sgxwrk.github.io/sams-retro-skater/ (once GitHub Pages is enabled: Settings → Pages → Deploy from branch `main` / root).

## The story behind it

This little runner started as a side quest during my portfolio facelift. I wanted error pages and other quiet corners of the site to feel a bit more playful, so instead of a dead-end 404 you get a skater rolling through the weather. One small idea led to another, and it ended up as its own little project.

Keep rolling. 🛹

## Use it

```html
<sams-retro-skater></sams-retro-skater>
<script type="module" src="./src/runner-game.js"></script>
```

Or as a dependency (for example from another site):

```bash
npm i github:sgxwrk/sams-retro-skater#v1.0.1
```

```js
import 'sams-retro-skater';
```

Controls: space, arrow up, click or tap. Keys only react while the game is on screen and focus is not in a form field or link, so page scrolling with space keeps working elsewhere.

## Theming

Everything is driven by CSS custom properties on the element (or any ancestor). Defaults follow `prefers-color-scheme`.

```css
sams-retro-skater {
  --runner-fg: #1a1a1a;
  --runner-bg: #ffffff;
  --runner-muted: #6b6b66;
  --runner-accent: #c3d400;
  --runner-font: "My Pixel Font", monospace; /* default: Pixelify Sans */
  --runner-radius: 12px;
  --runner-title-size: 1.75rem;
}
```

Any CSS color works (hex, oklch, `light-dark()`). The game re-reads the colors when `class` / `data-theme` on `<html>` changes or the system theme switches. Call `element.recolor()` after other theme changes.

## Attributes

| Attribute | Purpose |
| --- | --- |
| `label-score`, `label-ready`, `label-gameover` | UI texts |
| `hint-start`, `hint-restart` | Hint under the title, `\n` for a line break |
| `storage-key` | `localStorage` key of the high score (default `sams-retro-skater:hi`) |
| `start-score` | Start at a given score, e.g. `6000` to see the rain |
| `no-font` | Do not load Pixelify Sans, set `--runner-font` yourself |
| `debug` | Expose `window.__runner` for balance tests |

Events: `gamestart` and `gameover` (`detail: { score, hi }`).

Parts for styling from outside: `head`, `stage`, `title`, `hint`.

## Score and weather

| Score | What happens |
| --- | --- |
| 0 | Sun |
| 550 – 3400 | Clouds roll in, the sun sets |
| 2250 – 6400 | Snow |
| 5600 – 15000 | Rain, from a few drops to a downpour |
| ~11300 + | Thunderstorm with lightning |
| 15000 – 30000 | Speed rises from 960 to 1400 px/s, obstacle groups get denser and larger |

## License

Code: MIT. Font: Pixelify Sans, SIL Open Font License 1.1 (`fonts/OFL.txt`).
