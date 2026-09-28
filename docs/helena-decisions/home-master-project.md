# Home als Master-Projekt

Home ist die projektübergreifende Ebene in der Oberfläche. Ihr Baum führt zu den
bestehenden globalen Seiten: Aufgaben (`/tasks`), Wissen (`/files`), Dashboard
(`/`, bisherige Startseite), System (`/system`), Team (`/organization`),
Zeitpläne (`/schedules`), Verlauf (`/activity`) und Einstellungen. `/chat` bleibt
der Home-Chat. Alte URLs bleiben erreichbar. Das Owner-Terminal wird weiterhin
über den Home-Kontext ohne Projektkennung geöffnet; seine Freigaben gehören dem
Owner.

Die technische Home-Projektzeile trägt `project.project_role = 'home'`; ein
partieller eindeutiger Index erlaubt höchstens eine solche Zeile pro Instanz.
Der bisherige `HOME`-Datensatz wird in Migration 0199 übernommen. Der Bootstrap
des Factory-Reset setzt die Rolle über einen Insert-Trigger; die
Anwendung entscheidet danach anhand der Rolle, nicht anhand des Projektschlüssels.
Die globale Navigation bleibt auch in Installationen ohne technische
Home-Projektzeile verfügbar.

Der Home-Agent trägt `ai_agent.agent_role = 'home'`. Diese Rolle kennzeichnet
Home-spezifische Verbindungen wie den Home-Browser und das Organigramm.
`ai_agent.project_scope = 'all'` ist eine **unabhängige** Agenten-Einstellung:
Sie fügt den Agenten allen jetzigen und künftigen Projekten seines Teams als
Mitglied hinzu. Die Mitgliedschaft mit ihrer jeweiligen Teamrolle bleibt die
Quelle seiner Rechte; vorhandene Rollen werden beim Hinzufügen nicht ersetzt.
Nur Team-Owner und -Manager können den Umfang `all` vergeben oder ändern. Ein expliziter Aufruf
von `set_ai_agent_projects` stellt auf `selected` um. Migration 0199 übernimmt
die Reichweite des bisherigen Home-Agenten. `master` ist danach nur noch ein
reservierter Mention-Handle und ein Bootstrap-Kennzeichen.
