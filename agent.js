// ProudNerdFoodfinder – Such-Agent.
// Nutzt Claude mit Websuche + Web-Fetch, um Lieferoptionen in der Nähe zu finden,
// Preise inkl. Gebühren zu vergleichen und Bewertungen einzubeziehen.
import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.FOODFINDER_MODEL || "claude-opus-5-5";
const client = new Anthropic();

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
2. Stehen Links zu Läden im Text, öffne sie mit web_fetch und prüfe Speisekarte, Preise, Mindestbestellwert, Liefergebühr, Bewertung und ob der Laden an die Adresse liefert.
3. Suche mit web_search nach weiteren passenden Läden in der Nähe des Standorts, auf allen Lieferplattformen, die in der Region aktiv sind. Vergleiche denselben Laden über mehrere Plattformen hinweg, wenn er auf mehreren gelistet ist – die Preise und Gebühren unterscheiden sich oft.
4. Rechne für jede Option den Endpreis: Summe der Gerichte + Liefergebühr + Servicegebühr + ggf. Aufschlag für Mindestbestellwert. Rechne pro Person.
5. Bewerte: Preis, Bewertung (Sterne und Anzahl), Lieferzeit, wie gut es zu den Wünschen und Ernährungsvorgaben passt. Bei kurzfristigen Anfragen hat Lieferzeit Vorrang vor ein paar Euro Ersparnis. Unter ca. 4,0 Sternen oder mit sehr wenigen Bewertungen nur empfehlen, wenn es keine Alternative gibt, und das sagen.
6. Ruf am Ende genau einmal das Tool present_options auf, mit 2 bis 5 Optionen, beste zuerst.

Regeln:
- Erfinde keine Preise, Bewertungen oder Links. Wenn du einen Wert nicht belegen konntest, setz ihn auf null und schreib in "notes", dass er geschätzt bzw. unbekannt ist. Setz "price_confidence" ehrlich.
- "order_url" ist der direkte Link zum Laden auf der jeweiligen Plattform (oder Website), so dass man dort nur noch in den Warenkorb legen und bezahlen muss. Nur URLs, die du tatsächlich gesehen hast.
- Allergien sind Pflicht, keine Vorliebe. Wenn ein Gericht unsicher ist, sag es.
- Du kannst selbst nicht bestellen oder bezahlen. Die Bestellung schickt der Nutzer in der App ab. Bereite deshalb die Warenkorb-Liste so vor, dass man sie 1:1 abtippen kann (Gericht, Variante, Menge, für wen).
- Antworte auf Deutsch (oder in der Sprache der Anfrage), kurz und sachlich. Kein Smalltalk.
- Länderhinweise zu Plattformen sind nur ein Startpunkt; prüfe, was vor Ort wirklich liefert.`;
}

const presentOptionsTool = {
  name: "present_options",
  description:
    "Gibt die verglichenen Lieferoptionen strukturiert an die App zurück. Genau einmal am Ende aufrufen.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["summary", "assumptions", "people_count", "options"],
    properties: {
      summary: { type: "string", description: "1–3 Sätze: Empfehlung und warum." },
      assumptions: { type: "array", items: { type: "string" } },
      people_count: { type: "integer" },
      options: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "restaurant", "platform", "order_url", "cuisine", "serves", "rating", "rating_count",
            "eta_minutes", "items", "subtotal", "delivery_fee", "service_fee", "total",
            "currency", "price_confidence", "tags", "notes", "also_on",
          ],
          properties: {
            restaurant: { type: "string" },
            platform: { type: "string", description: "z. B. Wolt, Lieferando, Uber Eats, Direkt" },
            order_url: { type: ["string", "null"] },
            cuisine: { type: "string" },
            serves: { type: "integer", description: "Für wie viele Personen diese Bestellung ist" },
            rating: { type: ["number", "null"], description: "Sterne 0–5" },
            rating_count: { type: ["integer", "null"] },
            eta_minutes: { type: ["integer", "null"] },
            items: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["name", "qty", "price", "for"],
                properties: {
                  name: { type: "string" },
                  qty: { type: "integer" },
                  price: { type: ["number", "null"], description: "Einzelpreis" },
                  for: { type: "string", description: "Für wen, z. B. 'Artist', 'Crew', Name" },
                },
              },
            },
            subtotal: { type: ["number", "null"] },
            delivery_fee: { type: ["number", "null"] },
            service_fee: { type: ["number", "null"] },
            total: { type: ["number", "null"] },
            currency: { type: "string", description: "ISO-Code, z. B. EUR" },
            price_confidence: { type: "string", enum: ["belegt", "teilweise geschätzt", "geschätzt"] },
            tags: {
              type: "array",
              items: { type: "string" },
              description: "Kurze Labels: 'Beste Wahl', 'Günstigste', 'Top bewertet', 'Schnellste', 'vegan ok' …",
            },
            notes: { type: "string" },
            also_on: {
              type: "array",
              description: "Gleicher Laden auf anderen Plattformen mit Gesamtpreis",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["platform", "total", "url"],
                properties: {
                  platform: { type: "string" },
                  total: { type: ["number", "null"] },
                  url: { type: ["string", "null"] },
                },
              },
            },
          },
        },
      },
    },
  },
};

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
  const now = new Date().toLocaleString("de-DE", { timeZone: location?.timezone || "Europe/Berlin" });
  const context =
    `Ortszeit: ${now}\n` +
    `${describeLocation(location)}\n` +
    (deadline ? `Essen muss da sein bis: ${deadline}\n` : "") +
    (budget ? `Budget gesamt: ${budget}\n` : "") +
    `Rider & Crew-Profile:\n${describeProfiles(profiles)}`;

  const messages = [];
  for (const h of history.slice(-8)) {
    if (!h.text) continue;
    messages.push({ role: h.role === "assistant" ? "assistant" : "user", content: h.text });
  }
  // Rollen müssen abwechseln und mit user beginnen
  while (messages.length && messages[0].role !== "user") messages.shift();
  const userContent = `${context}\n\n--- Anfrage ---\n${message}`;
  if (messages.length && messages[messages.length - 1].role === "user") {
    messages[messages.length - 1].content += `\n\n${userContent}`;
  } else {
    messages.push({ role: "user", content: userContent });
  }

  const userLocation = { type: "approximate" };
  if (location?.city) userLocation.city = location.city;
  if (location?.country_code) userLocation.country = location.country_code.toUpperCase();
  if (location?.region) userLocation.region = location.region;
  if (location?.timezone) userLocation.timezone = location.timezone;

  const tools = [
    { type: "web_search_20260209", name: "web_search", max_uses: 10, user_location: userLocation },
    { type: "web_fetch_20260209", name: "web_fetch", max_uses: 10, max_content_tokens: 20000 },
    presentOptionsTool,
  ];

  let result = null;
  let finalText = "";

  for (let turn = 0; turn < 6; turn++) {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system: systemPrompt(),
      tools,
      messages,
    });

    stream.on("contentBlock", (block) => {
      if (block.type === "server_tool_use") {
        if (block.name === "web_search") emit("status", { kind: "search", text: block.input?.query });
        if (block.name === "web_fetch") emit("status", { kind: "fetch", text: block.input?.url });
      }
    });
    stream.on("text", (delta) => emit("delta", { text: delta }));

    const msg = await stream.finalMessage();

    if (msg.stop_reason === "refusal") {
      throw new Error("Die Anfrage wurde abgelehnt. Bitte anders formulieren.");
    }

    messages.push({ role: "assistant", content: msg.content });
    finalText = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim() || finalText;

    if (msg.stop_reason === "pause_turn") continue;

    const toolUse = msg.content.find((b) => b.type === "tool_use" && b.name === "present_options");
    if (toolUse) {
      result = toolUse.input;
      break;
    }
    if (msg.stop_reason === "max_tokens") {
      throw new Error("Antwort war zu lang und wurde abgeschnitten. Bitte Anfrage aufteilen.");
    }
    // end_turn ohne Tool: Rückfrage oder reine Textantwort
    break;
  }

  return { result, text: finalText };
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
