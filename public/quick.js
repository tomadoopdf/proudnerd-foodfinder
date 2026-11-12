// ProudNerdFoodfinder – Schnellsuche ohne KI-Schlüssel.
// Liest Wünsche aus Text oder Chatverlauf und baut direkte Suchlinks für alle
// Lieferdienste, die im Land des Standorts aktiv sind.
(() => {
  const PLATFORMS = {
    de: [["Lieferando", "lieferando.de"], ["Wolt", "wolt.com"], ["Uber Eats", "ubereats.com"], ["foodora", "foodora.de"]],
    at: [["foodora", "foodora.at"], ["Lieferando", "lieferando.at"], ["Wolt", "wolt.com"], ["Uber Eats", "ubereats.com"]],
    ch: [["Just Eat", "just-eat.ch"], ["Uber Eats", "ubereats.com"], ["Smood", "smood.ch"], ["Wolt", "wolt.com"]],
    gb: [["Deliveroo", "deliveroo.co.uk"], ["Uber Eats", "ubereats.com"], ["Just Eat", "just-eat.co.uk"]],
    ie: [["Deliveroo", "deliveroo.ie"], ["Just Eat", "just-eat.ie"], ["Uber Eats", "ubereats.com"]],
    nl: [["Thuisbezorgd", "thuisbezorgd.nl"], ["Uber Eats", "ubereats.com"], ["Deliveroo", "deliveroo.nl"]],
    be: [["Takeaway", "takeaway.com"], ["Deliveroo", "deliveroo.be"], ["Uber Eats", "ubereats.com"]],
    fr: [["Uber Eats", "ubereats.com"], ["Deliveroo", "deliveroo.fr"], ["Just Eat", "just-eat.fr"]],
    es: [["Glovo", "glovoapp.com"], ["Just Eat", "just-eat.es"], ["Uber Eats", "ubereats.com"]],
    it: [["Glovo", "glovoapp.com"], ["Deliveroo", "deliveroo.it"], ["Just Eat", "justeat.it"], ["Uber Eats", "ubereats.com"]],
    pl: [["Pyszne.pl", "pyszne.pl"], ["Glovo", "glovoapp.com"], ["Wolt", "wolt.com"], ["Uber Eats", "ubereats.com"]],
    cz: [["Wolt", "wolt.com"], ["foodora", "foodora.cz"], ["Bolt Food", "food.bolt.eu"]],
    dk: [["Wolt", "wolt.com"], ["Just Eat", "just-eat.dk"]],
    se: [["Foodora", "foodora.se"], ["Wolt", "wolt.com"], ["Uber Eats", "ubereats.com"]],
    no: [["Foodora", "foodora.no"], ["Wolt", "wolt.com"]],
    fi: [["Wolt", "wolt.com"], ["Foodora", "foodora.fi"]],
    us: [["DoorDash", "doordash.com"], ["Uber Eats", "ubereats.com"], ["Grubhub", "grubhub.com"]],
    ca: [["DoorDash", "doordash.com"], ["Uber Eats", "ubereats.com"], ["SkipTheDishes", "skipthedishes.com"]],
    au: [["Uber Eats", "ubereats.com"], ["DoorDash", "doordash.com"], ["Menulog", "menulog.com.au"]],
  };
  const FALLBACK = [["Uber Eats", "ubereats.com"], ["Wolt", "wolt.com"], ["Glovo", "glovoapp.com"], ["Deliveroo", "deliveroo.com"]];

  const DIETS = [
    [/vegan/i, "vegan"], [/vegetar|veggie/i, "vegetarisch"], [/halal/i, "halal"], [/koscher|kosher/i, "koscher"],
    [/gluten/i, "glutenfrei"], [/lakto|laktose|lactose|dairy.?free/i, "laktosefrei"], [/keto|low.?carb/i, "low carb"],
    [/pescetar|pescatar/i, "pescetarisch"],
  ];
  const CUISINES = [
    "pizza", "sushi", "burger", "bowl", "poke", "thai", "indisch", "vietnamesisch", "pho", "döner", "kebab", "salat",
    "pasta", "chinesisch", "mexikanisch", "burrito", "taco", "koreanisch", "ramen", "curry", "falafel", "griechisch",
    "libanesisch", "japanisch", "italienisch", "asiatisch", "wrap", "suppe", "steak", "chicken", "wings", "sandwich",
    "frühstück", "bagel", "gesund", "smoothie", "dessert", "kuchen", "obst",
  ];
  const ALLERGENS = ["nüsse", "nuss", "erdnuss", "gluten", "laktose", "milch", "ei", "soja", "sesam", "fisch", "meeresfrüchte", "krebstiere", "sellerie", "senf", "lupine"];

  function platformOf(url) {
    const h = (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } })();
    const all = Object.values(PLATFORMS).flat().concat(FALLBACK);
    const hit = all.find(([, d]) => h.endsWith(d.split("/")[0]));
    return hit ? hit[0] : h || "Link";
  }

  function parse(text) {
    const lower = text.toLowerCase();
    const links = [...new Set(text.match(/https?:\/\/[^\s<>"')]+/g) || [])];
    const diets = DIETS.filter(([re]) => re.test(text)).map(([, n]) => n);
    const cuisines = CUISINES.filter((c) => new RegExp(`\\b${c}`, "i").test(lower));

    let people = null;
    const pm = [...text.matchAll(/(\d{1,3})\s*(?:x\s*)?(?:leute|personen|pers\.?|people|pax|köpfe|mann|crew)/gi)].map((m) => +m[1]);
    const fm = [...text.matchAll(/für\s+(\d{1,3})\b/gi)].map((m) => +m[1]);
    if (pm.length || fm.length) people = [...pm, ...fm].reduce((a, b) => a + b, 0);

    const tm = /(?:bis|um|spätestens|until|by)\s*(\d{1,2})[:.](\d{2})/i.exec(text);
    const deadline = tm ? `${tm[1].padStart(2, "0")}:${tm[2]}` : null;

    const allergies = [];
    for (const m of text.matchAll(/(?:keine?|ohne|allergi\w*(?:\s+gegen)?|no)\s+([a-zäöüß\-]+)/gi)) {
      const w = m[1].toLowerCase();
      if (ALLERGENS.some((a) => w.startsWith(a))) allergies.push(m[1]);
    }

    // Chatzeilen: "[18:02] Name: Text" oder "18:02 - Name: Text" oder "Name: Text"
    const wishes = [];
    for (const line of text.split("\n")) {
      const m = /^\s*(?:\[?[\d.,/ ]*\d{1,2}[:.]\d{2}(?::\d{2})?\]?\s*[-–]?\s*)?([^:\n]{1,30}):\s+(.+)$/.exec(line);
      if (m && !/^https?$/i.test(m[1].trim())) wishes.push({ who: m[1].trim(), text: m[2].trim() });
    }
    return { links, diets, cuisines, people, deadline, allergies: [...new Set(allergies)], wishes };
  }

  // Ein Suchbegriff pro Wunsch: Zeilen mit Küche (und Ernährung aus derselben Zeile) werden getrennt gesucht
  function searchTerms(p, text, profiles) {
    const terms = [];
    const lines = p.wishes.length ? p.wishes.map((w) => w.text) : text.split("\n");
    for (const line of lines) {
      const cs = CUISINES.filter((c) => new RegExp(`\\b${c}`, "i").test(line));
      if (!cs.length) continue;
      const ds = DIETS.filter(([re]) => re.test(line)).map(([, n]) => n);
      terms.push([...cs.slice(0, 2), ...ds.slice(0, 1)].join(" "));
    }
    if (!terms.length) {
      const diets = new Set(p.diets);
      for (const x of (profiles || []).filter((y) => y.active)) if (x.diet) diets.add(x.diet.toLowerCase());
      terms.push([...diets].slice(0, 1).join(" ") || "essen");
    }
    return [...new Set(terms)].slice(0, 3);
  }

  function linksFor(term, location) {
    const cc = (location?.country_code || "").toLowerCase();
    const list = PLATFORMS[cc] || FALLBACK;
    const city = location?.city || "";
    const out = list.map(([name, domain]) => ({
      name,
      url: `https://www.google.com/search?q=${encodeURIComponent(`${term} lieferung ${city} site:${domain}`)}`,
    }));
    const ll = location?.lat != null ? `/@${location.lat.toFixed(5)},${location.lon.toFixed(5)},14z` : "";
    out.push({ name: "Google Maps", url: `https://www.google.com/maps/search/${encodeURIComponent(`${term} lieferung`)}${ll}` });
    return out;
  }

  function buildSearches(p, text, location, profiles) {
    return searchTerms(p, text, profiles).map((term) => ({ term, links: linksFor(term, location) }));
  }

  window.PNFF_QUICK = { parse, buildSearches, platformOf };
})();
