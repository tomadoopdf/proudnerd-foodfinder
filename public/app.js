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
  let aiKey = store.get("aiKey", "");
  let history = [];      // [{role, text}] für Folgefragen
  let location = null;   // {lat, lon, accuracy, city, ..., mode}
  let mode = store.get("locMode", "live");
  let fixedLocation = store.get("fixedLocation", null);
  let busy = false;
  let lastGeoAt = 0, lastGeoPos = null, watchId = null;

  // ---------- Adresssuche über OpenStreetMap (direkt aus dem Browser) ----------
  const NOMI = "https://nominatim.openstreetmap.org";
  function pickAddr(a) {
    return {
      city: a.city || a.town || a.village || a.municipality || a.county || "",
      region: a.state || "", postcode: a.postcode || "",
      road: [a.road, a.house_number].filter(Boolean).join(" "),
      country_code: (a.country_code || "").toLowerCase(),
    };
  }
  async function reverseGeo(lat, lon) {
    const r = await fetch(`${NOMI}/reverse?format=jsonv2&addressdetails=1&accept-language=de&lat=${lat}&lon=${lon}`);
    if (!r.ok) throw new Error("Adresse nicht abrufbar");
    const j = await r.json(); const o = pickAddr(j.address || {});
    o.label = [o.road, [o.postcode, o.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    return o;
  }
  async function forwardGeo(q) {
    const one = async (qq) => {
      const r = await fetch(`${NOMI}/search?format=jsonv2&addressdetails=1&limit=1&accept-language=de&q=${encodeURIComponent(qq)}`);
      if (!r.ok) throw new Error("Adresssuche nicht erreichbar");
      const [hit] = await r.json(); if (!hit) return null;
      return { lat: +hit.lat, lon: +hit.lon, ...pickAddr(hit.address || {}), label: hit.display_name };
    };
    // Venue-Namen vorne kennt OSM oft nicht – dann ohne ersten Teil erneut
    return (await one(q)) || (q.includes(",") ? await one(q.split(",").slice(1).join(",").trim()) : null);
  }

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
        Object.assign(location, await reverseGeo(p.lat, p.lon));
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
      const j = await forwardGeo(q);
      if (!j) throw new Error("Adresse nicht gefunden");
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

  function renderQuick(box, text, loc) {
    const Q = window.PNFF_QUICK;
    const p = Q.parse(text);
    const sum = el("div", "summary");
    const facts = [];
    if (p.people) facts.push(`${p.people} Personen`);
    if (p.diets.length) facts.push(p.diets.join(", "));
    if (p.cuisines.length) facts.push(p.cuisines.join(", "));
    if (p.deadline || $("#deadline").value) facts.push(`bis ${p.deadline || $("#deadline").value}`);
    if (p.allergies.length) facts.push(`⚠ ohne ${p.allergies.join(", ")}`);
    sum.append(el("p", null, facts.length ? `Erkannt: ${facts.join(" · ")}` : "Erkannt: allgemeine Essensanfrage"));
    if (p.wishes.length) {
      const ul = el("ul");
      for (const w of p.wishes) if (!/^https?:/i.test(w.text)) ul.append(el("li", null, `${w.who}: ${w.text}`));
      if (ul.children.length) sum.append(ul);
    }
    box.append(sum);

    if (p.links.length) {
      const card = el("article", "opt");
      card.append(el("h3", "name", "Links aus dem Chat"));
      const act = el("div", "actions");
      for (const u of p.links) {
        const a = Object.assign(el("a", "btn", `${Q.platformOf(u)} öffnen`), { href: u, target: "_blank", rel: "noopener" });
        act.append(a);
      }
      card.append(act);
      box.append(card);
    }

    Q.buildSearches(p, text, loc, crew).forEach(({ term, links }, idx) => {
      const card = el("article", "opt" + (idx === 0 ? " best" : ""));
      const head = el("div", "opt-title");
      head.append(el("h3", "name", `„${term}“ in allen Lieferdiensten`), el("p", "sub", loc?.city ? `rund um ${[loc.road || loc.short, loc.city].filter(Boolean).join(", ")}` : "Standort fehlt, Suche ohne Ort"));
      card.append(head);
      const act = el("div", "actions");
      links.forEach((l, i) => act.append(Object.assign(el("a", i === 0 ? "btn" : "btn alt", l.name), { href: l.url, target: "_blank", rel: "noopener" })));
      card.append(act);
      box.append(card);
    });
    box.append(el("p", "notes", "Öffnet die Suche direkt auf jeder Plattform; Preise und Sterne dort vergleichen. Automatischer Preis- und Bewertungsvergleich: oben auf „Schnellsuche“ tippen und einen kostenlosen Google-KI-Schlüssel eintragen."));

    const note = [
      `Bestellung${p.deadline ? ` bis ${p.deadline}` : ""}${loc?.label ? ` an ${loc.label}` : ""}`,
      ...(p.wishes.length ? p.wishes.filter((w) => !/^https?:/i.test(w.text)).map((w) => `- ${w.who}: ${w.text}`) : [text]),
      ...(p.allergies.length ? [`ACHTUNG Allergien: ${p.allergies.join(", ")}`] : []),
    ].join("\n");
    const c = el("button", "ghost", "Bestell-Notiz kopieren"); c.type = "button";
    c.onclick = () => copy(c, note);
    box.append(c);
  }

  async function search(text) {
    if (busy) return;
    busy = true; $("#sendBtn").disabled = true;
    document.querySelectorAll(".example").forEach((n) => n.remove());

    addUserBubble(text);
    const box = el("div", "agent"); $("#feed").append(box);
    const loc = mode === "fixed" ? fixedLocation : location;

    if (!aiKey) {
      renderQuick(box, text, loc);
      box.scrollIntoView({ behavior: "smooth", block: "start" });
      busy = false; $("#sendBtn").disabled = false;
      return;
    }

    const working = el("div", "working"); working.append(el("span", "spin"), el("span", null, "KI liest die Nachricht …"));
    box.append(working);
    box.scrollIntoView({ behavior: "smooth", block: "start" });
    try {
      const u = await window.PNFF_AI.understand(aiKey, { message: text, location: loc, profiles: crew, deadline: $("#deadline").value || null });
      working.remove();
      renderUnderstood(box, u, loc, text);
    } catch (err) {
      working.remove();
      box.append(el("div", "error", `${err.message || "Etwas ist schiefgelaufen."} Hier die Schnellsuche ohne KI:`));
      renderQuick(box, text, loc);
    } finally {
      busy = false; $("#sendBtn").disabled = false;
    }
  }

  function renderUnderstood(box, u, loc, rawText) {
    const Q = window.PNFF_QUICK;
    const sum = el("div", "summary");
    const head = [u.summary, u.people_count ? `${u.people_count} Personen` : null, u.deadline ? `bis ${u.deadline}` : null].filter(Boolean).join(" · ");
    sum.append(el("p", null, head || "Bestellliste"));
    if (u.allergies.length) sum.append(el("p", "warn-line", `⚠ Allergien: ${u.allergies.join(", ")}`));
    box.append(sum);

    if (u.orders.length) {
      const card = el("article", "opt");
      card.append(el("h3", "name", "Bestellliste"));
      const tb = el("tbody");
      for (const o of u.orders) {
        const tr = el("tr");
        const extra = [o.diet, o.allergies ? `⚠ ${o.allergies}` : ""].filter(Boolean).join(" · ");
        const w = el("td"); w.append(document.createTextNode(o.wants || "–"));
        if (extra) w.append(el("div", "f", extra));
        tr.append(el("td", "q", `${o.qty}×`), w, el("td", "f", o.who));
        tb.append(tr);
      }
      const table = el("table", "items"); table.append(tb); card.append(table);
      box.append(card);
    }

    if (u.questions.length) {
      const q = el("div", "summary");
      q.append(el("p", null, "Noch klären:"));
      const ul = el("ul"); for (const x of u.questions) ul.append(el("li", null, x)); q.append(ul);
      box.append(q);
    }

    for (const l of u.from_links) {
      const card = el("article", "opt");
      card.append(el("h3", "name", l.shop), el("p", "sub", [l.platform, l.items].filter(Boolean).join(" · ")));
      if (l.url) { const act = el("div", "actions"); act.append(Object.assign(el("a", "btn", `In ${l.platform || "Shop"} öffnen`), { href: l.url, target: "_blank", rel: "noopener" })); card.append(act); }
      box.append(card);
    }
    const linksInText = [...new Set(rawText.match(/https?:\/\/[^\s<>"')]+/g) || [])].filter((x) => !u.from_links.some((l) => l.url === x));
    if (linksInText.length) {
      const card = el("article", "opt"); card.append(el("h3", "name", "Links aus dem Chat"));
      const act = el("div", "actions");
      for (const x of linksInText) act.append(Object.assign(el("a", "btn", `${Q.platformOf(x)} öffnen`), { href: x, target: "_blank", rel: "noopener" }));
      card.append(act); box.append(card);
    }

    const terms = u.searches.length ? u.searches : ["essen"];
    terms.forEach((term, idx) => {
      const card = el("article", "opt" + (idx === 0 ? " best" : ""));
      const h = el("div", "opt-title");
      h.append(el("h3", "name", `„${term}“ in allen Lieferdiensten`), el("p", "sub", loc?.city ? `rund um ${[loc.road || loc.short, loc.city].filter(Boolean).join(", ")}` : "Standort fehlt, Suche ohne Ort"));
      card.append(h);
      const act = el("div", "actions");
      Q.linksFor(term, loc).forEach((l, i) => act.append(Object.assign(el("a", i === 0 ? "btn" : "btn alt", l.name), { href: l.url, target: "_blank", rel: "noopener" })));
      card.append(act); box.append(card);
    });
    box.append(el("p", "notes", "Preise und Sterne vergleicht ihr direkt in den Apps. Die Bestellliste oben kann man 1:1 in den Warenkorb übernehmen."));

    const note = [
      `Bestellung${u.deadline ? ` bis ${u.deadline}` : ""}${loc?.label ? ` an ${loc.label}` : ""}`,
      ...u.orders.map((o) => `- ${o.qty}× ${o.wants} (${o.who})${o.diet ? `, ${o.diet}` : ""}${o.allergies ? `, ALLERGIE ${o.allergies}` : ""}`),
      ...(u.allergies.length ? [`ACHTUNG Allergien: ${u.allergies.join(", ")}`] : []),
    ].join("\n");
    const c = el("button", "ghost", "Bestellliste kopieren"); c.type = "button";
    c.onclick = () => copy(c, note);
    box.append(c);
  }

  $("#composer").onsubmit = (e) => {
    e.preventDefault();
    const t = msg.value.trim(); if (!t) return;
    msg.value = ""; autoGrow(); $("#pasteInfo").hidden = true;
    search(t);
  };
  function renderKeyState() {
    $("#keyState").textContent = aiKey ? "KI an" : "Schnellsuche";
    $("#keyState").dataset.on = aiKey ? "1" : "0";
    $("#keyInput").value = aiKey;
    $("#keyRemove").hidden = !aiKey;
  }
  $("#settingsBtn").onclick = () => { $("#codePanel").hidden = !$("#codePanel").hidden; };
  $("#codeForm").onsubmit = (e) => {
    e.preventDefault(); aiKey = $("#keyInput").value.trim(); store.set("aiKey", aiKey); renderKeyState(); $("#codePanel").hidden = true;
  };
  $("#keyRemove").onclick = () => { aiKey = ""; store.set("aiKey", ""); renderKeyState(); };

  // ---------- Beispiel beim ersten Öffnen ----------
  function renderExample() {
    const feed = $("#feed");
    const flag = el("div", "example-flag example", "Beispiel");
    const text = "[18:02] TM: Artist will vegan, Bowl o.ä., bis 19:15 im Backstage\n[18:03] Stage: Crew 6 Leute, Pizza passt\n[18:04] TM: Artist keine Nüsse!";
    const u = el("div", "msg-user pasted example", text);
    const box = el("div", "agent example");
    renderUnderstood(box, {
      summary: "Artist vegan ohne Nüsse, Crew Pizza", people_count: 7, deadline: "19:15",
      orders: [{ who: "Artist", qty: 1, wants: "vegane Bowl", diet: "vegan", allergies: "Nüsse" }, { who: "Crew", qty: 6, wants: "Pizza", diet: "", allergies: "" }],
      allergies: ["Nüsse"], searches: ["vegane bowl", "pizza"], questions: [], from_links: [],
    }, location || fixedLocation, text);
    feed.append(flag, u, box);
  }

  // ---------- Start ----------
  (async () => {
    renderKeyState();
    renderCrewChips();
    renderExample();
    setMode(mode);
    startWatch();
  })();
})();
