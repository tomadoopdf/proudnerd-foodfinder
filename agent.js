// ProudNerdFoodfinder – Such-Agent (kostenlos über Google Gemini).
// Nutzt Gemini mit Google-Suche + URL-Kontext, um Lieferoptionen in der Nähe zu finden,
// Preise inkl. Gebühren zu vergleichen und Bewertungen einzubeziehen.
// Kostenloser Tarif: Google-Suche ist bei gemini-2.5-flash-lite bis 500 Anfragen/Tag gratis.

const MODEL = process.env.FOODFINDER_MODEL || "gemini-2.5-flash-lite";
const API_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";

const JSON_FORMAT = `{
  "summary": "1–3 Sätze: Empfehlung und warum",
  "assumptions": ["Annahme 1", "…"],
  "people_count": 8,
  "options": [{
    "restaurant": "Name",
    "platform": "Wolt | Lieferando | Uber Eats | … | Direkt",
    "order_url": "direkter Link zum Laden oder null",
    "cuisine": "Küche",
    "serves": 2,
    "rating": 4.6, "rating_count": 1200, "eta_minutes": 35,
    "items": [{"name": "Gericht", "qty": 2, "price": 12.9, "for": "Artist"}],
    "subtotal": 25.8, "delivery_fee": 1.99, "service_fee": 0.99, "total": 28.78,
    "currency": "EUR",
    "price_confidence": "belegt | teilweise geschätzt | geschätzt",
    "tags": ["Beste Wahl", "Günstigste", "Top bewertet", "Schnellste", "vegan ok"],
    "notes": "Hinweise, z. B. Allergene oder unsichere Werte",
    "also_on": [{"platform": "Uber Eats", "total": 31.5, "url": null}]
  }]
}
Unbekannte Zahlen als null. "serves" = für wie viele Personen diese Bestellung ist.`;

// Welche Lieferdienste in welchem Land typischerweise aktiv sind (Startpunkt, der Agent prüft live).
const PLATFORMS_BY_COUNTRY = {
  de: "Lieferando, Wolt, Uber Eats, foodora (nur einzelne Städte), Getir/Flink/REWE Lieferservice für Supermarkt-Sachen, Direktbestellung beim Restaurant",
  at: "foodora, Lieferando, Wolt, Uber Eats (Wien), Direktbestellung",
  ch: "Just Eat (eat.ch), Uber Eats, Smood, Wolt, Direktbestellung",
  gb: "Deliveroo, Uber Eats, Just Eat, Getir",
  nl: "Thuisbezorgd, Uber Eats, Deliveroo, Flink",
  be: "Takeaway.com, Deliveroo, Uber Eats",
  fr: "Uber Eats, Deliveroo, Just Eat",
  es: "Glovo, Just Eat, Uber Eats",
  it: "Glovo, Deliveroo, Just Eat, Uber Eats",
  pl: "Pyszne.pl, Glovo, Wolt, Uber Eats, Bolt Food",
  cz: "Wolt, foodora, Bolt Food",
  dk: "Wolt, Just Eat",
  se: "Foodora, Wolt, Uber Eats",
  no: "Foodora, Wolt",
  fi: "Wolt, Foodora",
  us: "DoorDash, Uber Eats, Grubhub, Postmates, Instacart",
};

function systemPrompt() {
  return `Du bist ProudNerdFoodfinder, der Catering-Runner einer Tour-Produktion. Du findest für Artists und Crew kurzfristig das bestmögliche Essen per Lieferdienst.

So arbeitest du:
1. Lies die Anfrage. Sie kann frei formuliert sein oder ein eingefügter Chatverlauf (WhatsApp, Slack, Signal …) mit mehreren Personen, Wünschen und Links. Zieh daraus: wer will was, Mengen, Ernährungsform, Allergien, Budget, Deadline, Lieferadresse. Was unklar ist, nimmst du sinnvoll an und schreibst es in "assumptions".
2. Stehen Links zu Läden im Text, öffne sie über den URL-Kontext und prüfe Speisekarte, Preise, Mindestbestellwert, Liefergebühr, Bewertung und ob der Laden an die Adresse liefert.
3. Suche mit der Google-Suche nach weiteren passenden Läden in der Nähe des Standorts, auf allen Lieferplattformen, die in der Region aktiv sind. Vergleiche denselben Laden über mehrere Plattformen hinweg, wenn er auf mehreren gelistet ist – die Preise und Gebühren unterscheiden sich oft.
4. Rechne für jede Option den Endpreis: Summe der Gerichte + Liefergebühr + Servicegebühr + ggf. Aufschlag für Mindestbestellwert. Rechne pro Person.
5. Bewerte: Preis, Bewertung (Sterne und Anzahl), Lieferzeit, wie gut es zu den Wünschen und Ernährungsvorgaben passt. Bei kurzfristigen Anfragen hat Lieferzeit Vorrang vor ein paar Euro Ersparnis. Unter ca. 4,0 Sternen oder mit sehr wenigen Bewertungen nur empfehlen, wenn es keine Alternative gibt, und das sagen.
6. Gib am Ende GENAU EINEN JSON-Block aus (\`\`\`json … \`\`\`), mit 2 bis 5 Optionen, beste zuerst, in diesem Format:
${JSON_FORMAT}
Vor dem JSON-Block höchstens zwei kurze Sätze, danach nichts mehr.

Regeln:
- Erfinde keine Preise, Bewertungen oder Links. Wenn du einen Wert nicht belegen konntest, setz ihn auf null und schreib in "notes", dass er geschätzt bzw. unbekannt ist. Setz "price_confidence" ehrlich.
- "order_url" ist der direkte Link zum Laden auf der jeweiligen Plattform (oder Website), so dass man dort nur noch in den Warenkorb legen und bezahlen muss. Nur URLs, die du tatsächlich gesehen hast.
- Allergien sind Pflicht, keine Vorliebe. Wenn ein Gericht unsicher ist, sag es.
- Du kannst selbst nicht bestellen oder bezahlen. Die Bestellung schickt der Nutzer in der App ab. Bereite deshalb die Warenkorb-Liste so vor, dass man sie 1:1 abtippen kann (Gericht, Variante, Menge, für wen).
- Antworte auf Deutsch (oder in der Sprache der Anfrage), kurz und sachlich. Kein Smalltalk.
- Länderhinweise zu Plattformen sind nur ein Startpunkt; prüfe, was vor Ort wirklich liefert.`;
}

function describeLocation(loc) {
  if (!loc) return "Standort unbekannt – frag nach oder nimm die Stadt aus der Nachricht.";
  const parts = [];
  if (loc.label) parts.push(`Adresse: ${loc.label}`);
  if (loc.lat != null) parts.push(`Koordinaten: ${loc.lat.toFixed(5)}, ${loc.lon.toFixed(5)} (±${Math.round(loc.accuracy || 0)} m)`);
  if (loc.mode === "fixed") parts.push("Fixe Lieferadresse (Venue/Hotel), nicht der aktuelle GPS-Standort.");
  const cc = (loc.country_code || "").toLowerCase();
  if (PLATFORMS_BY_COUNTRY[cc]) parts.push(`Typische Lieferdienste in diesem Land: ${PLATFORMS_BY_COUNTRY[cc]}`);
  return parts.join("\n");
}

function describeProfiles(profiles) {
  const active = (profiles || []).filter((p) => p.active);
  if (!active.length) return "Keine gespeicherten Rider/Profile ausgewählt.";
  return active
    .map((p) =>
      `- ${p.name} (${p.role || "Crew"})` +
      (p.diet ? ` | Ernährung: ${p.diet}` : "") +
      (p.allergies ? ` | ALLERGIEN: ${p.allergies}` : "") +
      (p.likes ? ` | mag: ${p.likes}` : "") +
      (p.dislikes ? ` | mag nicht: ${p.dislikes}` : ""),
    )
    .join("\n");
}

/**
 * Führt eine Suche aus. `emit(type, data)` schickt Fortschritt an den Browser.
 * history: [{role:"user"|"assistant", text}] – frühere Runden als reiner Text.
 */
export async function runSearch({ message, history = [], location, profiles, budget, deadline }, emit) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY fehlt auf dem Server.");

  const now = new Date().toLocaleString("de-DE", { timeZone: location?.timezone || "Europe/Berlin" });
  const context =
    `Ortszeit: ${now}\n` +
    `${describeLocation(location)}\n` +
    (deadline ? `Essen muss da sein bis: ${deadline}\n` : "") +
    (budget ? `Budget gesamt: ${budget}\n` : "") +
    `Rider & Crew-Profile:\n${describeProfiles(profiles)}`;

  const turns = [];
  for (const h of history.slice(-8)) {
    if (!h.text) continue;
    turns.push({ type: h.role === "assistant" ? "model_output" : "user_input", content: [{ type: "text", text: h.text }] });
  }
  turns.push({ type: "user_input", content: [{ type: "text", text: `${context}\n\n--- Anfrage ---\n${message}` }] });

  emit("status", { kind: "search", text: `Google-Suche rund um ${location?.city || "den Standort"} …` });

  const body = {
    model: MODEL,
    system_instruction: systemPrompt(),
    input: turns,
    tools: [{ type: "google_search" }, { type: "url_context" }],
    generation_config: { max_output_tokens: 8192 },
    store: false,
  };

  const call = (b) => fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key, "Api-Revision": "2026-05-20" },
    body: JSON.stringify(b),
  });
  let r = await call(body);
  let data = await r.json().catch(() => ({}));
  // Falls das Modell den URL-Kontext nicht kombinieren kann: nur mit Google-Suche erneut
  if (r.status === 400) {
    console.warn("Gemini 400, versuche ohne url_context:", data?.error?.message);
    r = await call({ ...body, tools: [{ type: "google_search" }] });
    data = await r.json().catch(() => ({}));
  }
  if (!r.ok) {
    const msg = data?.error?.message || `Google-API Fehler ${r.status}`;
    if (r.status === 429) throw new Error("Tageslimit der kostenlosen Google-Suche erreicht oder zu viele Anfragen auf einmal. Kurz warten.");
    throw new Error(msg);
  }

  // Suchanfragen und Quellen für die Fortschrittsanzeige
  const steps = data.steps || [];
  let text = "";
  for (const st of steps) {
    if (st.type === "google_search_call") for (const q of st.arguments?.queries || []) emit("status", { kind: "search", text: q });
    if (st.type === "url_context_call") for (const u of st.arguments?.urls || []) emit("status", { kind: "fetch", text: u });
    if (st.type === "model_output") {
      for (const c of st.content || []) {
        if (c.type !== "text") continue;
        text += c.text;
        for (const a of c.annotations || []) if (a.type === "url_citation" && a.url) emit("status", { kind: "fetch", text: a.title || a.url });
      }
    }
  }
  if (!text && data.output_text) text = data.output_text;

  const result = parseResult(text);
  const prose = text.replace(/```json[\s\S]*?```/g, "").trim();
  return { result, text: result ? "" : prose || "Keine Antwort erhalten." };
}

function parseResult(text) {
  const m = /```json\s*([\s\S]*?)```/.exec(text) || /(\{[\s\S]*"options"[\s\S]*\})/.exec(text);
  if (!m) return null;
  try {
    const j = JSON.parse(m[1]);
    if (!Array.isArray(j.options) || !j.options.length) return null;
    const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);
    j.summary = String(j.summary || "");
    j.assumptions = Array.isArray(j.assumptions) ? j.assumptions.map(String) : [];
    j.people_count = num(j.people_count) || 1;
    j.options = j.options.map((o) => ({
      restaurant: String(o.restaurant || "Unbekannt"),
      platform: String(o.platform || ""),
      order_url: typeof o.order_url === "string" ? o.order_url : null,
      cuisine: String(o.cuisine || ""),
      serves: num(o.serves),
      rating: num(o.rating), rating_count: num(o.rating_count), eta_minutes: num(o.eta_minutes),
      items: (Array.isArray(o.items) ? o.items : []).map((i) => ({ name: String(i.name || ""), qty: num(i.qty) || 1, price: num(i.price), for: String(i.for || "") })),
      subtotal: num(o.subtotal), delivery_fee: num(o.delivery_fee), service_fee: num(o.service_fee), total: num(o.total),
      currency: /^[A-Z]{3}$/.test(o.currency || "") ? o.currency : "EUR",
      price_confidence: ["belegt", "teilweise geschätzt", "geschätzt"].includes(o.price_confidence) ? o.price_confidence : "geschätzt",
      tags: Array.isArray(o.tags) ? o.tags.map(String) : [],
      notes: String(o.notes || ""),
      also_on: (Array.isArray(o.also_on) ? o.also_on : []).map((a) => ({ platform: String(a.platform || ""), total: num(a.total), url: typeof a.url === "string" ? a.url : null })),
    }));
    return j;
  } catch {
    return null;
  }
}

// Demo-Antwort ohne API-Aufruf (DEMO=1), zum Ausprobieren der Oberfläche.
export async function runDemo({ location }, emit) {
  const city = location?.city || "Köln";
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  emit("status", { kind: "search", text: `vegane Bowl Lieferung ${city} Wolt` });
  await wait(600);
  emit("status", { kind: "search", text: `Lieferando ${city} vegan Bewertungen` });
  await wait(600);
  emit("status", { kind: "fetch", text: "https://wolt.com/de/deu/…" });
  await wait(500);
  return {
    text: "",
    result: {
      summary: `DEMO-Daten, keine echte Suche. So sieht ein Ergebnis aus: zwei vegane Bowls für den Artist und 6× Pizza für die Crew in ${city}.`,
      assumptions: ["Lieferung an aktuellen Standort", "Crew isst alles außer Schwein"],
      people_count: 8,
      options: [
        {
          restaurant: "Beispiel: Green Bowl Kitchen", platform: "Wolt", order_url: null, cuisine: "Bowls, vegan", serves: 2,
          rating: 4.7, rating_count: 1240, eta_minutes: 30,
          items: [{ name: "Tofu Teriyaki Bowl", qty: 2, price: 13.9, for: "Artist" }, { name: "Edamame", qty: 1, price: 4.5, for: "Artist" }],
          subtotal: 32.3, delivery_fee: 1.99, service_fee: 0.99, total: 35.28, currency: "EUR",
          price_confidence: "geschätzt", tags: ["Beste Wahl", "vegan ok", "Schnellste"],
          notes: "Demo-Eintrag.", also_on: [{ platform: "Uber Eats", total: 38.4, url: null }],
        },
        {
          restaurant: "Beispiel: Pizzeria Due Fratelli", platform: "Lieferando", order_url: null, cuisine: "Pizza", serves: 6,
          rating: 4.5, rating_count: 3800, eta_minutes: 45,
          items: [{ name: "Pizza Margherita", qty: 3, price: 9.5, for: "Crew" }, { name: "Pizza Diavola", qty: 3, price: 11.5, for: "Crew" }],
          subtotal: 63, delivery_fee: 0, service_fee: 0.99, total: 63.99, currency: "EUR",
          price_confidence: "geschätzt", tags: ["Günstigste pro Person"], notes: "Demo-Eintrag.", also_on: [],
        },
      ],
    },
  };
}
