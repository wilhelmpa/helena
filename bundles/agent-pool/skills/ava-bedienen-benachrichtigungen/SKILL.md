---
name: ava-bedienen-benachrichtigungen
description: Inbox-Benachrichtigungen und Benachrichtigungseinstellungen bedienen.
---

# Ava bedienen: Benachrichtigungen

`list_inbox_notifications` und `get_unread_notification_count` lesen den eigenen Eingang. `mark_notification_read_or_unread` und `snooze_notification` ändern nur diesen Eingang. Projekteinstellungen liest `get_notification_preferences`; Push-Geräte sind Browserzustand.

Beispiel: `list_inbox_notifications({})`, danach die erhaltene Benachrichtigungs-ID an `mark_notification_read_or_unread` übergeben.
