---
name: betrieb-und-incidents
description: Betrieb von Diensten mit strikter Änderungskontrolle – Diagnose (systemd, journalctl, nginx, Postgres, Cloudflare/Wrangler), Deploys und Änderungen nur mit Freigabe, Rollback-Plan, Incident-Ablauf und Postmortem. Nutze ihn für jeden Deploy, jede Störung, jede Log-Analyse und jede Änderung an einem laufenden System.
---

# Betrieb und Incidents

**Lesen ist frei, Ändern braucht Freigabe.** Alles, was ein laufendes System verändert – Deploy, Neustart, Konfiguration, Migration, Paketinstallation, Firewall, DNS, Zertifikate, Datenbank-Schreibzugriff, Löschen – geht erst nach `request_approval` (kind `other`, bei Löschen `delete`, bei Veröffentlichung `publish`). Danach Lauf beenden; Helena startet dich mit der Entscheidung neu.

## Nie
- Secrets lesen oder ausgeben (Env-Dateien, `/etc/<dienst>/`, `auth.json`, Schlüssel, Tokens, Zugangsdaten-Speicher). Brauchst du einen Wert, frag nach dem Ergebnis, nicht nach dem Secret.
- `git reset`/`checkout`/`clean` in einem Live-Checkout; `rm -rf` außerhalb deines Arbeitsordners; `DROP`/`TRUNCATE`/`DELETE` ohne `WHERE` und Backup.
- Einloggen, Passwörter eingeben, Pakete installieren ohne Freigabe.
- „Mal eben" auf Produktion testen. Erst lokal/Staging, dann mit Freigabe.

## Diagnose (frei)
Reihenfolge: **Symptom → Zeitpunkt → betroffene Dienste → Logs → letzte Änderung → Hypothese → Test**.
Befehle für Linux/systemd, nginx, Postgres, Cloudflare in `refs/diagnose-befehle.md` – nur lesende.
- Erst den Zeitraum eingrenzen (`journalctl --since`), dann filtern; nie ganze Logs in den Kontext kippen, sondern `grep`, `tail`, Zählen.
- Letzte Änderungen sind der häufigste Grund: `git log` des Deploy-Stands, letzte Deploys, Paket-Updates (`/var/log/apt/history.log`), Konfig-Änderungen.
- Hypothesen einzeln prüfen, Ergebnis jeweils notieren (bestätigt/verworfen, Beleg).

## Änderung vorbereiten (Change)
Vor jeder Freigabe-Anfrage schreibst du einen Änderungsplan (Vorlage in `refs/change-und-postmortem.md`):
1. **Was und warum** (ein Satz, verlinkte Aufgabe)
2. **Exakte Befehle** in Reihenfolge, so wie sie laufen werden
3. **Prüfung vorher** (Backup vorhanden? Tests grün? Speicherplatz?)
4. **Erfolgskriterium** (was genau zeigt, dass es geklappt hat: HTTP 200 auf …, Dienst `active`, keine Fehler im Log seit …)
5. **Rollback** (exakte Befehle, Zeitbedarf, Datenverlust ja/nein)
6. **Risiko und Auswirkung** (Ausfallzeit, betroffene Nutzer)
Diesen Plan gibst du vollständig in `request_approval`. Nach Freigabe: genau das ausführen, nichts zusätzlich; Abweichung → stoppen und neu fragen.

## Nach der Änderung
- Erfolgskriterium prüfen und belegen (Ausgabe kurz zitieren).
- 10–15 Minuten Logs beobachten, wenn möglich.
- Ergebnis als Kommentar in der Aufgabe; bei Fehlschlag Rollback nur, wenn er Teil der Freigabe war, sonst Freigabe für den Rollback anfragen (bei laufendem Ausfall mit Dringlichkeit im Text).

## Incident
1. **Erkennen und melden**: Was ist kaputt, seit wann, wer ist betroffen? Aufgabe mit Priorität `urgent`, Label „Incident", wenn vorhanden.
2. **Stabilisieren vor Ursachenforschung**: der schnellste sichere Weg zurück (Rollback, Dienst neu starten) – **mit Freigabe**, Vorschlag kurz und konkret.
3. **Zeitleiste** mitschreiben (UTC oder Europe/Berlin, einheitlich): Beobachtung, Aktion, Ergebnis.
4. **Ursache** finden (5-Warum), Belege sichern (Log-Auszüge, nicht ganze Logs).
5. **Postmortem** ohne Schuldzuweisung (Vorlage in `refs/change-und-postmortem.md`), Folgeaufgaben mit `create_issue` anlegen und verlinken.

## Bericht
```
Status: behoben | stabil, Ursache offen | wartet auf Freigabe
Ursache: <ein Satz, Beleg>
Getan: <Aktion> (freigegeben in <Freigabe>)
Prüfung: <Erfolgskriterium + Ergebnis>
Folgeaufgaben: KEY-n …
```
