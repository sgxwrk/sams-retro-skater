// Spiel-Engine von sams-retro-skater: Skater-Endless-Runner auf einem
// Pixel-Canvas. boot() verdrahtet die Engine mit dem Shadow-DOM der
// Web Component (siehe runner-game.js) und liefert { recolor, destroy }.
// Alle Maße sind logische Spielpixel (Welt 500–800 × Höhe nach Seitenverhältnis).
export function boot(root, host, opts) {
  // Logische Spielwelt: Breite 600–800, Höhe folgt der Anzeigehöhe (siehe fit()).
  let W = 800, H = 347, GROUND = 297;
  const canvas = root.getElementById('game');
  const view = canvas.getContext('2d');
  // Pixel-Look: Die Szene wird auf einem kleinen Offscreen-Canvas gezeichnet
  // (1 Spielpixel = PS logische Pixel), Kanten werden hart geschnitten (kein
  // Anti-Aliasing) und dann ohne Glättung hochskaliert.
  const PS = 3;
  const lo = document.createElement('canvas');
  const ctx = lo.getContext('2d', { willReadFrequently: true });
  const scoreEl = root.getElementById('score');
  const hiEl = root.getElementById('hi');
  const overlay = root.getElementById('overlay');
  const titleEl = root.getElementById('title');
  const hintEl = root.getElementById('hint');
  const finalEl = root.getElementById('final');
  const stage = root.getElementById('stage');

  // Scharfe Darstellung: Zeichenfläche an Anzeigebreite × Pixeldichte
  // koppeln, Koordinaten bleiben logisch 800x450 (16:9).
  function fit() {
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (!cw || !ch) return;
    // Desktop: 800 logische Pixel breit. Schmale Anzeige (Mobile) mit
    // Mindesthöhe 280px: Welt auf min. 500 Breite verkleinern, statt nur
    // einen schmalen Ausschnitt zu zeigen, die Höhe wächst entsprechend.
    W = Math.max(500, Math.min(800, (cw / ch) * 450));
    const scale = cw / W;
    H = ch / scale;
    GROUND = H - 50;
    if (player.onGround) player.y = GROUND;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    lo.width = Math.ceil(W / PS);
    lo.height = Math.ceil(H / PS);
    ctx.setTransform(1 / PS, 0, 0, 1 / PS, 0, 0);
  }

  // Alpha hart schneiden (0 oder 255) = keine weichen Kanten, dann hochskalieren.
  function present() {
    const img = ctx.getImageData(0, 0, lo.width, lo.height);
    const d = img.data;
    for (let i = 3; i < d.length; i += 4) d[i] = d[i] > 80 ? 255 : 0;
    ctx.putImageData(img, 0, 0);
    view.imageSmoothingEnabled = false;
    view.clearRect(0, 0, canvas.width, canvas.height);
    view.drawImage(lo, 0, 0, lo.width, lo.height, 0, 0, canvas.width * (lo.width * PS / W), canvas.height * (lo.height * PS / H));
  }

  // Farben aus den CSS-Variablen des Hosts (--_fg/-bg/-muted/-accent, gespeist aus --runner-*). Jede
  // CSS-Farbe (hex, oklch, light-dark() ...) wird über einen 1×1-Canvas in
  // deckendes RGB aufgelöst. FAINT = fg zu 14 % in bg gemischt (deckend, sonst
  // fiele die Fläche beim harten Alpha-Schnitt weg).
  let FG, BG, MUTED, FAINT, ACCENT;
  const probe = document.createElement('canvas'); probe.width = probe.height = 1;
  const pctx = probe.getContext('2d', { willReadFrequently: true });
  function resolveColor(name) {
    const el = root.getElementById('probe');
    el.style.color = 'var(' + name + ')';
    const css = getComputedStyle(el).color;
    pctx.clearRect(0, 0, 1, 1); pctx.fillStyle = '#000'; pctx.fillStyle = css; pctx.fillRect(0, 0, 1, 1);
    const d = pctx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  }
  const rgb = (c) => 'rgb(' + c.join(',') + ')';
  function readColors() {
    const fg = resolveColor('--_fg'), bg = resolveColor('--_bg');
    FG = rgb(fg); BG = rgb(bg); MUTED = rgb(resolveColor('--_muted')); ACCENT = rgb(resolveColor('--_accent'));
    FAINT = rgb(fg.map((c, i) => Math.round(bg[i] + (c - bg[i]) * 0.14)));
  }
  readColors();
  const GRAVITY = 2600, JUMP_V = 860;
  const START_SPEED = 360, MAX_SPEED = 960, ACCEL = 14, TOP_SPEED = 1400, BOOST_FROM = 15000, BOOST_TO = 30000; // px/s, px/s pro Sekunde

  const pad = (n) => String(Math.floor(n)).padStart(5, '0');
  let hi = 0, destroyed = false;
  try { hi = Number(localStorage.getItem(opts.storageKey)) || 0; } catch (e) {}
  hiEl.textContent = pad(hi);

  const player = { x: 70, y: GROUND, w: 34, h: 44, vy: 0, onGround: true };
  let parts = [], airT = 0, lastShown = 0, obstacles = [], clouds = [], state = 'ready', speed, distance, nextGap, last, t;

  // Wetter: Intensität 0–1 aus dem Score (Schnee zuerst, dann Regen, dann Gewitter).
  // Pools mit festem Schwellwert je Partikel, damit die Dichte weich zu- und
  // abnimmt. Test: ?start=6000 springt im Score vor.
  const START_SCORE = opts.startScore;
  const mk = (n) => Array.from({ length: n }, () => ({ x: Math.random() * 900, y: Math.random() * 400, a: Math.random(), k: 0.6 + Math.random() * 0.8, ph: Math.random() * 6.28 }));
  const rain = mk(95), snow = mk(70);
  let rainI = 0, snowI = 0, cloudI = 0, sunOut = 0;
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  function weather(score) {
    // Reihenfolge mit großem Abstand: Sonne bis ~2200, Wolken 550–3400, Schnee
    // 2250–6400, Regen ab 5600 mit sehr langer Rampe bis 15000 (leichter Regen
    // bis Starkregen = der schwerste Abschnitt), Gewitter ab ~11300.
    cloudI = clamp01((score - 550) / 2850);
    sunOut = clamp01((score - 900) / 1350);
    rainI = Math.pow(clamp01((score - 5600) / 9400), 1.6);
    snowI = clamp01((score - 2250) / 1125) * (1 - clamp01((score - 5600) / 750));
  }
  // Blitz in Etappen: schwaches Aufhellen, Pause, starker Schlag mit Blitzlinie,
  // Pause, Nachleuchten. Nur bei starkem Regen, alle 4–10 s.
  const BOLT_STEPS = [[1, 0.06], [0, 0.08], [2, 0.09], [0, 0.05], [1, 0.12]];
  let flash = 0, flashStep = -1, flashT = 0, nextBolt = 3, boltX = 0, boltPts = [];
  function makeBolt() {
    boltX = 120 + Math.random() * (W - 240); boltPts = [];
    let x = boltX;
    for (let y = 0; y < GROUND; y += 24) { boltPts.push([x, y]); x += (Math.random() - 0.5) * 50; }
    boltPts.push([x, GROUND + 6]);
  }
  function updateFlash(dt) {
    if (flashStep < 0) {
      if (rainI > 0.45) { nextBolt -= dt; if (nextBolt <= 0) { flashStep = 0; flashT = BOLT_STEPS[0][1]; flash = BOLT_STEPS[0][0]; makeBolt(); } }
      return;
    }
    flashT -= dt;
    if (flashT <= 0) {
      flashStep++;
      if (flashStep >= BOLT_STEPS.length) { flashStep = -1; flash = 0; nextBolt = 4 + Math.random() * 6; return; }
      flash = BOLT_STEPS[flashStep][0]; flashT = BOLT_STEPS[flashStep][1];
    }
  }
  function drawFlash() {
    if (!flash) return;
    ctx.fillStyle = flash === 2 ? MUTED : FAINT;
    ctx.fillRect(0, 0, W, H);
    if (flash === 2) {
      ctx.strokeStyle = FG; ctx.lineWidth = PS; ctx.beginPath();
      boltPts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    }
  }
  function updateWeather(dt) {
    updateFlash(dt);
    for (const r of rain) {
      if (r.a > rainI) continue;
      r.x += (-speed * 0.35 - 120) * dt * r.k; r.y += 820 * r.k * dt;
      if (r.y > GROUND + 24 || r.x < -10) { r.x = Math.random() * (W + 160); r.y = -10 - Math.random() * 60; }
    }
    for (const f of snow) {
      if (f.a > snowI) continue;
      f.ph += dt * 2;
      f.x += (-speed * 0.12 + Math.sin(f.ph) * 22) * dt; f.y += 70 * f.k * dt;
      if (f.y > GROUND + 24 || f.x < -10) { f.x = Math.random() * (W + 60); f.y = -10 - Math.random() * 40; }
    }
  }
  function drawWeather() {
    ctx.fillStyle = flash === 2 ? FG : MUTED;
    for (const r of rain) {
      if (r.a > rainI) continue;
      ctx.fillRect(Math.round(r.x / PS) * PS, Math.round(r.y / PS) * PS, PS, PS * 3);
    }
    ctx.fillStyle = FG;
    for (const f of snow) {
      if (f.a > snowI) continue;
      ctx.fillRect(Math.round(f.x / PS) * PS, Math.round(f.y / PS) * PS, PS, PS);
    }
  }

  function reset() {
    player.y = GROUND; player.vy = 0; player.onGround = true;
    obstacles = []; parts = []; airT = 0; lastShown = 0;
    // 3 Start-Wolken + 6 weitere, die erst mit steigendem Score (cloudI) beim
    // Wiedereintritt am rechten Rand aktiv werden — kein Aufploppen mitten im Bild.
    clouds = [
      { x: 200, y: 60, s: 1, a: 0, on: true }, { x: 520, y: 130, s: 0.8, a: 0, on: true }, { x: 760, y: 50, s: 1.1, a: 0, on: true },
      { x: 330, y: 95, s: 1.2, a: 0.15, on: false }, { x: 640, y: 80, s: 0.9, a: 0.3, on: false }, { x: 90, y: 120, s: 1, a: 0.45, on: false },
      { x: 450, y: 45, s: 1.3, a: 0.6, on: false }, { x: 860, y: 110, s: 1.1, a: 0.75, on: false }, { x: 150, y: 35, s: 0.9, a: 0.9, on: false },
    ];
    speed = START_SCORE > 1500 ? MAX_SPEED : START_SPEED; distance = START_SCORE * 10; nextGap = 500; t = 0; weather(START_SCORE); for (const c of clouds) c.on = c.a <= cloudI; flash = 0; flashStep = -1; nextBolt = 3;
  }

  function jump() {
    if (state === 'ready' || state === 'over') { start(); return; }
    if (player.onGround) { player.vy = -JUMP_V; player.onGround = false; }
  }

  function start() {
    // Kurze Sperre nach Game Over, damit ein hektischer Doppel-Tipp nicht sofort neu startet.
    if (state === 'over' && performance.now() - overAt < 350) return;
    reset();
    state = 'running';
    host.dispatchEvent(new CustomEvent('gamestart'));
    overlay.hidden = true;
    finalEl.hidden = true;
    player.vy = -JUMP_V; player.onGround = false;
    readColors();
    last = performance.now();
    requestAnimationFrame(loop);
  }

  let overAt = 0;
  function gameOver() {
    state = 'over';
    overAt = performance.now();
    const score = distance / 10;
    if (score > hi) {
      hi = score;
      hiEl.textContent = pad(hi);
      try { localStorage.setItem(opts.storageKey, String(Math.floor(hi))); } catch (e) {}
    }
    titleEl.textContent = opts.text.gameOver;
    scoreEl.textContent = pad(score);
    finalEl.textContent = pad(score);
    finalEl.hidden = false;
    hintEl.textContent = opts.text.hintRestart;
    overlay.hidden = false;
    draw();
    host.dispatchEvent(new CustomEvent('gameover', { detail: { score: Math.floor(score), hi: Math.floor(hi) } }));
  }

  // Staubpartikel an den Rollen (n Stück, Stärke k).
  function burst(n, k) {
    for (let i = 0; i < n; i++) {
      parts.push({
        x: player.x + 4 + Math.random() * 8,
        y: GROUND - 1,
        vx: -(40 + Math.random() * 90) * k,
        vy: -(30 + Math.random() * 90) * k,
        life: 0.25 + Math.random() * 0.25,
        r: 1 + Math.random() * 1.6,
      });
    }
  }

  // Hindernistypen: Pylone (niedrig, oft 2-3 in Reihe), Mülltonne (hoch,
  // schmal), Kisten (breit, einzeln oder als Paar). Maße = Trefferfläche.
  function spawn() {
    // Härtegrad 0–1 von Score 15000 bis 30000: dichtere Abfolge, größere Gruppen.
    const hard = clamp01((distance / 10 - BOOST_FROM) / (BOOST_TO - BOOST_FROM));
    const r = Math.random();
    const type = r < 0.4 ? 'cone' : r < 0.7 ? 'bin' : 'crate';
    const base = W + 20;
    if (type === 'cone') {
      const count = 1 + Math.floor(Math.random() * (speed > 600 ? (hard > 0.3 ? 4 : 3) : 2));
      for (let i = 0; i < count; i++) obstacles.push({ type, x: base + i * 30, w: 24, h: 32 });
    } else if (type === 'bin') {
      obstacles.push({ type, x: base, w: 30, h: 50 });
    } else {
      const pair = speed > 500 && Math.random() < 0.5 + 0.3 * hard;
      const triple = pair && hard > 0.5 && Math.random() < 0.5 * hard;
      if (pair && !triple && Math.random() < 0.45) {
        // Bank als Variante zum Kistenpaar: gleiche Breite, niedriger (34 px).
        obstacles.push({ type: 'bench', x: base, w: 78, h: 34 });
      } else {
        obstacles.push({ type, x: base, w: 38, h: 38 });
        if (pair) obstacles.push({ type, x: base + 40, w: 38, h: 38 });
      }
      if (triple) obstacles.push({ type, x: base + 80, w: 38, h: 38 });
    }
    // Mindestabstand wächst mit dem Tempo, damit jede Lücke überspringbar bleibt:
    // Flugzeit ~0,66 s × Tempo plus Reaktionspuffer, dazu Zufall.
    const airDist = speed * (2 * JUMP_V / GRAVITY);
    // Ab 15000 schrumpfen Puffer und Zufallsanteil bis 30000 (Minimum ≈ 1,08 × Flugweite + 90 px).
    nextGap = airDist * (1.15 - 0.07 * hard) + 120 - 30 * hard + Math.random() * speed * (0.7 - 0.45 * hard);
  }

  function hits(o) {
    // Etwas kleinere Hitbox als die Grafik fühlt sich fair an.
    const m = 5;
    return (
      player.x + m < o.x + o.w - 2 &&
      player.x + player.w - m > o.x + 2 &&
      player.y - player.h + m < GROUND &&
      player.y - m > GROUND + 6 - o.h
    );
  }

  function update(dt) {
    t += dt;
    speed = Math.min(MAX_SPEED, speed + ACCEL * dt);
    // Ab Score 15000 noch einmal linear schneller, bis 30000 das Höchsttempo erreicht ist.
    const sc = distance / 10;
    if (sc > BOOST_FROM) speed = MAX_SPEED + clamp01((sc - BOOST_FROM) / (BOOST_TO - BOOST_FROM)) * (TOP_SPEED - MAX_SPEED);
    distance += speed * dt;

    player.vy += GRAVITY * dt;
    player.y += player.vy * dt;
    if (player.y >= GROUND) {
      if (!player.onGround) burst(8, 1.4); // Landung: Staubwolke
      player.y = GROUND; player.vy = 0; player.onGround = true;
    }
    airT = player.onGround ? 0 : airT + dt;
    // Rollender Staub hinter dem Board
    if (player.onGround && Math.random() < dt * 28) burst(1, 0.6);
    for (const q of parts) { q.x += q.vx * dt - speed * dt * 0.6; q.y += q.vy * dt; q.vy += 300 * dt; q.life -= dt; }
    parts = parts.filter((q) => q.life > 0);

    weather(distance / 10); updateWeather(dt);
    nextGap -= speed * dt;
    if (nextGap <= 0) spawn();

    for (const o of obstacles) o.x -= speed * dt;
    obstacles = obstacles.filter((o) => o.x + o.w > -10);

    for (const c of clouds) {
      c.x -= speed * 0.15 * dt;
      if (c.x < -80) { c.x = W + 40 + Math.random() * 60; c.y = 30 + Math.random() * H * 0.35; c.on = c.a <= cloudI; }
    }

    for (const o of obstacles) if (hits(o)) { gameOver(); return; }
    // Anzeige nur 4× pro Sekunde aktualisieren (ruhiger beim Spielen), der
    // interne Score zählt weiter exakt, Game Over zeigt den genauen Wert.
    if (t - lastShown >= 0.25) { scoreEl.textContent = pad(distance / 10); lastShown = t; }
  }

  // Skater auf Skateboard. Ursprung = Boden unter der Figur (Mitte), alles in
  // Spielpixeln. Am Boden: Vorlage nach vorn, federnde Knie, rollende Räder
  // und Speedlines. Im Sprung: Kickflip (das Board dreht sich um seine
  // Längsachse, dargestellt als Höhen-Stauchung), Beine angezogen, Arme hoch.
  function drawPlayer() {
    const air = !player.onGround;
    const running = state === 'running';
    const rolling = running && !air;
    const lean = rolling ? 0.12 + Math.min(speed / MAX_SPEED, 1) * 0.1 : 0; // schneller = tiefer
    const angle = air ? Math.max(-0.3, Math.min(0.3, (player.vy / JUMP_V) * 0.3)) : 0;
    const bob = rolling ? Math.sin(t * 14) * 1.2 : 0;

    // Speedlines hinter der Figur
    if (running) {
      ctx.strokeStyle = FAINT; ctx.lineWidth = 2; ctx.lineCap = 'round';
      for (let i = 0; i < 4; i++) {
        const ly = player.y - 8 - i * 10 - (air ? 4 : 0);
        const lx = player.x - 8 - ((t * 260 + i * 37) % 70);
        ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx - 14 - i * 3, ly); ctx.stroke();
      }
    }
    // Staub
    ctx.fillStyle = MUTED;
    for (const q of parts) { ctx.fillRect(Math.round(q.x / PS) * PS, Math.round(q.y / PS) * PS, PS, PS); }

    ctx.save();
    ctx.translate(player.x + player.w / 2, player.y);
    ctx.rotate(angle);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    // Board (Kickflip: Dreh um die Längsachse während des Sprungs)
    const flip = air ? Math.cos(Math.min(airT / 0.62, 1) * Math.PI * 2) : 1;
    ctx.save();
    ctx.translate(0, -9);
    ctx.scale(1, Math.max(Math.abs(flip), 0.12));
    ctx.strokeStyle = FG; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(-23, -4); ctx.lineTo(-18, 1); ctx.lineTo(18, 1); ctx.lineTo(23, -4); ctx.stroke();
    ctx.strokeStyle = ACCENT; ctx.lineWidth = 3; // Griptape-Streifen
    ctx.beginPath(); ctx.moveTo(-12, 1); ctx.lineTo(12, 1); ctx.stroke();
    ctx.restore();
    // Achsen + Rollen
    ctx.fillStyle = MUTED;
    for (const wx of [-11, 11]) {
      ctx.fillRect(wx - 1, -9, 2, 3);
      ctx.beginPath(); ctx.arc(wx, -3.5, 3.8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = BG;
      const w = rolling ? t * 22 : 0;
      ctx.beginPath(); ctx.arc(wx + Math.cos(w) * 1.6, -3.5 + Math.sin(w) * 1.6, 0.9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = MUTED;
    }

    // Körper, nach vorn geneigt
    ctx.save();
    ctx.rotate(lean);
    const hipY = air ? -22 : -26 + bob;
    // Schuhe (Akzent) auf dem Deck
    ctx.fillStyle = ACCENT;
    ctx.beginPath(); ctx.ellipse(-9, -11, 5, 2.4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(11, -11, 5, 2.4, 0, 0, Math.PI * 2); ctx.fill();
    // Baggy Pants (gedämpft), Knie vorn
    ctx.strokeStyle = MUTED; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(-9, -12); ctx.lineTo(air ? -3 : -2, hipY + 9); ctx.lineTo(-1, hipY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(10, -12); ctx.lineTo(air ? 9 : 7, hipY + 9); ctx.lineTo(2, hipY); ctx.stroke();
    // Hoodie
    ctx.strokeStyle = FG; ctx.lineWidth = 11;
    ctx.beginPath(); ctx.moveTo(0, hipY + 1); ctx.lineTo(3, hipY - 12); ctx.stroke();
    // Arme: am Boden locker nach hinten/vorn, in der Luft hoch
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(3, hipY - 11); ctx.lineTo(air ? -9 : -9, hipY - (air ? 22 : 7)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(3, hipY - 11); ctx.lineTo(air ? 16 : 15, hipY - (air ? 21 : 5)); ctx.stroke();
    // Kopf
    ctx.fillStyle = FG;
    ctx.beginPath(); ctx.arc(5, hipY - 21, 6.5, 0, Math.PI * 2); ctx.fill();
    // Cap rückwärts (Akzent) + Sonnenbrille
    ctx.fillStyle = ACCENT;
    ctx.beginPath(); ctx.arc(4.5, hipY - 22, 6.2, Math.PI, Math.PI * 2); ctx.fill();
    ctx.fillRect(-4, hipY - 23, 4, 2);
    ctx.fillStyle = BG;
    roundRect(5.5, hipY - 22, 8, 3.4, 1.6); ctx.fill();
    ctx.restore();

    ctx.restore();
  }

  function drawObstacle(o) {
    const bY = GROUND + 6; // Standlinie
    ctx.fillStyle = ACCENT;
    ctx.strokeStyle = BG; ctx.lineWidth = 3; ctx.lineCap = 'butt';
    if (o.type === 'cone') {
      // Pylon: Sockel + Kegel mit zwei Streifen
      ctx.fillRect(o.x - 1, bY - 4, o.w + 2, 4);
      ctx.beginPath(); ctx.moveTo(o.x + 3, bY - 4); ctx.lineTo(o.x + o.w / 2, bY - o.h); ctx.lineTo(o.x + o.w - 3, bY - 4); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(o.x + 7, bY - 13); ctx.lineTo(o.x + o.w - 7, bY - 13); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(o.x + 10, bY - 21); ctx.lineTo(o.x + o.w - 10, bY - 21); ctx.stroke();
    } else if (o.type === 'bin') {
      // Mülltonne: Korpus leicht konisch, Deckel mit Griff, Rippen
      ctx.beginPath(); ctx.moveTo(o.x + 2, bY - o.h + 6); ctx.lineTo(o.x + o.w - 2, bY - o.h + 6); ctx.lineTo(o.x + o.w - 5, bY); ctx.lineTo(o.x + 5, bY); ctx.closePath(); ctx.fill();
      roundRect(o.x - 1, bY - o.h, o.w + 2, 7, 3); ctx.fill();
      ctx.fillRect(o.x + o.w / 2 - 5, bY - o.h - 3, 10, 3);
      for (const rx of [0.3, 0.5, 0.7]) { ctx.beginPath(); ctx.moveTo(o.x + o.w * rx, bY - o.h + 13); ctx.lineTo(o.x + o.w * rx, bY - 6); ctx.stroke(); }
    } else if (o.type === 'bench') {
      // Parkbank: Sitzbrett, zwei Lehnenlatten, zwei Beine
      ctx.fillRect(o.x, bY - 18, o.w, 6);
      ctx.fillRect(o.x, bY - o.h, o.w, 5);
      ctx.fillRect(o.x, bY - o.h + 9, o.w, 5);
      ctx.fillRect(o.x + 2, bY - o.h, 5, o.h);
      ctx.fillRect(o.x + o.w - 7, bY - o.h, 5, o.h);
      ctx.fillRect(o.x + 6, bY - 12, 6, 12);
      ctx.fillRect(o.x + o.w - 12, bY - 12, 6, 12);
    } else {
      // Kiste: Rahmen mit Kreuz
      roundRect(o.x, bY - o.h, o.w, o.h, 3); ctx.fill();
      ctx.strokeRect(o.x + 5, bY - o.h + 5, o.w - 10, o.h - 10);
      ctx.beginPath(); ctx.moveTo(o.x + 5, bY - o.h + 5); ctx.lineTo(o.x + o.w - 5, bY - 5);
      ctx.moveTo(o.x + o.w - 5, bY - o.h + 5); ctx.lineTo(o.x + 5, bY - 5); ctx.stroke();
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function draw() { render(); present(); }

  function render() {
    ctx.clearRect(0, 0, W, H);
    drawFlash();

    // Sonne: geht ab Score 900 langsam unter, Strahlen atmen minimal
    if (sunOut < 1) {
      const sx = W - 130, sy = 72 + sunOut * 150, rr = 20;
      ctx.fillStyle = FG; ctx.strokeStyle = FG; ctx.lineWidth = PS;
      ctx.beginPath(); ctx.arc(sx, sy, rr, 0, Math.PI * 2); ctx.fill();
      for (let i = 0; i < 8; i++) {
        const an = i * Math.PI / 4;
        // Minimales Atmen: Strahllänge ±2 px, langsam (~3 s), je Strahl leicht versetzt
        const len = 18 + Math.sin((t || 0) * 2.1 + i * 0.8) * 2;
        ctx.beginPath(); ctx.moveTo(sx + Math.cos(an) * (rr + 8), sy + Math.sin(an) * (rr + 8));
        ctx.lineTo(sx + Math.cos(an) * (rr + len), sy + Math.sin(an) * (rr + len)); ctx.stroke();
      }
    }
    ctx.fillStyle = FAINT;
    for (const c of clouds) {
      if (!c.on) continue;
      roundRect(c.x, c.y, 54 * c.s, 14 * c.s, 7 * c.s); ctx.fill();
      roundRect(c.x + 12 * c.s, c.y - 8 * c.s, 30 * c.s, 14 * c.s, 7 * c.s); ctx.fill();
    }

    drawWeather();

    // Boden mit durchlaufenden Marken
    ctx.strokeStyle = MUTED; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, GROUND + 11); ctx.lineTo(W, GROUND + 11); ctx.stroke();
    ctx.fillStyle = MUTED;
    const off = (distance || 0) % 90;
    for (let x = -off; x < W; x += 90) ctx.fillRect(x + 30, GROUND + 20, 14, 2);

    // Hindernisse in Akzentfarbe (Strichgrafik, Details in Hintergrundfarbe)
    for (const o of obstacles) drawObstacle(o);

    drawPlayer();
  }

  function loop(now) {
    if (destroyed || state !== 'running') return;
    // dt begrenzen, damit ein Tab-Wechsel keinen riesigen Sprung auslöst.
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    update(dt);
    if (state === 'running') { draw(); requestAnimationFrame(loop); }
  }

  // Eingabe: Tasten nur, solange das Spiel sichtbar ist und der Fokus nicht in
  // einem Formularfeld/Link liegt — so bleibt Leertaste-Scrollen auf der Seite intakt.
  let visible = true;
  const onKey = (e) => {
    if (!visible || (e.code !== 'Space' && e.code !== 'ArrowUp')) return;
    const el = e.composedPath()[0];
    if (el && el.closest && el.closest('input,textarea,select,button,a,[contenteditable="true"]')) return;
    e.preventDefault();
    if (!e.repeat) jump();
  };
  const onPointer = (e) => { e.preventDefault(); jump(); };
  window.addEventListener('keydown', onKey);
  stage.addEventListener('pointerdown', onPointer);
  const io = new IntersectionObserver((es) => { visible = es[es.length - 1].isIntersecting; });
  io.observe(host);
  const ro = new ResizeObserver(() => { fit(); draw(); });
  ro.observe(canvas);
  // Theme-Wechsel (Klasse/Attribut am <html> oder System-Einstellung) → Farben neu lesen.
  const recolor = () => { readColors(); draw(); };
  const mo = new MutationObserver(recolor);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
  const mq = matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', recolor);

  // Nur für Balance-Tests (Attribut "debug"): Spielzustand lesbar ablegen.
  if (opts.debug) {
    window.__runner = { get obstacles() { return obstacles; }, get speed() { return speed; }, get state() { return state; }, player, jump, JUMP_V, GRAVITY };
  }
  fit();
  reset();
  draw();

  return {
    recolor,
    destroy() {
      destroyed = true;
      window.removeEventListener('keydown', onKey);
      stage.removeEventListener('pointerdown', onPointer);
      io.disconnect(); ro.disconnect(); mo.disconnect();
      mq.removeEventListener('change', recolor);
    },
  };
}
