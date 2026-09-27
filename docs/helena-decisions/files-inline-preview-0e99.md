# Dateien: Vorschau im Hauptbereich und formatierter Standard

Vorbereitet auf `0e99cd6e40b1505fe067eb5b8cb05749a88805ab`; keine Liveabnahme.

- Normale Dateiauswahl setzt weiterhin dieselbe kanonische URL, ersetzt aber die
  Ordnerliste durch die inline Vorschau. Toolbar und Ordnerpfad bleiben erreichbar;
  „Im Ordner anzeigen“ führt zur Dateiauswahl zurück. Vorhandene Download-/Code-/
  Verweisaktionen, ACL, ETags und sämtliche Renderer bleiben erhalten.
- Markdown öffnet bei jeder regulären Neumontage formatiert. Kann der Editor die
  Originalsyntax nicht verlustfrei zurückschreiben, bleibt diese Vorschau readonly;
  Bearbeitung ist bewusst über „Markdown-Quelle“ möglich. Ein echter Parserfehler
  fällt weiterhin sicher auf Quelle zurück. Ansichtswechsel speichert nichts.
- Dirty-Status schützt Schließen, Datei-/Ordnerwechsel, Links im Dateibereich sowie
  Wissen/Boards/Code und Home-Dateiroots. Zwei kleine Page-Hunks melden den Zustand
  vom FileBrowser nach oben und prüfen vor Scopewechsel; sie verändern nicht die
  separate Navigation-Vorbereitung `0590ee37`.
- **Grenze:** Die allgemeine App-Sidebar, Home-/Projektwechsel außerhalb dieser
  Seite und Browser-Zurück haben keinen globalen SPA-UnsavedGuard. Inline sind
  diese Oberflächen nun erreichbar; Schutz für sämtliche SPA-Wechsel wird nicht
  behauptet. Der vorhandene beforeunload schützt Reload/Tabschließen. Kein Router-
  oder History-Monkeypatch wurde ergänzt.
- PDF bleibt der vorhandene native unsandboxed iframe. Auch top-level PDF blieb
  laut Root im IAB leer; der synthetische Originaltext war nativ lesbar. Keine
  PDF.js-/Seiten-/Thumbnail-Alternative wurde hinzugefügt oder Header geändert.

## Lokaler Nachweis und Root-Abnahme

Gezielte echte DOM-/Editorprüfungen: normaler Dateiklick ohne Dialog, Rückkehr,
Dirty-Abbruch an Breadcrumb/Link und echten Scopebuttons, Formatted-Neuaufruf,
PDF/Bild/Audio/Video im gleichen Inlinebereich; bestehende ETag-/Konflikt-/ACL-/
Wikilink-/CRLF-/Source-Erhaltregressionen bleiben aktiv. Scoped Web-Typecheck,
ESLint und Formatprüfung mit vorhandenen Abhängigkeiten, ohne Installation.

Root nach Integration: Home- und Projektdateien öffnen; Desktop/Phone, langer
Dateiname, Scroll und Toolbar prüfen; unsaved Entwurf bei Zurück/Breadcrumb/Tab
abbrechen und danach bewusst verwerfen. Markdown mit Kommentar/CRLF formatiert
readonly ansehen, Quelle bewusst wählen, beim bloßen Wechsel Originalhash
unverändert prüfen. PDF-Rendering im normalen Browser separat abnehmen; IAB-
Leere nicht als behoben melden. Kein API-, Schema-, Runner- oder Servereingriff.
