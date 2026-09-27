# One original key for a decision connection

A `decision_model` can explicitly select an existing `api_key` with
`keySource: "credential"` and `sourceCredentialId`. Helena reads the original key for
each call; rotating it there takes effect without synchronizing a second copy.
Existing direct keys (`stored`), local Laya and local AI remain supported. There is
no schema migration and no automatic conversion of existing credentials.

Only the existing credential managers can select a source. The source must belong
to the same team and either the whole team or the connection's own project. A
team-wide connection cannot use a project key. The manager-only source picker
returns IDs, labels and project metadata, never key values. It does not create or
alter grants, environment variables or runner access.

Save and runtime both check scope and source kind. Every referenced call reloads
the destination metadata and source. A removed, invalid, changed-kind, foreign or
newly restricted source fails with a fixed error before the provider is called;
there is no old-copy fallback. A stale destination scope or reference is refused
too. Team-wide decision classes recheck that their primary and fallback
connections remain team-wide after configuration changes. They can still fall
back to another independently valid configured connection.

Switching an existing direct connection to a reference removes its encrypted
copy. Existing bounded secret-mask retention still covers the old value for
in-flight work. Switching back to a key-required direct connection requires a
freshly supplied key. Source rotations retain the normal mask protection. Errors
from SDKs, decryption and arbitrary local resolvers remain redacted; only a closed
set of locally defined policy messages (including Local AI switched off) is shown.

## Root rollout

1. Integrate and pass the regular release gate; deploy in the established order.
2. In **Zugänge**, inspect the original API-key and decision-connection metadata,
   including their team and project. Do not fetch or print either secret. Select
   **Vorhandenen API-Schlüssel verwenden** on the decision connection and choose
   the original. Equivalent existing manager PATCH body:
   `{"keySource":"credential","sourceCredentialId":<original-id>}`.
3. Confirm the response names the source ID and has an empty `secrets` list. Check
   Browser 2.0 lists the reference as having a key. Saved health still represents
   the last connection test; only the runtime check proves current validity.
4. Run the separately authorized synthetic connection test and inspect only its
   status/model/latency. No genuine key rotation, deletion or project move is
   needed for live acceptance; those cases are covered using dummy fixtures.

This patch performs no live configuration, provider call or installation. The
existing TypeSafe original/decision pair is converted explicitly by Root after
integration, not by a guessed-ID migration.

## Verification

Private loopback tests cover rotation without copying, masking, save/runtime team
and project boundaries, missing/deleted/malformed/wrong-kind sources, stale
destination/reference snapshots, manager-only source selection, direct-key
compatibility and safe local policy errors. Separate decision-class regressions
move both destinations and both sources after activation, covering primary and
fallback without resaving class settings. Web form tests check explicit selection,
metadata roundtrip and omission of any stale typed key. The actual Local-AI
integration test also verifies its previously hidden policy message.
