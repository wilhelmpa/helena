# Browserübertragung nur für sichtbare Zuschauer

Vorbereitet auf767329cd, kein Livepatch. Owner: Wenn kein Browser offen ist, soll Helena nichts übertragen; Projektbrowser und Devserver bleiben für Agenten verfügbar.

## Befund

Roots ffmpeg-PID3090179 gehörte zum Browserrouter. Eine erlaubte read-only Metadatenprobe ordnete Display203 dem Projektbrowser VOL/Projekt5 zu. Diese PID war bereits beendet; später war ein neuer Router-Kindprozess3104925 mit derselben1240×2064-Aufnahme/60FPS aktiv. Routerprozess785859 blieb unverändert. Ein dauerhaft verwaister ffmpeg-Prozess ist damit nicht belegt. Die vier gelesenen Live-Module video/screencast/idle/websocket waren SHA-identisch zur untersuchten Quelle. Keine Signale, Streams, CDP-Kommandos, Dienste oder Konfigurationen wurden verändert.

High-Tier verwendet ausdrücklich60FPS, x11grab, Farbumwandlung und libx264. Diese Arbeit fällt auch bei unverändertem Bildschirm an. Die beobachtete Last von etwa drei Vierteln **eines** Kerns ist keine75%-Gesamtlast bei32 logischen CPUs. Der Patch senkt weder Bildrate noch Qualität eines sichtbaren Streams.

Die bisherigen Webansichten meldeten zwar `hidden`, hielten aber Socket/Pings/Stats auch für geschlossene Panels oder Hintergrunddokumente offen. BrowserIdle zählt offene Sockets weiterhin als Zuschauer. Serverseitig waren neue Zuschauer zunächst sichtbar; das Entfernen ungenutzter Encoder nach hidden/Teil-disconnect wartete auf die asynchrone Resize-/CDP-Kette. Diese konkreten Lifecyclelücken werden geschlossen. Die Identität eines aktuell als sichtbar gemeldeten realen Zuschauerfensters wurde nicht aus Prozessmetadaten erraten.

## Enger Patch

- Der reale Webhook unterhält nur bei aktivem Browserpanel und sichtbarem Dokument einen WebSocket. Verbergen/Unmount beendet ihn, stoppt Retry-/Ping-/Statstimer und gibt den letzten Frame frei bzw. erhält ihn zur Anzeige. Wiederanzeigen baut die Verbindung samt aktuellem Viewport neu auf. Verspätetes Open/Message eines alten Sockets reaktiviert nichts.
- Ein neuer Serverviewer bekommt erst nach dem bereits bestehenden `hidden:false`-Signal Frames. Aktuelle und bisherige Webclients senden dieses Signal bei jedem Open, bisher unmittelbar nach dem Viewport. Die vorhandenen synthetischen Router-/Resize-Proofviewer wurden an denselben Vertrag angepasst; kein neuer Protokolltyp. Unbekannte externe Clients ohne Sichtbarkeitssignal erhalten absichtlich keinen Stream.
- Hidden oder Teil-disconnect entfernt nicht mehr benötigte ffmpeg-Tiers synchron, unabhängig von ausstehender CDP-Arbeit. Ein zweiter sichtbarer Zuschauer desselben Tiers behält seinen Encoder. Wiederanzeigen kann den normalen Startpfad benutzen. Beim letzten Socket greift weiterhin `end()`.
- Projektbrowser-/Devserverprozess, Agentenlock, viewport authority, BrowserIdle-Freeze und Qualitätsstufen bleiben unverändert. Normales Socket-Close wirkt sofort; verlorene Verbindungen behalten die bestehende WebSocket-Ping/Pong-Frist von30–60s. Eine eigene stale-Stats-/TTL-Architektur wird nicht eingeführt. Ein fremder Client, der fälschlich weiter sichtbar meldet und Pongs beantwortet, ist durch diesen Patch nicht als verborgen erkennbar.

## Lokale Abnahme und verbleibende Liveabnahme

Neue Serverregressionen: explizite Sichtbarkeit; letzter sichtbarer Viewer trotz hängender CDP-Modearbeit; zwei Viewer, hidden und letzter sichtbarer Disconnect; Resume und letzter Socket. Die ersten drei schlugen auf der alten Quelle fehl. Zwei tatsächliche React-Hook-Regressionsfälle gegen die alte7673-Quelle ebenfalls rot; neue Quelle grün. Router/Screencast/Video/Idle/Viewer insgesamt99/0; Webhook plus vorhandene Browserprotokolltests21/0. Es liefen nur lokale synthetische Tests, kein ffmpeg/X11/GPU/Provider.

Root prüft nach unabhängiger Review/Integration/Fullgate: Bei einer geöffneten Ansicht Stream, nach Schließen oder Hintergrundwechsel kein Router-ffmpeg für diesen Browser (falls kein anderer sichtbarer Zuschauer); Projektbrowser/Devserver bleiben aktiv. Wiederanzeigen liefert frische Frames. Zwei sichtbare Ansichten teilen den Encoder; das Schließen einer beendet nicht die andere. Browser-/Agentenarbeit und vorhandene Sitzung bleiben erreichbar. Ohne diese reale spätere Abnahme wird keine nachgewiesene CPU-Einsparung behauptet.
