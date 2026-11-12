// ProudNerdFoodfinder – KI versteht den Chat (kostenlos über Google Gemini, Gratistarif).
// Die KI macht aus Freitext oder eingefügten Chatverläufen eine saubere Bestellliste pro Person
// und passende Suchbegriffe. Gesucht wird dann direkt in den Lieferdienst-Apps.
(() => {
  const MODEL = "gemini-3.5-flash-lite";
  const API_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";

  const SYSTEM = `Du bist der Catering-Runner einer Tour-Produktion. Du liest Essenswünsche von Artists und Crew, oft als eingefügter WhatsApp-/Slack-/Signal-Verlauf, manchmal chaotisch, mehrsprachig oder mit Tippfehlern.
Mach daraus eine klare Bestellliste. Regeln:
- Pro Person bzw. Gruppe ein Eintrag: wer, was genau, Menge, Ernährungsform, Allergien. "Crew 6 Leute" ist EIN Eintrag mit qty 6.
- Spätere Nachrichten ändern frühere ("doch lieber Sushi") – nimm den letzten Stand.
- Allergien und Unverträglichkeiten sind Pflicht. Sammle sie zusätzlich in "allergies".
- Ergänze gespeicherte Rider-Profile, wenn die Person im Chat vorkommt oder als "isst mit" markiert ist.
- "searches": 1 bis 3 kurze Suchbegriffe auf Deutsch, so wie man sie in Wolt/Lieferando eintippt (z. B. "vegane bowl", "pizza", "sushi vegetarisch"). Gleiche Küche nur einmal.
- "questions": was fehlt und wichtig ist (z. B. Lieferadresse, Uhrzeit, Menge). Leer, wenn alles klar ist.
- Wenn Links zu Läden im Text stehen und du sie lesen kannst, nimm Laden-Name und passende Gerichte mit Preis in "from_links" auf. Erfinde nichts.
Antworte NUR mit einem JSON-Objekt in diesem Format:
{"summary":"1 Satz","people_count":8,"deadline":"19:15 oder null","orders":[{"who":"Artist","qty":1,"wants":"vegane Bowl, ohne Koriander","diet":"vegan","allergies":"Nüsse"}],"allergies":["Nüsse"],"searches":["vegane bowl","pizza"],"questions":[],"from_links":[{"shop":"Name","platform":"Wolt","url":"https://…","items":"Tofu Bowl 13,90 €"}]}`;

  function profilesText(profiles) {
    const a = (profiles || []).filter((p) => p.active);
    if (!a.length) return "keine";
    return a.map((p) => `- ${p.name || "?"} (${p.role || "Crew"})${p.diet ? `, ${p.diet}` : ""}${p.allergies ? `, ALLERGIE: ${p.allergies}` : ""}${p.likes ? `, mag ${p.likes}` : ""}${p.dislikes ? `, mag nicht ${p.dislikes}` : ""}`).join("\n");
  }

  function parseJson(text) {
    const m = /```(?:json)?\s*([\s\S]*?)```/.exec(text) || /(\{[\s\S]*\})/.exec(text);
    if (!m) return null;
    try { return JSON.parse(m[1]); } catch { return null; }
  }

  function clean(j) {
    const s = (v) => (v == null ? "" : String(v));
    const arr = (v) => (Array.isArray(v) ? v : []);
    return {
      summary: s(j.summary),
      people_count: Number.isFinite(+j.people_count) ? +j.people_count : null,
      deadline: j.deadline && /\d/.test(j.deadline) ? s(j.deadline) : null,
      orders: arr(j.orders).map((o) => ({ who: s(o.who) || "?", qty: Number.isFinite(+o.qty) && +o.qty > 0 ? +o.qty : 1, wants: s(o.wants), diet: s(o.diet), allergies: s(o.allergies) })),
      allergies: arr(j.allergies).map(s).filter(Boolean),
      searches: [...new Set(arr(j.searches).map(s).filter(Boolean))].slice(0, 3),
      questions: arr(j.questions).map(s).filter(Boolean),
      from_links: arr(j.from_links).map((l) => ({ shop: s(l.shop), platform: s(l.platform), url: /^https?:\/\//.test(l.url || "") ? l.url : null, items: s(l.items) })).filter((l) => l.shop),
    };
  }

  async function understand(key, { message, location, profiles, deadline }) {
    if (!key) throw new Error("Kein Google-KI-Schlüssel eingetragen.");
    const hasLinks = /https?:\/\//.test(message);
    const input =
      `Lieferort: ${location?.label || location?.city || "unbekannt"}\n` +
      (deadline ? `Deadline aus der App: ${deadline}\n` : "") +
      `Gespeicherte Rider-Profile (isst mit):\n${profilesText(profiles)}\n\n--- Nachricht / Chatverlauf ---\n${message}`;
    const body = { model: MODEL, system_instruction: SYSTEM, input, store: false };
    if (hasLinks) body.tools = [{ type: "url_context" }];

    let last;
    let useTools = hasLinks;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 1500 * attempt));
      const b = useTools ? body : { model: body.model, system_instruction: body.system_instruction, input: body.input, store: false };
      const r = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(b),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok) {
        const text = (data.steps || []).filter((st) => st.type === "model_output")
          .flatMap((st) => st.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
        const j = parseJson(text);
        if (j) return clean(j);
        last = new Error("Die KI hat keine lesbare Bestellliste geliefert.");
        continue;
      }
      // Gesperrte Shop-Seiten (z. B. Lieferando) lassen den Link-Abruf scheitern -> ohne Links weiter
      if (useTools && (r.status === 403 || r.status === 400)) { useTools = false; attempt--; continue; }
      if (r.status === 400 || r.status === 401 || r.status === 403) throw new Error("Der Google-KI-Schlüssel wird nicht akzeptiert. Oben auf „KI an“ tippen und prüfen.");
      if (r.status === 429) throw new Error("Das kostenlose Google-Kontingent ist gerade ausgeschöpft. In einer Minute nochmal.");
      last = new Error(r.status === 503 ? "Google-KI ist gerade überlastet." : (data?.error?.message || `Google-KI Fehler ${r.status}`));
    }
    throw last;
  }

  window.PNFF_AI = { understand };
})();
