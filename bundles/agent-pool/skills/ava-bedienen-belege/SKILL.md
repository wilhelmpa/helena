---
name: ava-bedienen-belege
description: Belege suchen, prüfen, korrigieren, zuordnen und den Monats-Export vorbereiten.
---

# Ava bedienen: Belege

Beleg-Werkzeuge behalten die `projectAdmin`-Prüfung: Projektowner oder Owner/Manager des zuständigen Teams. Nutze `list_receipts` und `read_receipt` mit `projectKey`, dann `update_receipt` für erkannte Felder. Für Zuordnungen lies `list_receipt_candidates`; `match_receipt_manually` bindet eine Transaktion. `list_receipt_pair_suggestions` und `resolve_receipt_pair_suggestion` bearbeiten Paare, `link_receipt_original` und `unlink_receipt_original` ergänzende Originale.

Beispiel: `list_receipts({"projectKey":"VOL","month":"2026-09"})`, dann `read_receipt({"projectKey":"VOL","receiptId":123})`. `prepare_receipt_export({"projectKey":"VOL","month":"2026-09"})` prüft und baut den Export; der Antwortpfad lädt die aktuelle ZIP nur mit denselben Adminrechten herunter. Bankdaten bleiben im berechtigten Projekt.
