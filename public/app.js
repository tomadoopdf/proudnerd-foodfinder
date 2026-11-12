// ProudNerdFoodfinder – Browser-Logik
(() => {
  const $ = (s) => document.querySelector(s);
  const store = {
    get(k, d) { try { const v = localStorage.getItem("pnff." + k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem("pnff." + k, JSON.stringify(v)); } catch {} },
  };

  // ---------- Zustand ----------
  let crew = store.get("crew", [
    { id: 1, name: "Artist", role: "Artist", diet: "vegan", allergies: "", likes: "", dislikes: "", active: true },
    { id: 2, name: "Crew", role: "Crew", diet: "", allergies: "", likes: "", dislikes: "", active: true },
  ]);
  let teamCode = store.get("teamCode", "");
  let history = [];      // [{role, text}] für Folgefragen
  let location = null;   // {lat, lon, accuracy, city, ..., mode}
  let mode = store.get("locMode", "live");
  let fixedLocation = store.get("fixedLocation", null);
  let busy = false;
  let lastGeoAt = 0, lastGeoPos = null, watchId = null;
  let config = { needsCode: false, demo: false };

  const headers = () => ({ "Content-Type": "application/json", ...(teamCode ? { "X-Team-Code": teamCode } : {}) });

  // ---------- Standort ----------
  function setLocUI(state, text) {
    $("#locDot").dataset.state = state;
    $("#locText").textContent = text;
  }
  function renderLocMeta() {
    const l = mode === "fixed" ? fixedLocation : location;
    const dl = $("#locMeta");
    dl.innerHTML = "";
    if (!l) return;
    const rows = [
      ["Adresse", l.label || "–"],
      ["Stadt", [l.city, (l.country_code || "").toUpperCase()].filter(Boolean).join(", ") || "–"],
      ["Koordinaten", l.lat != null ? `${l.lat.toFixed(5)}, ${l.lon.toFixed(5)}` : "–"],
    ];
    if (mode === "live" && l.accuracy) rows.push(["Genauigkeit", `± ${Math.round(l.accuracy)} m`]);
    if (l.updated) rows.push(["Stand", new Date(l.updated).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })]);
    for (const [k, v] of rows) {
      const dt = document.createElement("dt"); dt.textContent = k;
      const dd = document.createElement("dd"); dd.textContent = v;
      dl.append(dt, dd);
    }
  }
  function distM(a, b) {
    const R = 6371e3, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  async function onPosition(pos) {
    const p = { lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy };
    location = { ...(location || {}), ...p, mode: "live", updated: Date.now(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
    // Adresse nur neu auflösen, wenn >250 m bewegt oder >5 Min. her
    const moved = !lastGeoPos || distM(lastGeoPos, p) > 250;
    if (moved || Date.now() - lastGeoAt > 5 * 60_000) {
      lastGeoPos = p; lastGeoAt = Date.now();
      try {
        const r = await fetch(`/api/geo?lat=${p.lat}&lon=${p.lon}`, { headers: headers() });
        if (r.ok) Object.assign(location, await r.json());
      } catch {}
    }
    if (mode === "live") setLocUI("live", location.city ? `${location.city}${location.road ? " · " + location.road : ""}` : "Live-Standort");
    renderLocMeta();
  }
  function onPosError(err) {
    if (mode !== "live") return;
    setLocUI("err", err.code === 1 ? "Standort blockiert – Adresse eingeben" : "Kein GPS – Adresse eingeben");
  }
  function startWatch() {
    if (!("geolocation" in navigator)) return onPosError({ code: 2 });
    if (watchId != null) return;
    watchId = navigator.geolocation.watchPosition(onPosition, onPosError, { enableHighAccuracy: true, maximumAge: 30_000, timeout: 20_000 });
  }
  function setMode(m) {
    mode = m; store.set("locMode", m);
    $("#modeLive").setAttribute("aria-checked", String(m === "live"));
    $("#modeFixed").setAttribute("aria-checked", String(m === "fixed"));
    $("#fixedForm").hidden = m !== "fixed";
    $("#liveHint").hidden = m !== "live";
    if (m === "fixed") {
      setLocUI(fixedLocation ? "fixed" : "wait", fixedLocation ? (fixedLocation.short || fixedLocation.city || "Feste Adresse") : "Adresse eingeben");
      if (fixedLocation) $("#fixedAddr").value = fixedLocation.query || "";
    } else if (location) {
      setLocUI("live", location.city || "Live-Standort");
    } else setLocUI("wait", "Standort wird gesucht …");
    renderLocMeta();
  }
  $("#modeLive").onclick = () => setMode("live");
  $("#modeFixed").onclick = () => setMode("fixed");
  $("#fixedForm").onsubmit = async (e) => {
    e.preventDefault();
    const q = $("#fixedAddr").value.trim();
    if (!q) return;
    setLocUI("wait", "Suche Adresse …");
    try {
      const r = await fetch(`/api/geo?q=${encodeURIComponent(q)}`, { headers: headers() });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || "Adresse nicht gefunden");
      fixedLocation = { ...j, query: q, short: q.split(",")[0], mode: "fixed", updated: Date.now(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
      store.set("fixedLocation", fixedLocation);
      setMode("fixed");
    } catch (err) {
      setLocUI("err", err.message);
    }
  };
  $("#locBtn").onclick = () => { $("#locPanel").hidden = !$("#locPanel").hidden; };
  document.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => { $("#" + b.dataset.close).hidden = true; renderCrewChips(); }));

  // ---------- Crew / Rider ----------
  function saveCrew() { store.set("crew", crew); renderCrewChips(); }
  function renderCrewChips() {
    const box = $("#crewChips");
    box.innerHTML = "";
    for (const p of crew) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "chip"; b.dataset.role = p.role;
      b.setAttribute("aria-pressed", String(!!p.active));
      const role = document.createElement("span"); role.className = "role"; role.textContent = p.role || "Crew";
      const name = document.createElement("span"); name.className = "name"; name.textContent = p.name || "Ohne Name";
      b.append(role, name);
      if (p.diet) { const d = document.createElement("span"); d.className = "muted"; d.textContent = "· " + p.diet; b.append(d); }
      if (p.allergies) { const w = document.createElement("span"); w.className = "warn"; w.textContent = "⚠ " + p.allergies; b.append(w); }
      b.onclick = () => { p.active = !p.active; saveCrew(); };
      box.append(b);
    }
  }
  function field(p, key, label, placeholder, type = "text") {
    const l = document.createElement("label");
    l.innerHTML = `<span class="lbl"></span>`;
    l.firstChild.textContent = label;
    let input;
    if (type === "select") {
      input = document.createElement("select");
      for (const o of ["Artist", "Band", "Crew", "Management", "Gast"]) { const op = document.createElement("option"); op.textContent = o; input.append(op); }
    } else { input = document.createElement("input"); input.type = "text"; input.placeholder = placeholder || ""; }
    input.id = `p${p.id}-${key}`; l.htmlFor = input.id;
    input.value = p[key] || (type === "select" ? "Crew" : "");
    input.oninput = () => { p[key] = input.value; store.set("crew", crew); };
    l.append(input);
    return l;
  }
  function renderCrewList() {
    const list = $("#crewList");
    list.innerHTML = "";
    for (const p of crew) {
      const box = document.createElement("div"); box.className = "person";
      box.append(
        field(p, "name", "Name"), field(p, "role", "Rolle", "", "select"),
        field(p, "diet", "Ernährung", "vegan, halal, keto …"), field(p, "allergies", "Allergien", "Nüsse, Gluten …"),
        field(p, "likes", "Mag", "Sushi, scharf …"), field(p, "dislikes", "Mag nicht", "Koriander …"),
      );
      const del = document.createElement("button"); del.type = "button"; del.className = "ghost del"; del.textContent = "Entfernen";
      del.onclick = () => { crew = crew.filter((x) => x !== p); saveCrew(); renderCrewList(); };
      box.append(del);
      list.append(box);
    }
  }
  $("#editCrewBtn").onclick = () => { const pnl = $("#crewPanel"); pnl.hidden = !pnl.hidden; if (!pnl.hidden) renderCrewList(); renderCrewChips(); };
  $("#addPersonBtn").onclick = () => { crew.push({ id: Date.now(), name: "", role: "Crew", active: true }); saveCrew(); renderCrewList(); };

  // ---------- Eingabe ----------
  const msg = $("#msg");
  const autoGrow = () => { msg.style.height = "auto"; msg.style.height = Math.min(msg.scrollHeight, innerHeight * 0.4) + "px"; };
  msg.addEventListener("input", () => { autoGrow(); updatePasteInfo(); });
  msg.addEventListener("paste", () => setTimeout(() => { autoGrow(); updatePasteInfo(); }, 0));
  msg.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) $("#composer").requestSubmit(); });
  function findLinks(t) { return [...new Set(t.match(/https?:\/\/[^\s<>"')]+/g) || [])]; }
  function looksPasted(t) { return t.split("\n").length > 3 || /\[\d{1,2}[.:]\d{2}/.test(t) || /^\d{1,2}[.:]\d{2}.*?[-–:]/m.test(t); }
  function updatePasteInfo() {
    const t = msg.value; const links = findLinks(t); const info = $("#pasteInfo");
    if (looksPasted(t) || links.length) {
      info.hidden = false;
      info.textContent = [looksPasted(t) ? "Chatverlauf erkannt" : null, links.length ? `${links.length} Link${links.length > 1 ? "s" : ""} – werden geöffnet und geprüft` : null].filter(Boolean).join(" · ");
    } else info.hidden = true;
  }
  $("#quick").onclick = (e) => {
    const q = e.target.dataset?.q; if (!q) return;
    msg.value = msg.value.trim() ? `${msg.value.trim()}, ${q}` : q; autoGrow(); msg.focus();
  };

  // ---------- Formatierung ----------
  const money = (v, cur = "EUR") => v == null ? "–" : new Intl.NumberFormat("de-DE", { style: "currency", currency: cur || "EUR" }).format(v);
  const stars = (r) => { if (r == null) return ""; const full = Math.round(r); return "★".repeat(full) + "☆".repeat(Math.max(0, 5 - full)); };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const safeUrl = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; } };

  function orderText(o) {
    const lines = [`${o.restaurant} (${o.platform})`];
    for (const it of o.items) lines.push(`${it.qty}× ${it.name}${it.for ? ` – ${it.for}` : ""}${it.price != null ? ` (${money(it.price, o.currency)})` : ""}`);
    lines.push(`Gesamt ca. ${money(o.total, o.currency)}${o.eta_minutes ? ` · ~${o.eta_minutes} Min.` : ""}`);
    const u = safeUrl(o.order_url); if (u) lines.push(u);
    return lines.join("\n");
  }
  async function copy(btn, text) {
    const old = btn.textContent;
    try { await navigator.clipboard.writeText(text); btn.textContent = "Kopiert"; btn.classList.add("copied"); }
    catch { const ta = document.createElement("textarea"); ta.value = text; document.body.append(ta); ta.select(); try { document.execCommand("copy"); btn.textContent = "Kopiert"; } catch { btn.textContent = "Kopieren ging nicht"; } ta.remove(); }
    setTimeout(() => { btn.textContent = old; btn.classList.remove("copied"); }, 1800);
  }

  function renderOption(o, people, isBest) {
    const node = $("#optTpl").content.firstElementChild.cloneNode(true);
    if (isBest) node.classList.add("best");
    const tags = node.querySelector(".tags");
    for (const t of o.tags || []) {
      const s = el("span", "tag", t);
      if (/beste/i.test(t)) s.classList.add("best");
      if (/günstig/i.test(t)) s.classList.add("cheap");
      tags.append(s);
    }
    node.querySelector(".name").textContent = o.restaurant;
    node.querySelector(".sub").textContent = [o.platform, o.cuisine].filter(Boolean).join(" · ");
    node.querySelector(".total").textContent = money(o.total, o.currency);
    const n = o.serves || people; if (o.total != null && n > 1) node.querySelector(".pp").textContent = `${money(o.total / n, o.currency)} p. P. (${n})`;
    const facts = node.querySelector(".facts");
    const addFact = (k, v, cls) => { if (v == null || v === "") return; const d = el("div"); const dt = el("dt", null, k); const dd = el("dd", cls, v); d.append(dt, dd); facts.append(d); };
    if (o.rating != null) {
      const d = el("div"); const dt = el("dt", null, "Bewertung"); const dd = el("dd");
      dd.append(el("span", "stars", stars(o.rating)), document.createTextNode(` ${o.rating.toFixed(1)}${o.rating_count ? ` (${o.rating_count.toLocaleString("de-DE")})` : ""}`));
      d.append(dt, dd); facts.append(d);
    } else addFact("Bewertung", "unbekannt");
    addFact("Lieferzeit", o.eta_minutes ? `~${o.eta_minutes} Min.` : "unbekannt");
    const conf = el("span", "conf" + (o.price_confidence !== "belegt" ? " est" : ""), `Preise ${o.price_confidence}`);
    facts.append(conf);

    const tb = node.querySelector(".items tbody");
    for (const it of o.items || []) {
      const tr = el("tr");
      tr.append(el("td", "q", `${it.qty}×`), el("td", null, it.name), el("td", "f", it.for || ""), el("td", "p", it.price != null ? money(it.price * it.qty, o.currency) : "–"));
      tb.append(tr);
    }
    const fees = node.querySelector(".fees");
    fees.append(el("span", null, `Waren ${money(o.subtotal, o.currency)}`), el("span", null, `Lieferung ${money(o.delivery_fee, o.currency)}`), el("span", null, `Service ${money(o.service_fee, o.currency)}`));

    if (o.also_on?.length) {
      const also = node.querySelector(".also"); also.hidden = false;
      also.append(el("span", null, "Auch auf:"));
      for (const a of o.also_on) {
        const u = safeUrl(a.url);
        const x = u ? Object.assign(el("a", null, `${a.platform} ${money(a.total, o.currency)}`), { href: u, target: "_blank", rel: "noopener" }) : el("span", "p", `${a.platform} ${money(a.total, o.currency)}`);
        also.append(x);
      }
    }
    node.querySelector(".notes").textContent = o.notes || "";

    const actions = node.querySelector(".actions");
    const u = safeUrl(o.order_url);
    if (u) {
      const a = Object.assign(el("a", "btn", `In ${o.platform} öffnen & bestellen`), { href: u, target: "_blank", rel: "noopener" });
      actions.append(a);
    }
    const c = el("button", "sec", "Warenkorb-Liste kopieren"); c.type = "button";
    c.onclick = () => copy(c, orderText(o));
    actions.append(c);
    return node;
  }

  function renderResult(container, out) {
    const r = out.result;
    if (!r) {
      if (out.text) container.append(el("div", "agent-text", out.text));
      return;
    }
    const sum = el("div", "summary");
    sum.append(el("p", null, r.summary));
    if (r.assumptions?.length) {
      const ul = el("ul"); for (const a of r.assumptions) ul.append(el("li", null, a)); sum.append(ul);
    }
    container.append(sum);
    r.options.forEach((o, i) => container.append(renderOption(o, r.people_count || 1, i === 0)));
    const share = el("button", "sec", "Alle Optionen für den Gruppenchat kopieren"); share.type = "button";
    share.className = "ghost";
    share.onclick = () => copy(share, [r.summary, "", ...r.options.map((o, i) => `${i + 1}) ${orderText(o)}`)].join("\n\n"));
    container.append(share);
  }

  // ---------- Suche ----------
  function addUserBubble(text) {
    const b = el("div", "msg-user" + (looksPasted(text) ? " pasted" : ""), text);
    $("#feed").append(b);
    return b;
  }

  async function search(text) {
    if (busy) return;
    if (config.needsCode && !teamCode) { $("#codePanel").hidden = false; $("#codeInput").focus(); return; }
    busy = true; $("#sendBtn").disabled = true;
    document.querySelectorAll(".example").forEach((n) => n.remove());

    addUserBubble(text);
    const box = el("div", "agent"); $("#feed").append(box);
    const prog = el("div", "progress");
    const working = el("div", "working"); working.append(el("span", "spin"), el("span", null, "Suche läuft …"));
    const ul = el("ul");
    prog.append(working, ul); box.append(prog);
    box.scrollIntoView({ behavior: "smooth", block: "start" });

    const loc = mode === "fixed" ? fixedLocation : location;
    const body = {
      message: text, history, location: loc, profiles: crew,
      deadline: $("#deadline").value || null,
      budget: $("#budget").value ? `${$("#budget").value} €` : null,
    };

    try {
      const res = await fetch("/api/search", { method: "POST", headers: headers(), body: JSON.stringify(body) });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        if (res.status === 401) { teamCode = ""; store.set("teamCode", ""); $("#codePanel").hidden = false; }
        throw new Error(j.error || `Fehler ${res.status}`);
      }
      const reader = res.body.getReader(); const dec = new TextDecoder();
      let buf = "", out = null;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = /^event: (.*)$/m.exec(chunk)?.[1];
          const data = /^data: (.*)$/m.exec(chunk)?.[1];
          if (!ev || !data) continue;
          const d = JSON.parse(data);
          if (ev === "status") {
            const li = el("li"); li.append(el("span", "k", d.kind === "fetch" ? "öffnet" : "sucht"), el("span", "t", d.text || ""));
            ul.append(li);
          } else if (ev === "done") out = d;
          else if (ev === "error") throw new Error(d.error);
        }
      }
      working.remove();
      if (ul.children.length) {
        const n = ul.children.length;
        const details = el("details"); const s = el("summary", null, `${n} Quellen geprüft`); details.append(s, ul); prog.append(details);
      }
      if (!out) throw new Error("Keine Antwort erhalten.");
      renderResult(box, out);
      history.push({ role: "user", text });
      const assistantText = out.result
        ? `${out.result.summary}\nOptionen: ${out.result.options.map((o) => `${o.restaurant} (${o.platform}, ${money(o.total, o.currency)})`).join("; ")}`
        : out.text;
      history.push({ role: "assistant", text: assistantText });
    } catch (err) {
      working.remove();
      box.append(el("div", "error", err.message || "Etwas ist schiefgelaufen."));
    } finally {
      busy = false; $("#sendBtn").disabled = false;
    }
  }

  $("#composer").onsubmit = (e) => {
    e.preventDefault();
    const t = msg.value.trim(); if (!t) return;
    msg.value = ""; autoGrow(); $("#pasteInfo").hidden = true;
    search(t);
  };
  $("#codeForm").onsubmit = (e) => {
    e.preventDefault(); teamCode = $("#codeInput").value.trim(); store.set("teamCode", teamCode); $("#codePanel").hidden = true;
  };

  // ---------- Beispiel beim ersten Öffnen ----------
  function renderExample() {
    const feed = $("#feed");
    const flag = el("div", "example-flag example", "Beispiel – so sieht ein Ergebnis aus");
    const u = el("div", "msg-user pasted example", "[18:02] Tourmanager: Artist will vegan, Bowl o.ä., bis 19:15 im Backstage\n[18:03] Stage: Crew 6 Leute, Pizza passt\n[18:03] Stage: https://www.lieferando.de/…");
    const box = el("div", "agent example");
    renderResult(box, {
      result: {
        summary: "Beispieldaten. Empfehlung: Bowls über Wolt für den Artist (schnellste Lieferung, 4,7★), Pizza für die Crew über Lieferando (günstigste pro Person).",
        assumptions: ["Lieferung an aktuellen Standort", "Crew: 6 Personen, keine Allergien angegeben"],
        people_count: 8,
        options: [
          { restaurant: "Green Bowl Kitchen", platform: "Wolt", order_url: null, cuisine: "Bowls · vegan", serves: 2, rating: 4.7, rating_count: 1240, eta_minutes: 30,
            items: [{ name: "Tofu Teriyaki Bowl", qty: 2, price: 13.9, for: "Artist" }, { name: "Edamame", qty: 1, price: 4.5, for: "Artist" }],
            subtotal: 32.3, delivery_fee: 1.99, service_fee: 0.99, total: 35.28, currency: "EUR", price_confidence: "belegt",
            tags: ["Beste Wahl", "Schnellste", "vegan ok"], notes: "Auf Uber Eats 3,12 € teurer wegen höherer Servicegebühr.", also_on: [{ platform: "Uber Eats", total: 38.4, url: null }] },
          { restaurant: "Pizzeria Due Fratelli", platform: "Lieferando", order_url: null, cuisine: "Pizza", serves: 6, rating: 4.5, rating_count: 3800, eta_minutes: 45,
            items: [{ name: "Pizza Margherita", qty: 3, price: 9.5, for: "Crew" }, { name: "Pizza Diavola", qty: 3, price: 11.5, for: "Crew" }],
            subtotal: 63, delivery_fee: 0, service_fee: 0.99, total: 63.99, currency: "EUR", price_confidence: "teilweise geschätzt",
            tags: ["Günstigste p. P."], notes: "Ab 50 € liefert der Laden kostenlos.", also_on: [] },
        ],
      },
    });
    feed.append(flag, u, box);
  }

  // ---------- Start ----------
  (async () => {
    try { config = await (await fetch("/api/config")).json(); } catch {}
    if (config.needsCode && !teamCode) $("#codePanel").hidden = false;
    renderCrewChips();
    renderExample();
    setMode(mode);
    startWatch();
  })();
})();
