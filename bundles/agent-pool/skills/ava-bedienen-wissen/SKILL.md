---
name: ava-bedienen-wissen
description: Helena-Wissen im Vault suchen, lesen, versionieren und pflegen.
---

# Ava bedienen: Wissen

Nutze `search_knowledge_vault` für Vault-Inhalte und `read_document` für einen bekannten Pfad. Unter `Projects/<KEY>/Docs/` gelten die Rechte des Projekts; nutze keinen anderen Projektpfad als Ausweichweg. `list_knowledge_tree` und `list_recent_knowledge` helfen beim Auffinden.

Beispiel: `read_document({"path":"Projects/VOL/Docs/Plan.md"})`. Übergib dessen `sha256` als `expectedSha` an `write_note`, wenn du eine bestehende Notiz änderst. `list_note_versions` und `read_note_version` lesen die Historie. `move_knowledge_path`, `trash_knowledge_path` und `restore_knowledge_path` verändern Vault-Pfade; prüfe vorher Quelle und Ziel.
