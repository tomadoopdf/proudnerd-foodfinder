// ProudNerdFoodfinder – kleiner Webserver ohne Framework.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSearch, runDemo } from "./agent.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(here, "public");
const PORT = Number(process.env.PORT || 3000);
const TEAM_CODE = process.env.TEAM_CODE || ""; // optional: gemeinsamer Zugangscode fürs Team
const DEMO = process.env.DEMO === "1";

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".png": "image/png",
};

// Einfaches Rate-Limit pro IP: 20 Suchen pro Stunde
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 3600_000);
  list.push(now);
  hits.set(ip, list);
  return list.length > Number(process.env.RATE_LIMIT || 20);
}

// Reverse-Geocoding über OpenStreetMap Nominatim, gecacht auf ~100 m
const geoCache = new Map();
async function reverseGeocode(lat, lon) {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  if (geoCache.has(key)) return geoCache.get(key);
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&lat=${lat}&lon=${lon}&accept-language=de`;
  const r = await fetch(url, { headers: { "User-Agent": "ProudNerdFoodfinder/1.0" } });
  if (!r.ok) throw new Error(`Geocoding ${r.status}`);
  const j = await r.json();
  const a = j.address || {};
  const out = {
    city: a.city || a.town || a.village || a.municipality || a.county || "",
    region: a.state || "",
    postcode: a.postcode || "",
    road: [a.road, a.house_number].filter(Boolean).join(" "),
    country_code: (a.country_code || "").toLowerCase(),
  };
  out.label = [out.road, [out.postcode, out.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  geoCache.set(key, out);
  return out;
}

async function forwardGeocode(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&accept-language=de&q=${encodeURIComponent(q)}`;
  const r = await fetch(url, { headers: { "User-Agent": "ProudNerdFoodfinder/1.0" } });
  if (!r.ok) throw new Error(`Geocoding ${r.status}`);
  const [hit] = await r.json();
  if (!hit) return null;
  const a = hit.address || {};
  return {
    lat: Number(hit.lat), lon: Number(hit.lon),
    city: a.city || a.town || a.village || a.municipality || "",
    region: a.state || "", postcode: a.postcode || "",
    country_code: (a.country_code || "").toLowerCase(),
    label: hit.display_name,
  };
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readBody(req, limit = 200_000) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error("Nachricht zu lang");
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function authorized(req) {
  return !TEAM_CODE || req.headers["x-team-code"] === TEAM_CODE;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket.remoteAddress;

  try {
    if (url.pathname === "/api/config") {
      return json(res, 200, { needsCode: Boolean(TEAM_CODE), demo: DEMO });
    }

    if (url.pathname === "/api/geo") {
      if (!authorized(req)) return json(res, 401, { error: "Team-Code fehlt oder ist falsch." });
      const q = url.searchParams.get("q");
      if (q) {
        // Venue-Namen vorne ("Palladium, Schanzenstr. 40, Köln") kennt OSM oft nicht – dann ohne ersten Teil erneut
        let hit = await forwardGeocode(q);
        if (!hit && q.includes(",")) hit = await forwardGeocode(q.split(",").slice(1).join(",").trim());
        return json(res, 200, hit || { error: "Adresse nicht gefunden." });
      }
      const lat = Number(url.searchParams.get("lat"));
      const lon = Number(url.searchParams.get("lon"));
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return json(res, 400, { error: "lat/lon fehlen" });
      return json(res, 200, await reverseGeocode(lat, lon));
    }

    if (url.pathname === "/api/search" && req.method === "POST") {
      if (!authorized(req)) return json(res, 401, { error: "Team-Code fehlt oder ist falsch." });
      if (rateLimited(ip)) return json(res, 429, { error: "Zu viele Suchen in der letzten Stunde. Kurz warten." });
      const body = await readBody(req);
      if (!body.message || typeof body.message !== "string") return json(res, 400, { error: "Nachricht fehlt." });

      // Server-Sent Events: Fortschritt live an den Browser
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      const emit = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
      const ping = setInterval(() => res.write(": ping\n\n"), 15000);
      try {
        const out = DEMO ? await runDemo(body, emit) : await runSearch(body, emit);
        emit("done", out);
      } catch (err) {
        console.error(err);
        emit("error", { error: err?.status === 429 ? "Der KI-Dienst ist gerade ausgelastet. In einer Minute nochmal." : err.message || "Unbekannter Fehler" });
      } finally {
        clearInterval(ping);
        res.end();
      }
      return;
    }

    // Statische Dateien
    let file = url.pathname === "/" ? "/index.html" : url.pathname;
    const full = path.normalize(path.join(PUBLIC, file));
    if (!full.startsWith(PUBLIC)) return json(res, 403, { error: "nope" });
    const data = await fs.readFile(full).catch(() => null);
    if (!data) return json(res, 404, { error: "Nicht gefunden" });
    res.writeHead(200, { "Content-Type": TYPES[path.extname(full)] || "application/octet-stream" });
    res.end(data);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) json(res, 500, { error: err.message });
    else res.end();
  }
});

server.listen(PORT, () => {
  console.log(`ProudNerdFoodfinder läuft auf http://localhost:${PORT}${DEMO ? " (DEMO-Modus)" : ""}`);
});
