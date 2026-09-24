# Vorlagen: Änderungsplan und Postmortem

## Änderungsplan (in die Freigabe-Anfrage kopieren)

```markdown
**Änderung:** <ein Satz> (Aufgabe KEY-n)
**Warum:** <Grund / Befund>
**System:** <Server/Dienst/Umgebung>

**Vorher prüfen**
- [ ] Backup/Snapshot vorhanden: <wo, von wann>
- [ ] Tests grün: <Lauf/Commit>
- [ ] Platz/Ressourcen: <df -h / free -h Ergebnis>

**Befehle (genau so, in dieser Reihenfolge)**
1. `…`
2. `…`

**Erfolgskriterium**
- <z. B. `systemctl is-active <dienst>` = active; `curl … ` = 200; keine ERROR-Zeilen seit Start>

**Rollback**
1. `…` (Dauer ca. <n> min, Datenverlust: nein/ja – was)

**Risiko / Auswirkung**
- Ausfallzeit: <keine / ca. n s>
- Betroffen: <wer/was>
```

## Postmortem (ohne Schuldzuweisung)

```markdown
# Postmortem: <Titel> (<Datum>)

## Zusammenfassung
<2–3 Sätze: was, wie lange, wer betroffen, wie behoben>

## Auswirkung
- Dauer: <von> – <bis> (<Zeitzone>)
- Betroffen: <Nutzer/Funktionen>, Datenverlust: <nein/ja>

## Zeitleiste
| Zeit | Ereignis |
|---|---|
| 10:02 | Erste Fehlermeldung … |
| 10:15 | Rollback freigegeben und ausgeführt |

## Ursache
<Technische Ursache mit Beleg. 5-Warum: warum 1 → … → warum 5>

## Was gut lief / was nicht
- Gut: …
- Nicht gut: …

## Maßnahmen
| Maßnahme | Aufgabe | Art (verhindern/erkennen/beheben) |
|---|---|---|
| Alarm bei … | KEY-n | erkennen |
```

Ablage: Notiz im Projektwissen (`write_note`, `Projects/<KEY>/Docs/Betrieb/Postmortems/<Datum>-<thema>.md`), in der Incident-Aufgabe verlinken.
