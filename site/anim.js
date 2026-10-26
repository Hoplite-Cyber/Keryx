// Treillis Hoplite : le motif H de la charte couvre le bloc, un projecteur le révèle et il dérive lentement.
// Le motif est un réseau régulier : une « cellule » répétée par deux vecteurs. On la répète sur tout le rectangle.
// Sans le fichier du motif, ou si le visiteur demande moins de mouvement, rien d'animé n'est affiché.
(function () {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const noHover = matchMedia("(hover: none)"); // tablette / mobile : pas de curseur, le projecteur reste en place
  const CELL = { w: 228, h: 335, u: [152, 70.5], v: [76, -264] }; // mesurés sur l'image de la charte
  const MOTIF = { img: null, ready: false, failed: false, cbs: [] };
  const rgba = (c, a) => { const n = (c.match(/[\d.]+/g) || [255, 255, 255]).slice(0, 3); return `rgba(${n[0]},${n[1]},${n[2]},${a})`; };

  function motif(cb, src) {
    if (MOTIF.failed) return;
    if (!MOTIF.img) {
      MOTIF.img = new Image();
      MOTIF.img.onload = () => { MOTIF.ready = true; MOTIF.cbs.splice(0).forEach((f) => f()); };
      MOTIF.img.onerror = () => { MOTIF.failed = true; };
      MOTIF.img.src = src || "assets/brand/motif-cell.png";
    }
    if (MOTIF.ready) cb(); else MOTIF.cbs.push(cb);
  }

  const cellCache = new Map();
  // Cellule recolorée à l'échelle voulue : le fichier est cuivre, on garde la transparence et on change la couleur.
  function cellTinted(scale, color) {
    const key = `${scale.toFixed(3)}|${color}`;
    if (!cellCache.has(key)) {
      const c = document.createElement("canvas"); c.width = Math.max(1, Math.ceil(CELL.w * scale)); c.height = Math.max(1, Math.ceil(CELL.h * scale));
      const k = c.getContext("2d"); k.drawImage(MOTIF.img, 0, 0, c.width, c.height); k.globalCompositeOperation = "source-in"; k.fillStyle = color; k.fillRect(0, 0, c.width, c.height);
      if (cellCache.size > 40) cellCache.clear();
      cellCache.set(key, c);
    }
    return cellCache.get(key);
  }

  // Remplit le rectangle de motif : copies de la cellule en i·U + j·W, décalées de (ox, oy).
  function paintMotif(g, w, h, scale, color, ox = 0, oy = 0) {
    const cell = cellTinted(scale, color), ux = CELL.u[0] * scale, uy = CELL.u[1] * scale, vx = CELL.v[0] * scale, vy = CELL.v[1] * scale, det = ux * vy - vx * uy;
    const cw = CELL.w * scale, ch = CELL.h * scale;
    let i0 = 1e9, i1 = -1e9, j0 = 1e9, j1 = -1e9;
    for (const [x, y] of [[-cw - ox, -ch - oy], [w + cw - ox, -ch - oy], [-cw - ox, h + ch - oy], [w + cw - ox, h + ch - oy]]) {
      const i = (x * vy - y * vx) / det, j = (ux * y - uy * x) / det;
      i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j);
    }
    for (let i = Math.floor(i0) - 1; i <= Math.ceil(i1) + 1; i++) for (let j = Math.floor(j0) - 1; j <= Math.ceil(j1) + 1; j++) {
      const x = ox + i * ux + j * vx, y = oy + i * uy + j * vy;
      if (x > w || y > h || x + cw < 0 || y + ch < 0) continue;
      g.drawImage(cell, x, y);
    }
  }

  // Boucle d'animation : redimensionne, se met en pause hors écran, une seule image si « mouvement réduit ».
  function hoplite(canvas, o = {}) {
    const ctx = canvas.getContext("2d"), t0 = performance.now(), mouse = { x: null, y: null };
    let w = 1, h = 1, raf = 0, visible = true, tex = null, scratch = null, active = false;
    // Mode « carte » (o.hover) : motif fixe et discret ; le projecteur n'apparaît et ne bouge qu'au survol à la souris.
    const idle = () => !!o.hover && !active;
    motif(() => {}, o.src);

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2), r = canvas.getBoundingClientRect();
      w = Math.max(1, r.width); h = Math.max(1, r.height);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      tex = null;
    }

    function draw(t) {
      if (!MOTIF.ready) return;
      const color = o.tint || getComputedStyle(canvas).color, sc0 = o.scale ?? 0.46, cw = CELL.w * sc0, ch = CELL.h * sc0;
      if (idle()) { // motif fixe, tracé directement : pas de grande texture en mémoire
        ctx.clearRect(0, 0, w, h); ctx.globalAlpha = 0.15; paintMotif(ctx, w, h, sc0, color); ctx.globalAlpha = 1;
        return;
      }
      const mx = Math.ceil(cw + 160 * sc0) + 8, my = Math.ceil(ch + 71 * sc0) + 8, dpr = canvas.width / w;
      // Texture plus grande que le bloc : on la décale le long de U (le motif se superpose alors exactement à lui-même) : boucle sans à-coup.
      const key = `${Math.round(w)}x${Math.round(h)}|${color}|${sc0}`;
      if (!tex || tex.key !== key) {
        const c = document.createElement("canvas"); c.width = Math.ceil((w + 2 * mx) * dpr); c.height = Math.ceil((h + 2 * my) * dpr);
        const g = c.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); paintMotif(g, w + 2 * mx, h + 2 * my, sc0, color); tex = { key, c };
      }
      const k = (t * 0.03) % 1, dx = -mx + k * CELL.u[0] * sc0 + (mouse.x != null ? (w / 2 - mouse.x) * 0.015 : 0), dy = -my + k * CELL.u[1] * sc0;
      const dw = tex.c.width / dpr, dh = tex.c.height / dpr;
      ctx.clearRect(0, 0, w, h);
      ctx.globalAlpha = 0.2; ctx.drawImage(tex.c, dx, dy, dw, dh); ctx.globalAlpha = 1;
      const still = noHover.matches && mouse.x == null; // sans curseur : point fixe, sans balayage ni pulsation
      const tx = mouse.x ?? (still ? w * 0.7 : w * (0.5 + 0.38 * Math.sin(t * 0.5))), ty = mouse.y ?? (still ? h * 0.42 : h * (0.5 + 0.3 * Math.sin(t * 0.37 + 1))), R = Math.min(Math.max(w, h) * 0.3, 260);
      if (!scratch || scratch.width !== canvas.width || scratch.height !== canvas.height) { scratch = document.createElement("canvas"); scratch.width = canvas.width; scratch.height = canvas.height; }
      const sc = scratch.getContext("2d");
      sc.setTransform(dpr, 0, 0, dpr, 0, 0); sc.globalCompositeOperation = "source-over"; sc.clearRect(0, 0, w, h); sc.drawImage(tex.c, dx, dy, dw, dh);
      sc.globalCompositeOperation = "destination-in"; const g2 = sc.createRadialGradient(tx, ty, R * 0.12, tx, ty, R); g2.addColorStop(0, "rgba(0,0,0,1)"); g2.addColorStop(1, "rgba(0,0,0,0)"); sc.fillStyle = g2; sc.fillRect(0, 0, w, h);
      ctx.drawImage(scratch, 0, 0, w, h);
      const p = still ? 0.35 : (t * 0.9) % 1; ctx.strokeStyle = rgba(color, 0.55 * (1 - p)); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(tx, ty, 6 + p * 44, 0, 7); ctx.stroke();
      ctx.fillStyle = rgba(color, 1); ctx.beginPath(); ctx.arc(tx, ty, 3.2, 0, 7); ctx.fill();
    }

    function frame(now) {
      raf = 0;
      if (!visible) return;
      draw(reduce || idle() ? 4 : (now - t0) / 1000);
      if (!reduce && !idle()) raf = requestAnimationFrame(frame);
    }
    const ro = new ResizeObserver(() => { resize(); if (reduce || idle()) frame(performance.now()); });
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible && !raf) raf = requestAnimationFrame(frame); });
    io.observe(canvas);
    const host = canvas.parentElement;
    host.addEventListener("pointermove", (e) => { const r = canvas.getBoundingClientRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; });
    host.addEventListener("pointerleave", () => {
      mouse.x = mouse.y = null;
      if (o.hover && active) { active = false; tex = scratch = null; if (raf) cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); } // retour au motif fixe, mémoire libérée
    });
    if (o.hover && !reduce && matchMedia("(hover: hover)").matches) {
      host.addEventListener("pointerenter", (e) => { // la souris seulement : sur tactile, le motif reste fixe
        if (e.pointerType !== "mouse") return;
        active = true; if (!raf && visible) raf = requestAnimationFrame(frame);
      });
    }
    resize();
    motif(() => { if (!raf && visible) raf = requestAnimationFrame(frame); });
    raf = requestAnimationFrame(frame);
    // Arrêt définitif (carte retirée de la page) : plus d'observateurs ni de boucle, mémoire libérée.
    return () => { visible = false; if (raf) cancelAnimationFrame(raf); raf = 0; ro.disconnect(); io.disconnect(); tex = scratch = null; };
  }

  window.Anim = { hoplite };
})();
