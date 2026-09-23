# Volition integration

The integration service provisions project resources, routes mail and project-file operations, and exposes authenticated Connections and Vault metadata APIs.

- Connections reports Hermes, Nextcloud, and document-archive health. Only bounded probe actions are accepted.
- Vault inventory is Hermes metadata only. Values are never returned and changes are managed through Vaultwarden.
- Inbox triage is Mastra-only and read-only. It receives bounded, untrusted message data and returns validated JSON.
- Theme synchronization updates Code and Nextcloud. It does not call an agent runtime.

All bearer values are loaded from private files. Do not place credentials in this repository or service logs.
