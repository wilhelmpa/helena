# Second-Brain-Backend: API für Wissen, Dateien und Belege

Alle Pfade sind Vault-relativ. Die vorhandene Session/API-Key-Authentifizierung gilt; Projektzugriffe nutzen die `documents`-Berechtigung. Eine `.base` ist nur eine YAML-Ansichtsdefinition, keine Datenbank und keine ACL. Die API wertet ausschließlich Notizen aus, die der Aufrufer nach Projekt-ACL lesen darf.

## Bases

- `GET /knowledge/bases?path=Projects/MKT/Docs/Wissen.base` liefert `{ path, content, sha256, definition }`. `content` ist das unveränderte YAML; `definition` enthält auch unbekannte Schlüssel.
- `PUT /knowledge/bases` mit `{"path":"Projects/MKT/Docs/Wissen.base","content":"views:\n  - type: table\n    name: Wissen\n","expectedSha":null}` erstellt die Datei. Für Updates muss `expectedSha` aus GET gesetzt sein; Konflikte ergeben 409.
- `GET /knowledge/bases/rows?path=Projects/MKT/Docs/Wissen.base&view=Wissen&page=1&pageSize=50` liefert `{ path, view: { name, type, order }, total, page, pageSize, rows }`. Jede Zeile enthält `path`, `file`, `note` (Frontmatter), `formula` und `values` nach der `order`-Liste, zum Beispiel `{"path":"Projects/MKT/Docs/One.md","values":{"file.name":"One.md","note.status":"active"}}`.

Unterstützt sind `table`, `cards`, `list`, globale und View-Filter mit `and`/`or`/`not`, Feldvergleiche, `file.inFolder`, `contains`, `if`, einfache Arithmetik, `order`, `sort: [{ property: note.date, direction: DESC }]` und `limit`. Verkettete Formeln, Datums- und Linkfunktionen werden noch nicht ausgewertet. Unbekannte YAML-Schlüssel und Ausdrücke bleiben in der Datei erhalten; eine nicht unterstützte Auswertung ergibt 422 mit dem betreffenden Ausdruck. Formeln werden ohne JavaScript-Ausführung ausgewertet. Die Abfrage ist auf 10.000 lesbare Notizen und 200 Ergebniszeilen pro Seite begrenzt.

## Belege

- `GET /teams/:teamId/receipt-projection` → `{ "enabled": false }` als Standard.
- `PUT /teams/:teamId/receipt-projection` mit `{ "enabled": true }` erfordert Team-Managerrechte und baut die Projektion für Teamprojekte auf; `false` entfernt unberührte generierte Notizen und die unveränderte generierte Base.
- `POST /projects/:projectKey/receipts/projection/rebuild` erfordert Projekt-Adminrechte und liefert `{ enabled, projected, changed, basePath }`. Nach Belegänderungen wird die Projektion ebenfalls erneuert.

Die Base liegt unter `Projects/<KEY>/Files/Belege/Belege.base`; das Projekt-Template liegt unter `bundles/second-brain/Belege.base`. Eine Notiz je primärem Beleg enthält `type: receipt`, `generated: true`, `receipt_id`, `pair_id`, `issuer`, `invoice_date`, `total_gross`, `vat_amount`, `status` und `originals` mit allen Originalpfaden. Ergänzende Originale erzeugen keine eigene Base-Zeile. DB und Originaldateien bleiben maßgeblich. Generierte Notizen sind über Notiz- und Datei-Editierpfade schreibgeschützt; ein extern veränderter Snapshot stoppt den Rebuild mit 409. Die Vault-Suche behandelt diese Notizen als Projektionen und zeigt sie nicht als zweite Wissensquelle.

## Agenten und Organisation

- `GET /projects/:projectKey/agent-export` liefert `{ projectKey, generatedAt, notes: [{ path, content }], base: { path, content } }` als Vorschau oder Download, ohne Dateiänderung.
- `POST /projects/:projectKey/agent-export/materialize` schreibt diese redigierten Snapshots und `Agenten.base` in `Projects/<KEY>/Docs/Agenten/` und liefert `{ projectKey, basePath, notes: [path], changed }`. Wiederholung ohne Konfigurationsänderung schreibt nichts neu.

Beide Endpunkte erfordern Projekt-Adminrechte. Die Notizen heißen `<Handle> (<ID>).md` (z. B. `scout (12).md`); ältere Exporte mit `<ID>.md` räumt das nächste Materialisieren weg, sofern sie unverändert sind. Agentennotizen enthalten stabile `agent_id`/`revision`, Rolle, Modell, Heartbeat, Skills, Tool- und MCP-Namen, Budgets sowie Abteilung und Berichtslinie, soweit zugeordnet. Roh-Anweisungen, Laufzeitstatus, Zugangsdaten und geheime Tool-Parameter werden nicht exportiert. Änderungen an Exportdateien haben keinen Einfluss auf die DB; extern bearbeitete Snapshots führen beim nächsten Materialisieren zu 409. Das generische Template liegt unter `bundles/second-brain/Agenten.base`.

## Wissens-Properties

`GET /knowledge/properties-template?path=Projects/MKT/Docs/Neu.md` liefert `{ path, frontmatter, content }` als Vorschlag für eine neue Notiz und prüft den Projektzugriff. `origin` ist `manual`; der Text beginnt leer (der Dateiname ist der Titel). Die UI nutzt die Vorlage bei „Neu › Doc“ in Projekten. `bundles/second-brain/Wissen.md` schlägt dieselben Properties `type`, `schema_version`, `status`, `project`, `tags`, `source` und `origin` vor. `PROJECT_VAULT_ROOT=/pfad/zum/test-vault bun scripts/second-brain-dry-run.ts` zeigt fehlende Properties als JSON-Zeilen; das Skript ändert keine Datei. Bestehende Notizen werden nicht migriert.

## Herkunft

`GET /projects/:projectKey/files` (Vault-Wurzel) und `GET /knowledge/recent` liefern je Datei `origin`: `system` (Belege, Mail-Anhänge, generierte Projektionen, `Docs/Agenten`), `agent` (letzter Schreiber `agent:<id>`, Browser-Endbilder unter `Files/Browser`) oder `manual`. Ein gültiges `origin` im Frontmatter hat Vorrang. Regeln in `packages/vault/src/origin.ts`.

## Konsolidierung: ein Speicher (hub/ui-3c)

Drei Skripte ziehen Reste in den Vault; Standard ist ein Probelauf, `--apply` schreibt, ein zweiter Lauf ändert nichts:

- `apps/api/src/scripts/note-boards-to-vault.ts`: öffentliche Leinwände, die noch nur in `note_board.canvas` liegen, werden `Projects/<KEY>/Boards/<Name>.canvas`. Private und eingeschränkte Leinwände bleiben in der DB (Rechte pro Person) und werden nur gemeldet.
- `apps/api/src/scripts/chat-files-to-vault-folder.ts`: `…/Chat Uploads/**` und `…/Files/Chat Attachments/**` wandern nach `…/Files/Chat/`; `vault_move` hält alte Links gültig, `chat_attachment.vault_path` und `agent_chat_message.attachments` werden angepasst. Neue Chat-Anhänge landen direkt dort.
- `apps/api/src/scripts/browser-frames-to-vault.ts`: Endbilder von Browser-Läufen (bisher data-URL in `helena_browser_task_run.final_frame`) werden Dateien unter `Files/Browser/<Lauf>.png|jpg`; Migration `0214_browser_frame_vault` ergänzt `final_frame_path`/`final_frame_sha256`. Neue Läufe schreiben nur noch die Datei.
