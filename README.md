# ProudNerdFoodfinder

Web-App für Tour-Produktionen: findet kurzfristig Essen per Lieferdienst für Artists und Crew.
Läuft im Browser auf jedem Handy. Wer sie nutzt, braucht kein Claude-Konto und keinen Account, nur den Link.

## Was sie kann

- **Live-Standort:** folgt dem GPS des Handys und aktualisiert sich, wenn ihr weiterfahrt. Alternativ eine feste Adresse (Venue, Hotel).
- **Chat:** Wünsche frei eintippen („Artist will vegan, 2 Bowls, bis 19:15“) oder einen ganzen WhatsApp-/Slack-Verlauf einfügen. Links zu Läden darin werden geöffnet und geprüft.
- **Rider & Crew:** Profile mit Ernährung, Allergien, Vorlieben. Pro Suche an- oder abwählbar. Allergien behandelt der Agent als Pflicht.
- **Vergleich:** sucht auf allen Lieferplattformen, die in der Region aktiv sind (z. B. Lieferando, Wolt, Uber Eats, foodora, Deliveroo, Just Eat, Glovo …), rechnet Endpreis inkl. Liefer- und Servicegebühr, pro Person, und wägt Bewertung und Lieferzeit ab.
- **Bestellen:** pro Option ein Button direkt zum Laden auf der Plattform plus eine fertige Warenkorb-Liste zum Kopieren. Alle Optionen lassen sich für den Gruppenchat kopieren.

## Was sie nicht kann

Bezahlt und abgeschickt wird die Bestellung in der Lieferdienst-App selbst. Lieferando, Wolt, Uber Eats & Co. bieten keine öffentliche Schnittstelle zum Bestellen, und automatisches Einloggen mit euren Zahlungsdaten wäre gegen deren AGB und ein Sicherheitsrisiko. Die App bringt euch deshalb bis kurz vor den Bezahl-Button.

Preise und Bewertungen stammen aus einer Live-Websuche. Jede Option zeigt an, ob die Preise belegt oder geschätzt sind.

## Online stellen (kostenlos, ohne Server)

Die App ist eine reine Webseite und läuft über **GitHub Pages**: 0 €, immer sofort erreichbar.

1. Repository auf **Public** stellen (GitHub Pages ist im Gratisplan nur für öffentliche Repositories verfügbar). In den Dateien stehen keine Schlüssel und keine Daten.
2. **Settings** → **Pages** → Branch `main`, Ordner `/ (root)` → **Save**.
3. Nach 1–2 Minuten steht dort der Link, z. B. `https://deinname.github.io/proudnerd-foodfinder/`. Den bekommt das Team. Auf dem Handy über „Zum Home-Bildschirm“ wird daraus ein App-Icon.

## Zwei Suchmodi

| | Schnellsuche | KI-Suche |
|---|---|---|
| Schlüssel nötig | nein | kostenloser Google-KI-Schlüssel (aistudio.google.com/apikey) |
| Wünsche aus Chatverlauf erkennen | ✓ | ✓ |
| Direkte Suche in allen Lieferdiensten der Region | ✓ | ✓ |
| Preise, Gebühren, Sterne automatisch vergleichen | – | ✓ |

Den Schlüssel trägt man in der App oben unter „Schnellsuche“ ein. Er bleibt nur auf diesem Handy gespeichert. Kosten entstehen nicht, solange im Google-Konto keine Zahlungsart hinterlegt ist; im Gratistarif sind bis zu 500 KI-Suchen pro Tag möglich.

## Lokal ausprobieren

```bash
python3 -m http.server 8000
```

Dann http://localhost:8000 öffnen.

## Kosten und Datenschutz

- Alles kostenlos: GitHub Pages und (optional) Google Gemini im Gratistarif.
- Im kostenlosen Gemini-Tarif darf Google Anfragen zur Verbesserung seiner Produkte verwenden. Keine sensiblen Daten (Telefonnummern, Gesundheitsdaten außer Allergien) in den Chat kopieren.
- Für die Adresse wird der Standort an OpenStreetMap (Nominatim) geschickt. Rider-Profile, Chats und der Schlüssel bleiben auf dem jeweiligen Handy.

## Dateien

- `public/index.html`, `public/styles.css`, `public/app.js`: Oberfläche, Standort, Rider
- `public/quick.js`: Schnellsuche ohne Schlüssel
- `public/gemini.js`: KI-Suche mit Google Gemini
- `server.js`, `agent.js`, `render.yaml`: alte Server-Variante für Render (wird nicht gebraucht)
