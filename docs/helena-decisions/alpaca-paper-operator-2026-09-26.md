# Alpaca Paper: eng begrenztes Operator-Setup

Stand: 2026-09-26. Dieses Verfahren ersetzt `/tmp/helena-alpaca-setup.ts`.
Das neue Script `apps/api/src/scripts/alpaca-paper-setup.ts` verwendet die geprüften
Live-Module dynamisch aus `/srv/volition/source/plan`; Root kann es separat in einem
root-eigenen Operatorverzeichnis bereitstellen. Kein Worker führt es live aus.

## Feste Grenze

- Team 1, Projekt `TRADE`, Agent 66 mit Username `paper-trader-trade`, genau diesem
  Projekt zugeordnet; die vorhandenen API-Key-Quellen sind exakt 43 und 44.
- Höchstens eine Alpaca-Paper-Verbindung, teamweit oder bereits TRADE. Fremde
  Credential-Grants, native Toolbindungen anderer Agenten, Quellen mit eigenen
  Grants/Toolbindungen und abweichende Projektzuordnung führen zum Abbruch.
- Nur Agent 66 erhält die nativen Alpaca-Paper-Tools und den Credential-Grant.
  Kein Blueprint-Apply: Chart-, Daytrading-, Risiko- und Quant-Agenten bleiben unberührt.
- Vorhandene verschlüsselte Werte und Owner-Limits bleiben erhalten. Die tatsächlich
  aus den Werten gelesenen Limits müssen vollständig sein und `halted === true`
  ergeben. Fehlender oder falscher Halt wird weder übergangen noch still repariert.
- Nur für eine neue Verbindung: maximal 1.000 USD je Order, 2.000 USD je Position,
  50 USD Risiko je Trade, 150 USD Tagesverlust, 5 Positionen, 20 Orders pro Tag,
  keine Symbolbegrenzung, Crypto aus, Einstiegshalt an. Das sind Setup-Limits,
  keine Aussage zu Profitabilität oder Strategiefreigabe.
- Dry-run ist Standard, ohne Provideraufruf oder Schreibzugriff. `--check` liest nur
  Account/Positionen/offene Orders/Marktstatus. `--apply` führt dieselben GET-Prüfungen
  aus und ändert anschließend nur fehlende Bindungen, Scope und Verbindungsstatus.
  Der zweite korrekte Apply ist ohne Datenänderung. Keine Order, Stornierung,
  Strategie-Freigabe, Routineänderung oder impliziter Agentenlauf wird ausgeführt.

## Root-Abnahme nach dem passenden Deployment

1. Serialisierten Betrieb und keine laufenden Agenten-/Chat-Aktionen sicherstellen.
   Während Prüfung und Apply auch keine parallelen Konfigurationsänderungen zulassen;
   die Provider-GETs halten kein langes DB-Transaktionsschloss.
   Den deployten Commit samt Migration `0191_paper_execution_intents` prüfen;
   `0190` bleibt die bestehende Mail-Claim-Migration. Script und deployte Module vorher zusammen
   reviewen. Erwarteten vollen HEAD und DB-Rollennamen ausdrücklich festhalten.
   Root kopiert die geprüfte Scriptdatei in
   `/var/lib/volition/operator-proofs/alpaca-paper-setup.ts`, Eigentümer root,
   Modus 0644, und prüft SHA256 gegen das freigegebene Artefakt. Keine Envdatei lesen.
2. Mit bestehender Service-Umgebung zuerst Dry-run ausführen. Platzhalter erst nach
   Prüfung ersetzen; das Script vergleicht HEAD, localhost-DB `itsaplan`, Port 5432,
   tatsächlichen DB-Rollennamen, Betriebssystembenutzer und root-eigene Scriptdatei.

   ```sh
   sudo systemd-run --wait --pipe --collect \
     --property=User=volition-plan \
     --property=EnvironmentFile=/etc/volition/plan.env \
     --property=WorkingDirectory=/srv/volition/source/plan/apps/api \
     /usr/local/bin/bun /var/lib/volition/operator-proofs/alpaca-paper-setup.ts \
     --expected-head=REVIEWED_40_CHARACTER_HEAD \
     --expected-db-role=REVIEWED_DATABASE_ROLE --dry-run
   ```

3. Geplante IDs, Limits und Toolnamen prüfen. Bei Abweichung abbrechen; bestehende
   Fremdbindungen oder Owner-Limits niemals zur Erfüllung des Scripts pauschal entfernen.
   Danach denselben Aufruf mit `--check` und erst nach erfolgreicher Kontoprüfung
   `--apply` ausführen. `paper.active` muss true sein, `limits.halted` true bleiben.
   `ordersPlaced: 0` bezeichnet ausschließlich dieses Script, nicht die Kontohistorie.
   Bei 200 offenen Orders ist die Ausgabe nur die erste Seite, kein Gesamtbestand.
4. Den identischen Apply einmal wiederholen: `changed: false`, `missingTools: []`,
   keine weitere Audit-/Grant-/Tooländerung. Nicht aus einem Providerfehler Details
   oder Schlüssel nachfordern: Fehlerausgabe enthält ausschließlich feste Codes.
5. Im tatsächlichen neuen TRADE-Chat mit Agent 66 nur den Lesebeweis anfordern:
   „Lies über deine nativen Alpaca-Paper-Werkzeuge Kontostatus, Positionen, offene
   Orders und geltende Limits. Bestätige Paper und den Einstiegshalt. Führe keinerlei
   Order, Stornierung, Konfigurationsänderung oder Strategie-Freigabe aus.“
   Im Toolprotokoll echte `alpaca_paper_account`/Leseaufrufe prüfen, nicht nur eine
   Textbehauptung. Eine neue Unterhaltung lädt die neuen Bindungen; keine alte
   Toolbeschreibung als Nachweis verwenden. Keine Zugangsdaten ausgeben.

Der Lesebeweis hebt weder Einstiegshalt noch die bestehenden Guards auf:
projekt-/konto-/hashgebundene Owner-Strategiefreigabe, frischer Strategie-Snapshot,
Account-Lock, reservierte offene Kauf-/Verkaufsorders und dauerhafte Execution-Intents
bleiben erforderlich. Das Setup ruft den Orderpfad überhaupt nicht auf.

## Private Validierung

Integrationstests verwenden ausschließlich API-erstellte synthetische Fixtures auf
eigener PostgreSQL-Instanz und einen injizierten Dummy-Lesepfad, nie einen Provider.
Die festen Manifest-IDs werden nur durch private Test-Sequenzen nachgebildet.
Abgedeckt: Dry-run ohne Änderung, exakte Agentbindung, fremde native Bindung,
fremder Grant, fehlender/falscher tatsächlicher Halt, unveränderte individuelle
Owner-Limits und verschlüsselte Werte, wiederholter Apply ohne Änderungen sowie
keine zusätzlichen Agentenläufe oder Benachrichtigungszustellungen.

Ergebnis: 7 Tests / 108 Assertions / 0 Fehler; API-Typprüfung, scoped ESLint und
Prettier grün. Vier Guard-Regressionen schlagen bei gezielt ausgeschalteten
Fremdgrant-/Toolbindungs-/Haltprüfungen fehl; geprüfte Datei danach hashgleich
wiederhergestellt. Unabhängiger read-only Source-Review ohne Blocker. Private
PG-Instanz auf Port 65426 gestoppt. Keine Live- oder Provider-Ausführung.
