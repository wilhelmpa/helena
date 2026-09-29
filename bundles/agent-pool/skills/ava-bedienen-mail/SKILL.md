---
name: ava-bedienen-mail
description: Mail lesen, Entwürfe pflegen und mit eigener Berechtigung versenden.
---

# Ava bedienen: Mail

Suche mit `search_mail` oder `list_mail_threads_newest_first`; lies einen Treffer mit `read_mail` oder `get_mail_thread_with_messages`. Bearbeite einen Entwurf mit `get_mail_draft` und `save_mail_draft`. `send_mail_draft` verschickt tatsächlich an externe Empfänger.

Beispiel: `search_mail({"projectKey":"VOL","query":"Rechnung"})`; prüfe Empfänger, Inhalt und Anhänge vor `send_mail_draft`.
