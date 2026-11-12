# ProudNerdFoodfinder

Web-App für Tour-Produktionen: findet kurzfristig Essen per Lieferdienst für Artists und Crew.
Läuft im Browser auf jedem Handy. Wer sie nutzt, braucht kein Claude-Konto, nur den Link (und ggf. den Team-Code).

## Was sie kann

- **Live-Standort:** folgt dem GPS des Handys und aktualisiert sich, wenn ihr weiterfahrt. Alternativ eine feste Adresse (Venue, Hotel).
- **Chat:** Wünsche frei eintippen („Artist will vegan, 2 Bowls, bis 19:15“) oder einen ganzen WhatsApp-/Slack-Verlauf einfügen. Links zu Läden darin werden geöffnet und geprüft.
- **Rider & Crew:** Profile mit Ernährung, Allergien, Vorlieben. Pro Suche an- oder abwählbar. Allergien behandelt der Agent als Pflicht.
- **Vergleich:** sucht auf allen Lieferplattformen, die in der Region aktiv sind (z. B. Lieferando, Wolt, Uber Eats, foodora, Deliveroo, Just Eat, Glovo …), rechnet Endpreis inkl. Liefer- und Servicegebühr, pro Person, und wägt Bewertung und Lieferzeit ab.
- **Bestellen:** pro Option ein Button direkt zum Laden auf der Plattform plus eine fertige Warenkorb-Liste zum Kopieren. Alle Optionen lassen sich für den Gruppenchat kopieren.

## Was sie nicht kann

Bezahlt und abgeschickt wird die Bestellung in der Lieferdienst-App selbst. Lieferando, Wolt, Uber Eats & Co. bieten keine öffentliche Schnittstelle zum Bestellen, und automatisches Einloggen mit euren Zahlungsdaten wäre gegen deren AGB und ein Sicherheitsrisiko. Die App bringt euch deshalb bis kurz vor den Bezahl-Button.

Preise und Bewertungen stammen aus einer Live-Websuche. Jede Option zeigt an, ob die Preise belegt oder geschätzt sind.

## Lokal starten

```bash
npm install
cp .env.example .env    # Gemini-Key eintragen
node --env-file=.env server.js
```

Dann http://localhost:3000 öffnen. Ohne API-Key ausprobieren: `npm run demo`.

## Online stellen (damit das ganze Team es nutzen kann)

GPS im Browser funktioniert nur über HTTPS, deshalb braucht die App einen Host mit HTTPS. Einfachster Weg:

1. Den Ordner in ein GitHub-Repository hochladen.
2. Bei **Render.com** (oder Railway, Fly.io) „New Web Service“ → Repository wählen. Build: `npm install`, Start: `node server.js`. Ein Dockerfile liegt auch bei.
3. Umgebungsvariablen setzen:
   - `GEMINI_API_KEY`: kostenloser Key aus https://aistudio.google.com/apikey (Google-Konto, keine Kreditkarte)
   - `TEAM_CODE`: ein Code, den ihr im Team teilt, damit Fremde mit dem Link nicht auf eure Kosten suchen
4. Den Link ans Team schicken. Auf dem Handy über „Zum Home-Bildschirm“ wird daraus ein App-Icon.

## Einstellungen

| Variable | Bedeutung |
|---|---|
| `GEMINI_API_KEY` | Pflicht |
| `TEAM_CODE` | Zugangscode fürs Team (empfohlen) |
| `RATE_LIMIT` | Suchen pro Stunde und Gerät, Standard 20 |
| `FOODFINDER_MODEL` | Standard `gemini-2.5-flash-lite` (einziges Modell mit kostenloser Google-Suche) |
| `DEMO=1` | Oberfläche mit Beispieldaten, ohne API-Aufrufe |

## Kosten und Datenschutz

- Alles kostenlos: Render im Free-Tarif, Google Gemini im kostenlosen Tarif (Google-Suche bis 500 Anfragen pro Tag).
- Im kostenlosen Gemini-Tarif darf Google Anfragen zur Verbesserung seiner Produkte verwenden. Keine sensiblen Daten (Telefonnummern, Gesundheitsdaten außer Allergien) in den Chat kopieren.
- Render schläft nach 15 Min. ohne Nutzung ein; der erste Aufruf danach dauert ca. 1 Minute.
- Für die Adresse wird der Standort an OpenStreetMap (Nominatim) geschickt. Rider-Profile bleiben auf dem jeweiligen Handy.

## Dateien

- `server.js`: Webserver, Geocoding, Team-Code, Rate-Limit
- `agent.js`: der Such-Agent (Prompt, Tools, Ergebnisformat)
- `public/`: Oberfläche (`index.html`, `styles.css`, `app.js`)
