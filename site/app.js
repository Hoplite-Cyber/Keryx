// PQC Watch : veille post-quantique. Données : data/articles.json (généré par scripts/collect.py).
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  // Images d'articles masquées par défaut (droits des éditeurs à clarifier) ; ?images=1 les affiche.
  const SHOW_IMAGES = new URLSearchParams(location.search).get("images") === "1";

  // Sujets et couleurs de la charte. bg/fg : bloc plein ; line : trait ; text : texte lisible sur fond clair.
  const THEMES = [
    { id: "PQC", bg: "#143954", fg: "#f6f6f6", line: "#143954", text: "#143954", curve: "#143954" },
    { id: "QKD", bg: "#ca814d", fg: "#0f2436", line: "#ca814d", text: "#9a5c2c", curve: "#ca814d" },
    { id: "Menace quantique", bg: "#0f2436", fg: "#f6f6f6", line: "#0f2436", text: "#0f2436", curve: "#0f2436" },
    { id: "Normes & politiques", bg: "#e6b794", fg: "#0f2436", line: "#e6b794", text: "#7d6240", curve: "#d9a982" },
    { id: "Ordinateurs quantiques", bg: "#2f7f7a", fg: "#f6f6f6", line: "#2f7f7a", text: "#2a6f6a", curve: "#2f9a92" },
  ];
  const OTHER = { id: "Général", bg: "#dfe5ea", fg: "#0f2436", line: "#aab6c2", text: "#5c6f80", curve: "#aab6c2" };
  const SHORT = { "Menace quantique": "Menace", "Normes & politiques": "Normes", "Ordinateurs quantiques": "Ordinateurs" };
  const CATEGORY = {
    "Officiel": ["#0f2436", "#f6f6f6"], "Recherche": ["#143954", "#f6f6f6"], "Industrie": ["#ca814d", "#0f2436"],
    "Presse spécialisée": ["#e6b794", "#0f2436"], "Actualité cyber": ["#cfd8e0", "#0f2436"],
  };
  const catColors = (c) => CATEGORY[c] || ["#cfd8e0", "#0f2436"];

  const DAY_MS = 86400000;
  const dayFormat = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });
  const longDay = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const fmt = (iso) => dayFormat.format(new Date(iso));
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayDiff = (iso, now = new Date()) => Math.max(0, Math.round((startOfDay(now) - startOfDay(new Date(iso))) / DAY_MS));
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const safeUrl = (u) => (/^https?:\/\//i.test(u) ? u : "#"); // seuls les liens http(s) sont cliquables
  const link = (a, inner) => `<a href="${esc(safeUrl(a.url))}" target="_blank" rel="noopener noreferrer">${inner}</a>`;

  const state = { articles: [], sources: [], generatedAt: null, view: "une", theme: "all", shown: 15, query: "", day: "" };
  const primary = (a) => a.themes.map((id) => THEMES.find((t) => t.id === id)).find(Boolean) || OTHER;
  const imageOf = (a) => (SHOW_IMAGES && a.image && /^https?:\/\//i.test(a.image) ? a.image : null);

  // Nombre d'articles par jour pour un sujet : tableau de `days` valeurs, du plus ancien à aujourd'hui.
  function buckets(themeId, days) {
    const out = new Array(days).fill(0);
    for (const a of state.articles) {
      if (themeId && !a.themes.includes(themeId)) continue;
      const d = dayDiff(a.date);
      if (d < days) out[days - 1 - d]++;
    }
    return out;
  }
  const count7 = (id) => buckets(id, 7).reduce((s, n) => s + n, 0);

  /* ---------- Cartes ---------- */
  // Image d'article si elle existe, sinon carte simple (ou bloc plein pour les grandes tuiles).
  function card(a, cls = "") {
    const t = primary(a), img = imageOf(a), solid = cls.includes("solid");
    const kind = img ? "has-img" : solid ? "" : "plain";
    const style = solid ? `--bg:${t.bg};--fg:${t.fg}` : `--tx:${t.text}`;
    const media = img ? `<img class="media" src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : "";
    return `<a class="card ${cls} ${kind}" style="${style}" href="${esc(safeUrl(a.url))}" target="_blank" rel="noopener noreferrer">${media}<div class="in"><div><p class="meta">${esc(a.source)} · ${fmt(a.date)}</p><h3>${esc(a.title)}</h3></div><p class="tl">${esc(t.id)}</p></div></a>`;
  }
  // Si une image ne charge pas, la carte retombe sur son apparence simple.
  document.addEventListener("error", (e) => {
    const img = e.target;
    if (img.tagName !== "IMG" || !img.classList.contains("media")) return;
    const c = img.closest(".card");
    img.remove();
    if (c) { c.classList.remove("has-img"); c.classList.add("plain"); }
  }, true);

  function addMotif(host) {
    const c = document.createElement("canvas");
    c.className = "fx"; c.setAttribute("aria-hidden", "true");
    host.prepend(c);
    window.Anim.hoplite(c);
  }

  // Motif fixe sur les cartes pleines et les tuiles de sources ; l'animation ne démarre qu'au survol (souris).
  const fxStops = new Map(); // conteneur -> fonctions d'arrêt des motifs de la précédente génération
  function cardFx(root) {
    (fxStops.get(root) || []).forEach((stop) => stop()); // les anciennes cartes ont été remplacées : on libère leurs motifs
    const stops = [];
    root.querySelectorAll(".card.solid, .tile:not(.empty)").forEach((el) => {
      const c = document.createElement("canvas");
      c.className = "fx"; c.setAttribute("aria-hidden", "true");
      el.prepend(c);
      const stop = window.Anim.hoplite(c, { hover: true, scale: 0.3 });
      if (stop) stops.push(stop);
    });
    fxStops.set(root, stops);
  }

  /* ---------- Pouls de la semaine : courbes sur quatorze jours, étiquettes au bout des lignes ---------- */
  const isDark = () => document.documentElement.dataset.theme === "dark";
  const CURVE_DARK = { "PQC": "#7fb4de", "QKD": "#ca814d", "Menace quantique": "#e8eef3", "Normes & politiques": "#e6b794", "Ordinateurs quantiques": "#6fd0c6" };
  function renderPouls() {
    const dark = isDark(), cv = (t) => (dark ? CURVE_DARK[t.id] : t.curve), lbl = (t) => (dark ? CURVE_DARK[t.id] : t.text);
    const gridC = dark ? "#26394b" : "#dde3e9", numC = dark ? "#7f93a6" : "#8a96a3", axisC = dark ? "#9fb0c0" : "#5c6f80";
    const data = THEMES.map((t) => ({ t, d: buckets(t.id, 14), n: count7(t.id) })).sort((a, b) => b.n - a.n);
    const W = 380, H = 190, L = 6, R = 104, T = 10, B = 24, max = Math.max(1, ...data.flatMap((r) => r.d));
    const x = (i) => L + (W - L - R) * i / 13, y = (n) => T + (H - T - B) * (1 - n / max);
    const grid = [0, 1, 2, 3].map((k) => { const v = max * k / 3; return `<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="${gridC}"/><text x="${W - R + 6}" y="${(y(v) + 4).toFixed(1)}" fill="${numC}" font-size="10">${Math.round(v)}</text>`; }).join("");
    const lines = data.map((r) => `<polyline fill="none" stroke="${cv(r.t)}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" points="${r.d.map((n, i) => `${x(i).toFixed(1)},${y(n).toFixed(1)}`).join(" ")}"/>`).join("");
    const labels = data.map((r) => ({ r, y: y(r.d[13]) })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 15) labels[i].y = labels[i - 1].y + 15; // évite le chevauchement des noms
    const names = labels.map(({ r, y: yy }) => `<circle cx="${x(13).toFixed(1)}" cy="${y(r.d[13]).toFixed(1)}" r="3.2" fill="${cv(r.t)}"/><text x="${W - R + 26}" y="${(yy + 4).toFixed(1)}" fill="${lbl(r.t)}" font-size="12" font-weight="600">${esc(SHORT[r.t.id] || r.t.id)}</text>`).join("");
    const summary = data.map((r) => `${r.t.id} : ${r.n} articles sur 7 jours`).join(" ; ");
    const dayOf = (i) => new Date(Date.now() - (13 - i) * DAY_MS);
    const ticks = [0, 3, 6, 9].map((i) => `<text x="${x(i).toFixed(1)}" y="${H - 6}" fill="${axisC}" font-size="10.5"${i === 0 ? "" : ' text-anchor="middle"'}>${dayFormat.format(dayOf(i))}</text>`).join("");
    $("pouls").innerHTML = `<h2 class="pv-t">L'activité sur quatorze jours</h2><div class="pd-wrap"><svg class="pd" viewBox="0 0 ${W} ${H}" role="img" aria-label="Courbes d'activité par sujet. ${esc(summary)}">${grid}${lines}${names}${ticks}<text x="${x(13)}" y="${H - 6}" fill="${axisC}" font-size="10.5" text-anchor="end">aujourd'hui</text><line class="pd-guide" y1="${T}" y2="${H - B}" stroke="${numC}" stroke-dasharray="3 3" visibility="hidden"/><rect class="pd-hit" x="0" y="0" width="${W - R + 6}" height="${H}" fill="transparent"/></svg><div class="pd-tip" hidden></div></div>`;

    const wrap = $("pouls").querySelector(".pd-wrap"), svg = wrap.querySelector("svg"), guide = svg.querySelector(".pd-guide"), tip = wrap.querySelector(".pd-tip");
    let cur = 13;
    const dayWord = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short" });
    const show = (ev) => {
      const box = svg.getBoundingClientRect();
      cur = Math.max(0, Math.min(13, Math.round(((ev.clientX - box.left) / box.width * W - L) / ((W - L - R) / 13))));
      const gx = x(cur).toFixed(1), n = state.articles.filter((a) => dayDiff(a.date) === 13 - cur).length;
      guide.setAttribute("x1", gx); guide.setAttribute("x2", gx); guide.setAttribute("visibility", "visible");
      tip.textContent = `${dayWord.format(dayOf(cur))} · ${n}`;
      tip.hidden = false;
      const left = (gx / W) * box.width, tw = tip.offsetWidth;
      tip.style.left = Math.max(0, Math.min(box.width - tw, left + 8 + tw > box.width ? left - tw - 8 : left + 8)) + "px";
    };
    const hide = () => { tip.hidden = true; guide.setAttribute("visibility", "hidden"); };
    svg.addEventListener("pointermove", show);
    svg.addEventListener("pointerdown", show);
    svg.addEventListener("pointerleave", hide);
    svg.addEventListener("click", () => openDay(dayOf(cur)));
  }

  /* ---------- À la une ---------- */
  function renderUne() {
    const arts = state.articles;
    $("date").textContent = longDay.format(new Date());
    $("upd").textContent = state.generatedAt ? "Mis à jour à " + new Date(state.generatedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "";
    if (!arts.length) { $("lead").outerHTML = `<p class="empty">Aucun article pour l'instant.</p>`; return; }

    const score = (a) => (a.summary ? 1 : 0) + a.themes.length * 0.1 + (imageOf(a) ? 0.6 : 0);
    const lead = arts.slice(0, 30).sort((a, b) => score(b) - score(a))[0];
    const rest = arts.filter((a) => a.id !== lead.id);
    const lt = primary(lead), L = $("lead");
    L.href = safeUrl(lead.url); L.target = "_blank"; L.rel = "noopener noreferrer";
    L.style.setProperty("--bg", lt.bg); L.style.setProperty("--fg", lt.fg);
    if (imageOf(lead)) L.style.backgroundImage = `linear-gradient(180deg, ${lt.bg}d9, ${lt.bg}f2), url("${imageOf(lead).replace(/"/g, "%22")}")`;
    L.innerHTML = `<div><p class="kicker">À la une · ${esc(lt.id)}</p><h1>${esc(lead.title)}</h1>${lead.summary ? `<p class="sum">${esc(lead.summary)}</p>` : ""}</div><p class="by">${esc(lead.source)} · ${fmt(lead.date)}</p>`;
    addMotif(L);

    $("minis").innerHTML = rest.slice(0, 6).map((a) => card(a)).join("");
    renderPouls();
    $("brief").innerHTML = `<h2>En bref</h2>` + rest.slice(6, 11).map((a) => `<a href="${esc(safeUrl(a.url))}" target="_blank" rel="noopener noreferrer"><span class="t">${esc(a.title)}</span><small>${esc(a.source)} · ${fmt(a.date)}</small></a>`).join("");

    const byCat = arts.reduce((m, a) => ((m[a.category] = (m[a.category] || 0) + 1), m), {});
    const cats = Object.entries(byCat).sort((x, y) => y[1] - x[1]).slice(0, 3);
    $("sections").innerHTML = cats.map(([c, n]) => {
      const col = catColors(c)[0];
      return `<section class="sect" style="--c:${col === "#cfd8e0" ? "#8a96a3" : col}"><h2>${esc(c)}<span>${plural(n, "article", "articles")}</span></h2>${arts.filter((a) => a.category === c).slice(0, 4).map((a) => link(a, `<p class="small">${esc(a.source)} · ${fmt(a.date)}</p><h3>${esc(a.title)}</h3>`)).join("")}</section>`;
    }).join("");
  }

  /* ---------- Toute l'actu ---------- */
  function renderActu() {
    const sources = sourcesList();
    const fsrc = $("fsrc"), current = fsrc.value || "all";
    if (!fsrc.dataset.ready) {
      fsrc.innerHTML = `<option value="all">Toutes les sources</option>` + [...new Set(sources.map((s) => s.category))].map((c) =>
        `<optgroup label="${esc(c)}">${sources.filter((s) => s.category === c).map((s) => `<option value="${esc(s.name)}">${esc(s.name)} (${s.items.length})</option>`).join("")}</optgroup>`).join("");
      fsrc.value = current; fsrc.dataset.ready = "1";
    }
    $("tabs").innerHTML = [["all", "Tout"], ...THEMES.map((t) => [t.id, t.id])].map(([id, label]) => `<button class="tab" data-id="${esc(id)}" aria-pressed="${state.theme === id}">${esc(label)}</button>`).join("");
    $("fday").value = state.day; $("fday-x").hidden = !state.day; $("fper").disabled = !!state.day;
    const src = fsrc.value, per = $("fper").value, lang = $("flang").value, now = new Date(), q = state.query;
    const list = state.articles.filter((a) =>
      (state.theme === "all" || a.themes.includes(state.theme)) && (src === "all" || a.source === src) &&
      (state.day ? ymd(new Date(a.date)) === state.day : (per === "all" || dayDiff(a.date, now) < Number(per))) && (lang === "all" || (a.lang || "en") === lang) &&
      (!q || `${a.title} ${a.summary} ${a.source}`.toLowerCase().includes(q)));
    $("count").textContent = plural(list.length, "article", "articles");
    const frHint = lang === "fr" ? " La presse française parle encore peu du sujet : les articles en français arriveront au fil de la collecte." : "";
    $("grid").innerHTML = list.length
      ? list.slice(0, state.shown).map((a, i) => card(a, i === 0 ? "lead2 solid" : i % 6 === 3 ? "wide solid" : "")).join("")
      : `<p class="empty">Aucun article ne correspond à ces filtres.${frHint}</p>`;
    cardFx($("grid"));
    $("more").parentElement.hidden = list.length <= state.shown;
  }

  /* ---------- Sources ---------- */
  function sourcesList() {
    const map = new Map();
    for (const r of state.sources) map.set(r.name, { name: r.name, ok: r.ok, category: r.category || "Autre", items: [] });
    for (const a of state.articles) {
      if (!map.has(a.source)) map.set(a.source, { name: a.source, ok: true, category: a.category, items: [] });
      map.get(a.source).items.push(a);
    }
    return [...map.values()].sort((x, y) => y.items.length - x.items.length || x.name.localeCompare(y.name));
  }
  let shownSources = [];
  function renderSources() {
    shownSources = sourcesList();
    $("tiles").innerHTML = shownSources.map((s, i) => {
      const [bg, fg] = catColors(s.category), n = s.items.length;
      return `<button type="button" class="tile ${n ? "" : "empty"}" style="--bg:${bg};--fg:${fg}" data-i="${i}"><div class="top"><div><h3>${esc(s.name)} ${s.ok ? "" : '<span class="err">erreur</span>'}</h3><p class="cat">${esc(s.category)}</p></div><span class="num">${n}</span></div><p class="latest">${n ? esc(s.items[0].title) : "Aucun article retenu pour le moment"}</p></button>`;
    }).join("");
    cardFx($("tiles"));
  }
  const panel = $("panel"), scrim = $("scrim");
  const closePanel = () => { panel.classList.remove("open"); scrim.classList.remove("open"); };
  function openPanel(s) {
    const [bg, fg] = catColors(s.category);
    panel.style.setProperty("--bg", bg); panel.style.setProperty("--fg", fg);
    panel.innerHTML = `<header><div><h2>${esc(s.name)}</h2><p>${esc(s.category)} · ${plural(s.items.length, "article", "articles")}</p></div><button class="x" type="button" aria-label="Fermer">×</button></header><ul>${s.items.length ? s.items.map((a) => `<li><span class="d">${fmt(a.date)}</span>${link(a, esc(a.title))}</li>`).join("") : '<li class="d">Aucun article retenu.</li>'}</ul>`;
    panel.classList.add("open"); scrim.classList.add("open");
    panel.querySelector(".x").focus();
  }

  // Fenêtre latérale : les articles d'un jour choisi sur la courbe d'activité.
  function openDay(date) {
    const key = ymd(date), items = state.articles.filter((a) => ymd(new Date(a.date)) === key);
    panel.style.setProperty("--bg", "#0f2436"); panel.style.setProperty("--fg", "#f6f6f6");
    const title = longDay.format(date);
    panel.innerHTML = `<header><div><h2 class="cap">${esc(title)}</h2><p>${plural(items.length, "article", "articles")}</p></div><button class="x" type="button" aria-label="Fermer">×</button></header><ul>${items.length ? items.map((a) => `<li><span class="d">${esc(a.source)} · ${esc(primary(a).id)}</span>${link(a, esc(a.title))}</li>`).join("") : '<li class="d">Aucun article ce jour-là.</li>'}</ul>${items.length ? `<footer><button class="cta-day" type="button">Voir dans « Toute l'actu »</button></footer>` : ""}`;
    panel.querySelector(".cta-day")?.addEventListener("click", () => { state.day = key; state.theme = "all"; state.shown = 15; closePanel(); show("actu"); window.scrollTo(0, 0); });
    panel.classList.add("open"); scrim.classList.add("open");
    panel.querySelector(".x").focus();
  }

  /* ---------- Briefing : six articles à retenir, un par écran ---------- */
  const brief = { picks: [], i: 0 };
  function buildBrief() {
    const score = (a) => (a.summary ? 2 : 0) + a.themes.length + (dayDiff(a.date) <= 1 ? 1 : 0) + (imageOf(a) ? 1.5 : 0);
    const pool = state.articles.filter((a) => dayDiff(a.date) <= 3).sort((a, b) => score(b) - score(a));
    const picks = [], bySource = {}, byTheme = {};
    for (const strict of [true, false]) for (const a of pool) { // d'abord de la variété (2 par source et par sujet), puis on complète
      if (picks.length >= 6 || picks.includes(a)) continue;
      const t = primary(a).id;
      if (strict && ((bySource[a.source] || 0) >= 2 || (byTheme[t] || 0) >= 2)) continue;
      picks.push(a); bySource[a.source] = (bySource[a.source] || 0) + 1; byTheme[t] = (byTheme[t] || 0) + 1;
    }
    brief.picks = picks;
  }
  function renderBrief() {
    const { picks } = brief, total = picks.length + 1, stage = $("b-stage");
    const day = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long" }).format(new Date());
    const pad = (n) => String(n).padStart(2, "0");
    if (brief.i < picks.length) {
      const a = picks[brief.i], t = primary(a), img = imageOf(a);
      stage.style.setProperty("--bg", t.bg); stage.style.setProperty("--fg", t.fg); stage.classList.toggle("hasimg", !!img);
      $("b-giant").textContent = pad(brief.i + 1);
      $("b-slide").innerHTML = `<div class="bcols ${img ? "img" : ""}"><div><div class="eyebrow"><span>Briefing du ${esc(day)}</span><span>${pad(brief.i + 1)} / ${pad(picks.length)}</span><span>${esc(t.id)}</span></div>
        <h1>${esc(a.title)}</h1>${a.summary ? `<p class="sum">${esc(a.summary)}</p>` : ""}<p class="by">${esc(a.source)} · ${fmt(a.date)}</p>
        <a class="cta" href="${esc(safeUrl(a.url))}" target="_blank" rel="noopener noreferrer">Lire l'article <span aria-hidden="true">↗</span></a></div>${img ? `<figure class="bimg"><img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer"></figure>` : ""}</div>`;
    } else {
      stage.style.setProperty("--bg", "#0f2436"); stage.style.setProperty("--fg", "#f6f6f6"); stage.classList.remove("hasimg");
      $("b-giant").textContent = "✓";
      $("b-slide").innerHTML = `<div class="end"><div class="eyebrow"><span>Briefing du ${esc(day)}</span><span>Terminé</span></div><h1>C'est tout pour aujourd'hui.</h1>
        <div class="facts"><div><b>${state.articles.filter((a) => dayDiff(a.date) === 0).length}</b><span>articles aujourd'hui</span></div><div><b>${count7("PQC")}</b><span>sur la PQC cette semaine</span></div><div><b>${count7("QKD")}</b><span>sur la QKD cette semaine</span></div></div>
        <div class="ctas"><button class="cta" type="button" data-go="actu">Toute l'actu →</button><button class="cta" type="button" data-go="une">← Revenir à la une</button></div></div>`;
    }
    $("b-segs").innerHTML = Array.from({ length: total }, (_, k) => `<button class="seg ${k < brief.i ? "done" : ""} ${k === brief.i ? "cur" : ""}" data-k="${k}" aria-label="Aller à ${k + 1}"></button>`).join("");
    $("b-prev").disabled = brief.i === 0; $("b-next").disabled = brief.i === total - 1;
  }
  const goBrief = (k) => { brief.i = Math.max(0, Math.min(brief.picks.length, k)); renderBrief(); };

  /* ---------- Navigation entre vues ---------- */
  const VIEWS = ["une", "briefing", "actu", "sources"];
  function show(view) {
    state.view = view;
    document.querySelectorAll(".view").forEach((v) => { v.hidden = v.id !== "v-" + view; });
    document.querySelectorAll(".vtab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === view)));
    history.replaceState(null, "", "#" + view);
    if (view === "actu") renderActu();
    if (view === "briefing") { renderBrief(); window.scrollTo(0, document.querySelector(".views").offsetTop); } // le briefing occupe tout l'écran sous la barre des vues
  }

  function bindTheme() {
    const btn = $("theme"), sync = () => btn.setAttribute("aria-pressed", String(isDark()));
    sync();
    btn.addEventListener("click", () => {
      const dark = !isDark();
      if (dark) document.documentElement.dataset.theme = "dark"; else delete document.documentElement.dataset.theme;
      try { localStorage.setItem("pqc-theme", dark ? "dark" : "light"); } catch (e) { /* stockage indisponible : le choix vaut pour cette visite */ }
      sync();
      if ($("pouls").firstChild) renderPouls();
    });
  }

  function bindEvents() {
    bindTheme();
    document.querySelector(".vtabs").addEventListener("click", (e) => { const b = e.target.closest(".vtab"); if (b) show(b.dataset.view); });
    $("gob").addEventListener("click", () => { brief.i = 0; show("briefing"); });
    $("q").addEventListener("input", () => { state.query = $("q").value.trim().toLowerCase(); state.shown = 15; show("actu"); });

    $("tabs").addEventListener("click", (e) => { const b = e.target.closest(".tab"); if (b) { state.theme = b.dataset.id; state.shown = 15; renderActu(); } });
    $("fsrc").addEventListener("change", () => { state.shown = 15; renderActu(); });
    $("fper").addEventListener("change", () => { state.shown = 15; renderActu(); });
    $("flang").addEventListener("change", () => { state.shown = 15; renderActu(); });
    $("fday").addEventListener("change", () => { state.day = $("fday").value; state.shown = 15; renderActu(); });
    $("fday-x").addEventListener("click", () => { state.day = ""; state.shown = 15; renderActu(); });
    $("more").addEventListener("click", () => { state.shown += 12; renderActu(); });

    $("tiles").addEventListener("click", (e) => { const t = e.target.closest(".tile"); if (t) openPanel(shownSources[t.dataset.i]); });
    scrim.addEventListener("click", closePanel);
    panel.addEventListener("click", (e) => { if (e.target.closest(".x")) closePanel(); });

    $("b-prev").addEventListener("click", () => goBrief(brief.i - 1));
    $("b-next").addEventListener("click", () => goBrief(brief.i + 1));
    $("b-segs").addEventListener("click", (e) => { const b = e.target.closest(".seg"); if (b) goBrief(Number(b.dataset.k)); });
    $("b-slide").addEventListener("click", (e) => { const b = e.target.closest("[data-go]"); if (b) show(b.dataset.go); });
    let startX = null; // balayage au doigt
    $("b-stage").addEventListener("touchstart", (e) => { startX = e.touches[0].clientX; }, { passive: true });
    $("b-stage").addEventListener("touchend", (e) => { if (startX === null) return; const dx = e.changedTouches[0].clientX - startX; if (Math.abs(dx) > 50) goBrief(brief.i + (dx < 0 ? 1 : -1)); startX = null; });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closePanel();
      if (state.view !== "briefing" || /input|textarea|select/i.test(document.activeElement.tagName)) return;
      if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); goBrief(brief.i + 1); } else if (e.key === "ArrowLeft") goBrief(brief.i - 1);
    });
    window.addEventListener("hashchange", () => { const v = location.hash.slice(1); if (VIEWS.includes(v) && v !== state.view) show(v); });
  }

  async function init() {
    bindEvents();
    try {
      const res = await fetch("data/articles.json", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      state.articles = (data.articles || []).slice().sort((a, b) => b.date.localeCompare(a.date));
      state.sources = data.sources || [];
      state.generatedAt = data.generated_at;
      buildBrief();
      addMotif($("b-stage")); // le motif Hoplite anime aussi l'écran du briefing
      renderUne();
      renderSources();
      show(VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "une");
    } catch (err) {
      $("v-une").innerHTML = `<p class="empty">Impossible de charger les données (${esc(err.message)}).</p>`;
    }
  }

  init();
})();
