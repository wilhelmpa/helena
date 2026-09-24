#!/usr/bin/env python3
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import stat
import subprocess
import sys
import tempfile
import time


STACK = Path("/home/pw/services/volition-stack")
BACKUPS = Path("/home/pw/services/volition-backups")
BACKUP_STAGING = BACKUPS / "current"
REPO = Path("/home/pw/services/itsaplan")
PROJECTS = Path("/home/pw/Projekte")
WORKSPACES = Path("/home/pw/services/volition-workspaces")
RESET_STATE = STACK / "reset-state"
BACKUP_MARKER = BACKUPS / "fresh-reset-marker.json"
PLAN_MARKER = RESET_STATE / "plan-reset.complete.json"
PREPARED_MARKER = RESET_STATE / "fresh-data-reset.prepared.json"
FINAL_ACCEPTANCE_MARKER = RESET_STATE / "fresh-runtime-acceptance.complete.json"
COMPLETE_MARKER = RESET_STATE / "fresh-data-reset.complete.json"
VAULT_UI_MARKER = RESET_STATE / "vault-ui-hidden.complete.json"
TRASH_FILES = Path("/home/pw/.local/share/Trash/files")
TRASH_INFO = Path("/home/pw/.local/share/Trash/info")
TRASH_ALLOWLIST = Path(__file__).resolve().parent / "legacy-trash-allowlist.json"
RESTIC_ENV = {
    "RESTIC_REPOSITORY": str(BACKUPS / "restic"),
    "RESTIC_PASSWORD_FILE": str(STACK / ".secrets/backup_restic_password"),
    "RESTIC_CACHE_DIR": str(BACKUPS / "cache"),
    "GOMEMLIMIT": "512MiB",
    "GOMAXPROCS": "2",
}
SNAPSHOT = re.compile(r"[0-9a-f]{64}")
CONFIRMATION = "ERASE_VOLITION_FRESH_DATA"
FINALIZE_CONFIRMATION = "FINALIZE_VOLITION_FRESH_DATA"
RESET_VERSION = "fresh-2026-09-22-v1"
SCRIPT_VERSION = "2"
BACKUP_SCOPE = (
    "/home/pw/services/volition-backups/current/application-volumes.tar",
    "/home/pw/services/volition-backups/current/database-counts.json",
    "/home/pw/services/volition-backups/current/garage-manifest.json",
    "/home/pw/services/volition-backups/current/garage-volumes.tar",
    "/home/pw/services/volition-backups/current/itsaplan.dump",
    "/home/pw/services/volition-backups/current/nextcloud.dump",
    "/home/pw/services/volition-backups/current/vaultwarden-volumes.tar",
    "/home/pw/services/volition-stack/.secrets/nextcloud_admin_password",
    "/home/pw/services/volition-stack/.secrets/nextcloud_db_password",
    "/home/pw/services/volition-stack/.secrets/redis_password",
    "/home/pw/services/volition-stack/.state/code-user-settings",
    "/home/pw/services/volition-stack/browser/profile",
    "/home/pw/services/volition-stack/config/gateway.json",
    "/home/pw/services/volition-stack/data/hermes/auth.json",
    "/home/pw/services/volition-workspaces/projects",
)


class ResetError(RuntimeError):
    pass


def utc_now():
    return dt.datetime.now(dt.timezone.utc)


def iso(value):
    return value.astimezone(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def parse_time(value):
    if not isinstance(value, str):
        raise ResetError("marker timestamp is missing")
    parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ResetError("marker timestamp must include a timezone")
    return parsed.astimezone(dt.timezone.utc)


def private_json(path):
    info = path.lstat()
    if path.is_symlink() or not stat.S_ISREG(info.st_mode):
        raise ResetError(f"unsafe marker type: {path}")
    if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077:
        raise ResetError(f"marker must be owned by the current user with mode 0600: {path}")
    return json.loads(path.read_text())


def atomic_private_file(path, value):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(path.parent, 0o700)
    descriptor, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temp = Path(temp_name)
    try:
        with os.fdopen(descriptor, "w") as handle:
            handle.write(value)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temp, 0o600)
        temp.replace(path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        temp.unlink(missing_ok=True)


def atomic_json(path, value):
    atomic_private_file(path, json.dumps(value, indent=2, sort_keys=True) + "\n")


def file_sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def run(command, *, capture=False, check=True, env=None):
    merged = {**os.environ, **(env or {})}
    return subprocess.run(
        command,
        check=check,
        text=True,
        capture_output=capture,
        env=merged,
        timeout=1800,
    )


def latest_snapshot():
    completed = run(
        ["restic", "snapshots", "--tag", "volition", "--json"],
        capture=True,
        env=RESTIC_ENV,
    )
    rows = json.loads(completed.stdout)
    if not rows:
        raise ResetError("latest encrypted backup snapshot is unavailable")
    latest = max(rows, key=lambda row: parse_time(row.get("time")))
    if not SNAPSHOT.fullmatch(latest.get("id", "")):
        raise ResetError("latest encrypted backup snapshot is invalid")
    return latest


def backup_success():
    value = json.loads((BACKUPS / "last-success").read_text())
    if value.get("schemaVersion") != 1 or not SNAPSHOT.fullmatch(value.get("snapshotId", "")):
        raise ResetError("backup success marker is invalid")
    if value.get("restoreProbeVerified") is not True or value.get("plaintextStagingEmpty") is not True:
        raise ResetError("backup success marker lacks restore or plaintext cleanup attestation")
    return parse_time(value.get("completedAt")), value["snapshotId"]


def backup_scope_digest():
    return hashlib.sha256(("\n".join(BACKUP_SCOPE) + "\n").encode()).hexdigest()


def verify_backup_scope(snapshot_id):
    completed = run(
        ["restic", "ls", "--json", snapshot_id, *BACKUP_SCOPE],
        capture=True,
        env=RESTIC_ENV,
    )
    found = set()
    for line in completed.stdout.splitlines():
        if not line.strip():
            continue
        value = json.loads(line)
        if value.get("struct_type") == "node":
            found.add(value.get("path"))
    missing = sorted(set(BACKUP_SCOPE) - found)
    if missing:
        raise ResetError("encrypted backup does not cover every fresh-reset scope")


def verify_backup_restore_probe(snapshot_id):
    try:
        counts = run(
            [
                "restic",
                "dump",
                snapshot_id,
                "/home/pw/services/volition-backups/current/database-counts.json",
            ],
            capture=True,
            env=RESTIC_ENV,
        )
        value = json.loads(counts.stdout)
    except (json.JSONDecodeError, subprocess.SubprocessError) as error:
        raise ResetError("encrypted backup restore probe failed") from error
    if not isinstance(value, dict) or set(value) != {"plan", "nextcloud"}:
        raise ResetError("restored database-count manifest is invalid")


def verify_legacy_plan_volumes_empty():
    for name in ("itsaplan_db-backups", "itsaplan_minio-data"):
        exists = run(["docker", "volume", "inspect", name], capture=True, check=False)
        if exists.returncode != 0:
            continue
        probe = run(
            [
                "docker",
                "run",
                "--rm",
                "--network",
                "none",
                "--read-only",
                "--security-opt",
                "no-new-privileges:true",
                "--cap-drop",
                "ALL",
                "--pids-limit",
                "16",
                "--memory",
                "64m",
                "-v",
                f"{name}:/data:ro",
                "--entrypoint",
                "/bin/sh",
                "postgres:17-alpine",
                "-c",
                "find /data -mindepth 1 -print -quit",
            ],
            capture=True,
        )
        if probe.stdout.strip():
            raise ResetError(f"legacy Plan volume is not empty: {name}")


def prepare_backup_marker(now=None):
    now = now or utc_now()
    run(["restic", "check", "--quiet"], env=RESTIC_ENV)
    snapshot = latest_snapshot()
    completed, success_id = backup_success()
    snapshot_time = parse_time(snapshot["time"])
    if success_id != snapshot["id"]:
        raise ResetError("backup success marker does not name the latest snapshot")
    if now - completed > dt.timedelta(hours=2):
        raise ResetError("latest successful encrypted backup is older than two hours")
    if abs((snapshot_time - completed).total_seconds()) > 15 * 60:
        raise ResetError("backup success marker does not match the latest snapshot")
    verify_backup_scope(snapshot["id"])
    verify_backup_restore_probe(snapshot["id"])
    marker = {
        "schemaVersion": 1,
        "resetVersion": RESET_VERSION,
        "scriptVersion": SCRIPT_VERSION,
        "snapshotId": snapshot["id"],
        "snapshotTime": iso(snapshot_time),
        "backupCompletedAt": iso(completed),
        "createdAt": iso(now),
        "expiresAt": iso(now + dt.timedelta(hours=6)),
        "repository": "encrypted-restic-volition",
        "scopeDigest": backup_scope_digest(),
    }
    atomic_json(BACKUP_MARKER, marker)
    return marker


def validate_backup_marker(marker, latest_id, last_success, last_success_id, now=None):
    now = now or utc_now()
    if marker.get("schemaVersion") != 1:
        raise ResetError("unsupported backup marker schema")
    if marker.get("resetVersion") != RESET_VERSION or marker.get("scriptVersion") != SCRIPT_VERSION:
        raise ResetError("backup marker version does not match this reset")
    snapshot_id = marker.get("snapshotId", "")
    if not SNAPSHOT.fullmatch(snapshot_id) or snapshot_id != latest_id:
        raise ResetError("backup marker does not name the latest encrypted snapshot")
    if parse_time(marker.get("backupCompletedAt")) != last_success:
        raise ResetError("backup marker does not match last-success")
    if snapshot_id != last_success_id:
        raise ResetError("backup marker does not use the successful snapshot")
    if marker.get("scopeDigest") != backup_scope_digest():
        raise ResetError("backup marker does not cover the current reset scope")
    created = parse_time(marker.get("createdAt"))
    expires = parse_time(marker.get("expiresAt"))
    if created > now + dt.timedelta(minutes=2) or now > expires:
        raise ResetError("backup marker is not current")
    if expires - created > dt.timedelta(hours=6, minutes=1):
        raise ResetError("backup marker validity is too long")
    return snapshot_id


def validate_plan_marker(marker, snapshot_id, now=None):
    now = now or utc_now()
    required = {
        "planDatabaseEmpty": True,
        "garageReset": True,
        "garageCredentialsRotated": True,
        "garageBucket": "planner-attachments",
        "garageObjectCount": 0,
        "planDbBackupsRemoved": True,
        "legacyMinioVolumeRemoved": True,
        "planDbBackupVolumeCount": 0,
        "legacyMinioObjectCount": 0,
        "homeSystemScopeReady": True,
        "homeChatProjectKey": "HOME",
        "visibleProjectCount": 0,
        "ownerCount": 1,
        "backupPlaintextStagingEmpty": True,
        "backupSnapshotId": snapshot_id,
    }
    if marker.get("schemaVersion") != 1:
        raise ResetError("unsupported Plan reset marker schema")
    if marker.get("resetVersion") != RESET_VERSION or not marker.get("scriptVersion"):
        raise ResetError("Plan reset marker version does not match this reset")
    for key, expected in required.items():
        if marker.get(key) != expected:
            raise ResetError(f"Plan reset marker failed requirement: {key}")
    completed = parse_time(marker.get("completedAt"))
    if completed > now + dt.timedelta(minutes=2) or now - completed > dt.timedelta(hours=6):
        raise ResetError("Plan reset marker is not current")


def validate_vault_ui_marker(marker, snapshot_id, now=None):
    now = now or utc_now()
    if marker.get("schemaVersion") != 1:
        raise ResetError("unsupported Vault UI marker schema")
    if marker.get("resetVersion") != RESET_VERSION or not marker.get("scriptVersion"):
        raise ResetError("Vault UI marker version does not match this reset")
    if marker.get("backupSnapshotId") != snapshot_id or marker.get("vaultUiHidden") is not True:
        raise ResetError("Vault UI is not attested hidden")
    image_id = marker.get("deployedWebImageId", "")
    if not isinstance(image_id, str) or re.fullmatch(r"sha256:[0-9a-f]{64}", image_id) is None:
        raise ResetError("Vault UI marker has no deployed web image identity")
    completed = parse_time(marker.get("completedAt"))
    if completed > now + dt.timedelta(minutes=2) or now - completed > dt.timedelta(hours=6):
        raise ResetError("Vault UI marker is not current")
    running = run(
        ["docker", "inspect", "--format", "{{.Image}}", "itsaplan-web-1"],
        capture=True,
    ).stdout.strip()
    if running != image_id:
        raise ResetError("Vault UI marker does not match the running web image")


def validate_completion_marker(marker):
    if marker.get("schemaVersion") != 1:
        raise ResetError("unsupported completion marker schema")
    if marker.get("resetVersion") != RESET_VERSION or marker.get("scriptVersion") != SCRIPT_VERSION:
        raise ResetError("completion marker belongs to a different reset version")
    required = {
        "resetComplete": True,
        "prepareComplete": True,
        "secretValuesExposed": False,
        "backupPlaintextStagingEmpty": True,
        "backupTimerActive": False,
        "browserProfileFresh": True,
        "browserProfileBlankBeforeStart": True,
        "codeWorkspaceFresh": True,
        "projectWorkspacesFresh": True,
        "legacyAppTrashPurged": True,
        "vaultEnabled": False,
        "vaultRoutePresent": False,
        "vaultUiHidden": True,
        "hermesDataFresh": True,
        "hermesRunnerActive": True,
        "nextcloudDataFresh": True,
        "nextcloudCredentialsRotated": True,
        "finalAcceptanceComplete": True,
        "planRunClaimAccepted": True,
        "planRunHeartbeatAccepted": True,
        "planRunResultAccepted": True,
        "agUiStreamAccepted": True,
        "agUiTerminalEventAccepted": True,
        "sessionResumeAccepted": True,
        "modelReasoningAccepted": True,
        "hermesProfilePersistent": True,
        "browserBlankBaselineAccepted": True,
        "browserRestartAccepted": True,
        "browserProfilePersistent": True,
        "noVncWebSocketAccepted": True,
    }
    if any(marker.get(key) != expected for key, expected in required.items()):
        raise ResetError("completion marker is incomplete")
    snapshot_id = marker.get("backupSnapshotId", "")
    if not SNAPSHOT.fullmatch(snapshot_id):
        raise ResetError("completion marker has an invalid backup snapshot")
    parse_time(marker.get("completedAt"))
    return snapshot_id


def prepared_payload(snapshot_id, browser_blank_at=None):
    now = utc_now()
    browser_blank_at = browser_blank_at or now
    return {
        "schemaVersion": 1,
        "resetVersion": RESET_VERSION,
        "scriptVersion": SCRIPT_VERSION,
        "preparedAt": iso(now),
        "backupSnapshotId": snapshot_id,
        "prepareComplete": True,
        "resetComplete": False,
        "secretValuesExposed": False,
        "backupPlaintextStagingEmpty": True,
        "backupTimerActive": False,
        "browserProfileFresh": True,
        "browserProfileBlankBeforeStart": True,
        "browserBlankVerifiedAt": iso(browser_blank_at),
        "codeWorkspaceFresh": True,
        "projectWorkspacesFresh": True,
        "legacyAppTrashPurged": True,
        "vaultEnabled": False,
        "vaultRoutePresent": False,
        "vaultUiHidden": True,
        "hermesBootstrapProvider": "copilot",
        "hermesDataFresh": True,
        "hermesRunnerActive": True,
        "nextcloudDataFresh": True,
        "nextcloudCredentialsRotated": True,
    }


def validate_prepared_marker(marker):
    if marker.get("schemaVersion") != 1:
        raise ResetError("unsupported prepared marker schema")
    if marker.get("resetVersion") != RESET_VERSION or marker.get("scriptVersion") != SCRIPT_VERSION:
        raise ResetError("prepared marker belongs to a different reset version")
    required = prepared_payload(marker.get("backupSnapshotId", ""))
    required.pop("preparedAt")
    required.pop("browserBlankVerifiedAt")
    for key, expected in required.items():
        if marker.get(key) != expected:
            raise ResetError(f"prepared marker failed requirement: {key}")
    snapshot_id = marker.get("backupSnapshotId", "")
    if not SNAPSHOT.fullmatch(snapshot_id):
        raise ResetError("prepared marker has an invalid backup snapshot")
    prepared_at = parse_time(marker.get("preparedAt"))
    blank_at = parse_time(marker.get("browserBlankVerifiedAt"))
    if blank_at > prepared_at:
        raise ResetError("browser blank baseline was not verified before Prepare completed")
    return snapshot_id


FINAL_ACCEPTANCE_REQUIREMENTS = {
    "planRunClaimAccepted": True,
    "planRunHeartbeatAccepted": True,
    "planRunResultAccepted": True,
    "agUiStreamAccepted": True,
    "agUiTerminalEventAccepted": True,
    "sessionResumeAccepted": True,
    "modelReasoningAccepted": True,
    "hermesRunnerActive": True,
    "hermesProfilePersistent": True,
    "browserBlankBaselineAccepted": True,
    "browserRestartAccepted": True,
    "browserProfilePersistent": True,
    "noVncWebSocketAccepted": True,
}


def acceptance_time(value, started_at, completed_at, label):
    parsed = parse_time(value)
    if parsed < started_at or parsed > completed_at:
        raise ResetError(f"final acceptance evidence is out of sequence: {label}")
    return parsed


def nonempty_id(value, label):
    if isinstance(value, int) and value > 0:
        return str(value)
    if isinstance(value, str) and value.strip():
        return value.strip()
    raise ResetError(f"final acceptance evidence is missing: {label}")


def validate_final_acceptance_evidence(evidence, prepared, started_at, completed_at):
    if not isinstance(evidence, dict) or set(evidence) != {"planRun", "agUi", "hermes", "browser"}:
        raise ResetError("final acceptance evidence sections are incomplete")
    plan = evidence["planRun"]
    agui = evidence["agUi"]
    hermes = evidence["hermes"]
    browser = evidence["browser"]
    if not all(isinstance(value, dict) for value in (plan, agui, hermes, browser)):
        raise ResetError("final acceptance evidence section is invalid")

    nonempty_id(plan.get("runId"), "planRun.runId")
    claimed = acceptance_time(plan.get("claimedAt"), started_at, completed_at, "planRun.claimedAt")
    heartbeat = acceptance_time(plan.get("heartbeatAt"), started_at, completed_at, "planRun.heartbeatAt")
    result = acceptance_time(plan.get("resultAt"), started_at, completed_at, "planRun.resultAt")
    if not claimed <= heartbeat <= result or plan.get("resultStatus") != "success":
        raise ResetError("Plan run acceptance sequence or result is invalid")

    nonempty_id(agui.get("threadId"), "agUi.threadId")
    first_message = nonempty_id(agui.get("firstMessageId"), "agUi.firstMessageId")
    second_message = nonempty_id(agui.get("secondMessageId"), "agUi.secondMessageId")
    session = nonempty_id(agui.get("sessionId"), "agUi.sessionId")
    resumed = nonempty_id(agui.get("resumedSessionId"), "agUi.resumedSessionId")
    acceptance_time(agui.get("streamStartedAt"), started_at, completed_at, "agUi.streamStartedAt")
    acceptance_time(agui.get("streamCompletedAt"), started_at, completed_at, "agUi.streamCompletedAt")
    if first_message == second_message or session != resumed:
        raise ResetError("AG-UI session resume evidence is invalid")
    if agui.get("terminalEventType") != "RUN_FINISHED" or agui.get("streamFrameCount", 0) < 2:
        raise ResetError("AG-UI stream has no successful terminal event")
    if agui.get("model") != "gpt-4.1" or agui.get("reasoning") != "medium":
        raise ResetError("AG-UI model and reasoning acceptance is invalid")

    acceptance_time(hermes.get("activeAt"), started_at, completed_at, "hermes.activeAt")
    acceptance_time(
        hermes.get("profileVerifiedAfterRestartAt"),
        started_at,
        completed_at,
        "hermes.profileVerifiedAfterRestartAt",
    )
    if SNAPSHOT.fullmatch(hermes.get("profileMarkerSha256", "")) is None:
        raise ResetError("Hermes profile persistence marker is invalid")

    blank = parse_time(browser.get("blankVerifiedAt"))
    if blank != parse_time(prepared.get("browserBlankVerifiedAt")):
        raise ResetError("browser blank baseline is not bound to Prepare")
    restarted = acceptance_time(browser.get("restartedAt"), started_at, completed_at, "browser.restartedAt")
    persisted = acceptance_time(browser.get("profileVerifiedAt"), started_at, completed_at, "browser.profileVerifiedAt")
    acceptance_time(browser.get("noVncVerifiedAt"), started_at, completed_at, "browser.noVncVerifiedAt")
    if not blank <= restarted <= persisted:
        raise ResetError("browser acceptance sequence is invalid")
    if SNAPSHOT.fullmatch(browser.get("profileMarkerSha256", "")) is None:
        raise ResetError("browser profile persistence marker is invalid")
    if browser.get("cdpEndpoint") != "http://127.0.0.1:9223":
        raise ResetError("browser CDP acceptance is not loopback-only")
    if browser.get("noVncWebSocketEndpoint") != "ws://127.0.0.1:6081/websockify":
        raise ResetError("noVNC acceptance is not loopback-only")


def validate_final_acceptance_marker(marker, prepared, prepared_digest, now=None):
    now = now or utc_now()
    if marker.get("schemaVersion") != 1:
        raise ResetError("unsupported final acceptance marker schema")
    if marker.get("resetVersion") != RESET_VERSION or marker.get("scriptVersion") != SCRIPT_VERSION:
        raise ResetError("final acceptance belongs to a different reset version")
    if marker.get("backupSnapshotId") != prepared.get("backupSnapshotId"):
        raise ResetError("final acceptance uses a different backup snapshot")
    if marker.get("preparedMarkerSha256") != prepared_digest:
        raise ResetError("final acceptance is not bound to the exact prepared state")
    prepared_at = parse_time(prepared.get("preparedAt"))
    started_at = parse_time(marker.get("startedAt"))
    completed_at = parse_time(marker.get("completedAt"))
    if started_at < prepared_at or completed_at < started_at:
        raise ResetError("final acceptance did not run after the rebuild")
    if completed_at > now + dt.timedelta(minutes=2) or now - completed_at > dt.timedelta(hours=2):
        raise ResetError("final acceptance is not current")
    for key, expected in FINAL_ACCEPTANCE_REQUIREMENTS.items():
        if marker.get(key) != expected:
            raise ResetError(f"final acceptance failed requirement: {key}")
    identities = marker.get("runtimeIdentities")
    required_identities = {"planApiImageId", "planWebImageId", "hermesUnitFragmentHash", "browserUnitSetHash"}
    if not isinstance(identities, dict) or set(identities) != required_identities:
        raise ResetError("final acceptance runtime identities are incomplete")
    if re.fullmatch(r"sha256:[0-9a-f]{64}", identities["planApiImageId"]) is None:
        raise ResetError("final acceptance Plan API image identity is invalid")
    if re.fullmatch(r"sha256:[0-9a-f]{64}", identities["planWebImageId"]) is None:
        raise ResetError("final acceptance Plan web image identity is invalid")
    if any(
        SNAPSHOT.fullmatch(identities[key]) is None
        for key in ("hermesUnitFragmentHash", "browserUnitSetHash")
    ):
        raise ResetError("final acceptance runtime identity is invalid")
    validate_final_acceptance_evidence(marker.get("evidence"), prepared, started_at, completed_at)
    return completed_at


def validate_live_markers():
    run(["restic", "check", "--quiet"], env=RESTIC_ENV)
    latest = latest_snapshot()
    last_success, last_success_id = backup_success()
    backup = private_json(BACKUP_MARKER)
    snapshot_id = validate_backup_marker(backup, latest["id"], last_success, last_success_id)
    verify_backup_scope(snapshot_id)
    verify_backup_restore_probe(snapshot_id)
    validate_plan_marker(private_json(PLAN_MARKER), snapshot_id)
    verify_legacy_plan_volumes_empty()
    validate_vault_ui_marker(private_json(VAULT_UI_MARKER), snapshot_id)
    return snapshot_id


def safe_path(path, allowed):
    resolved = path.resolve()
    roots = [candidate.resolve() for candidate in allowed]
    if resolved not in roots:
        raise ResetError(f"path is outside the reset allowlist: {resolved}")
    if resolved == BACKUPS.resolve() or (
        BACKUPS.resolve() in resolved.parents and resolved != BACKUP_STAGING.resolve()
    ):
        raise ResetError(f"path overlaps a protected scope: {resolved}")
    protected = [
        REPO.resolve(),
        PROJECTS.resolve(),
        Path.home().joinpath(".ssh").resolve(),
        Path("/etc").resolve(),
    ]
    if any(resolved == root or root in resolved.parents for root in protected):
        raise ResetError(f"path overlaps a protected scope: {resolved}")
    return resolved


def clear_directory(path, allowed):
    path = safe_path(path, allowed)
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    for child in path.iterdir():
        if child.is_dir() and not child.is_symlink():
            shutil.rmtree(child)
        else:
            child.unlink()
    os.chmod(path, 0o700)


def load_legacy_trash_allowlist():
    value = json.loads(TRASH_ALLOWLIST.read_text())
    entries = value.get("entries")
    if value.get("schemaVersion") != 1 or value.get("resetVersion") != RESET_VERSION:
        raise ResetError("legacy trash allowlist version is invalid")
    if not isinstance(entries, list) or not entries:
        raise ResetError("legacy trash allowlist is empty")
    if len(entries) != len(set(entries)) or any(
        not isinstance(name, str) or not name or Path(name).name != name or name in {".", ".."}
        for name in entries
    ):
        raise ResetError("legacy trash allowlist contains an unsafe entry")
    return entries


def purge_legacy_trash(entries):
    for name in entries:
        target = TRASH_FILES / name
        if target.is_dir() and not target.is_symlink():
            shutil.rmtree(target)
        else:
            target.unlink(missing_ok=True)
        (TRASH_INFO / f"{name}.trashinfo").unlink(missing_ok=True)
    for name in entries:
        if (TRASH_FILES / name).exists() or (TRASH_INFO / f"{name}.trashinfo").exists():
            raise ResetError(f"legacy trash entry remains after purge: {name}")


def verify_empty_directory(path):
    if path.is_symlink() or not path.is_dir() or any(path.iterdir()):
        raise ResetError(f"directory is not safely empty: {path}")


def copilot_only(auth):
    pool = auth.get("credential_pool") or {}
    copilot = pool.get("copilot")
    if not isinstance(copilot, list) or len(copilot) != 1:
        raise ResetError("exactly one Copilot bootstrap credential is required")
    return {
        "version": auth.get("version", 1),
        "providers": {},
        "credential_pool": {"copilot": copilot},
        "updated_at": iso(utc_now()),
    }


def atomic_secret(path):
    atomic_private_file(path, secrets.token_urlsafe(48) + "\n")


def remove_volume(name):
    exists = run(["docker", "volume", "inspect", name], capture=True, check=False)
    if exists.returncode == 0:
        run(["docker", "volume", "rm", name])


def service(*args, check=True, capture=False):
    return run(["systemctl", "--user", *args], check=check, capture=capture)


def compose(files, *args, project=None, check=True):
    command = ["docker", "compose"]
    if project:
        command += ["-p", project]
    for file in files:
        command += ["-f", str(file)]
    command += list(args)
    return run(command, check=check)


def disable_vault_route():
    path = STACK / "config/gateway.json"
    data = json.loads(path.read_text())
    routes = data.get("routes")
    if not isinstance(routes, dict):
        raise ResetError("gateway routes are invalid")
    routes.pop("vault.volition.one", None)
    atomic_json(path, data)


def verify_vault_disabled():
    data = json.loads((STACK / "config/gateway.json").read_text())
    if "vault.volition.one" in (data.get("routes") or {}):
        raise ResetError("Vault gateway route is still present")
    running = run(
        [
            "docker",
            "ps",
            "--filter",
            "name=volition-vault-vaultwarden-1",
            "--format",
            "{{.Names}}",
        ],
        capture=True,
    )
    if running.stdout.strip():
        raise ResetError("Vaultwarden is still running")


def write_fresh_hermes(home, auth):
    home.mkdir(mode=0o700, parents=True, exist_ok=True)
    for name in ("workspace", "sessions", "memories", "skills", "cron", "cache", "logs", "runtime"):
        (home / name).mkdir(mode=0o700)
    atomic_json(home / "auth.json", auth)
    config = """model:\n  default: gpt-4.1\n  provider: copilot\nagent:\n  reasoning_effort: medium\nbrowser:\n  cdp_url: http://127.0.0.1:9223\n_config_version: 45\n"""
    soul = "# HOME master\n\nUse this clean system scope for the Home chat. Keep project work and review state in Plan.\n"
    for path, value in ((home / "config.yaml", config), (home / "SOUL.md", soul)):
        path.write_text(value)
        os.chmod(path, 0o600)
    (home / ".no-bundled-skills").touch(mode=0o600)


def verify_hermes_bootstrap(auth):
    with tempfile.TemporaryDirectory(prefix="volition-hermes-accept-") as directory:
        home = Path(directory)
        write_fresh_hermes(home, auth)
        try:
            completed = run(
                [
                    "/home/pw/.local/bin/hermes",
                    "--provider",
                    "copilot",
                    "--model",
                    "gpt-4.1",
                    "--reasoning",
                    "none",
                    "--ignore-rules",
                    "-z",
                    "Reply exactly with HERMES_OK.",
                ],
                capture=True,
                env={"HERMES_HOME": str(home)},
            )
        except subprocess.CalledProcessError as error:
            raise ResetError("Hermes Copilot bootstrap acceptance failed") from error
        if completed.stdout.strip() != "HERMES_OK":
            raise ResetError("Hermes Copilot bootstrap returned an unexpected response")


def wait_healthy(container, timeout=180):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = run(
            ["docker", "inspect", "--format", "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}", container],
            capture=True,
            check=False,
        )
        if result.returncode == 0 and result.stdout.strip() in {"healthy", "running"}:
            return
        time.sleep(2)
    raise ResetError(f"service did not become healthy: {container}")


def wait_exited_success(container, timeout=300):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = run(
            ["docker", "inspect", "--format", "{{.State.Status}} {{.State.ExitCode}}", container],
            capture=True,
            check=False,
        )
        if result.returncode == 0:
            state = result.stdout.strip()
            if state == "exited 0":
                return
            if state.startswith("exited "):
                raise ResetError(f"one-shot service failed: {container}")
        time.sleep(2)
    raise ResetError(f"one-shot service did not finish: {container}")


def wait_active(unit, timeout=30, stable_seconds=5):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if service("is-active", "--quiet", unit, check=False).returncode == 0:
            time.sleep(stable_seconds)
            if service("is-active", "--quiet", unit, check=False).returncode == 0:
                return
        time.sleep(1)
    raise ResetError(f"service did not remain active: {unit}")


def reset_plan():
    return [
        "stop reset-sensitive timers and services",
        "stop Nextcloud, workspace, Vaultwarden, and standalone browser",
        "remove allowlisted Nextcloud, workspace Docker volumes",
        "clear Vaultwarden state, code settings, browser profile, IPC, and Hermes home",
        "clear app-generated project workspaces and recreate an empty project root",
        "purge only the versioned Paperless and legacy-app trash allowlist",
        "clear plaintext backup staging after encrypted restore probes",
        "rotate Nextcloud database, admin, and Redis secrets without printing values",
        "restore only the single Copilot credential into a fresh Hermes HOME master",
        "remove the local Vault gateway route and keep Vaultwarden stopped",
        "start fresh Nextcloud, workspace, and standalone browser services",
        "verify fresh services and write only a secret-free prepared marker",
        "run a separate post-rebuild E2E acceptance and finalize only when every gate passes",
    ]


def readiness(path, validator):
    try:
        if not path.exists():
            return {"ready": False, "reason": "missing"}
        validator(private_json(path))
        return {"ready": True}
    except Exception as error:
        return {"ready": False, "reason": type(error).__name__}


def dry_run():
    latest_id = None
    last_success = None
    last_success_id = None
    try:
        latest_id = latest_snapshot()["id"]
        last_success, last_success_id = backup_success()
    except Exception:
        pass

    backup = readiness(
        BACKUP_MARKER,
        lambda value: validate_backup_marker(
            value,
            latest_id or "",
            last_success or utc_now(),
            last_success_id or "",
        ),
    )
    snapshot_id = None
    if backup["ready"]:
        snapshot_id = private_json(BACKUP_MARKER)["snapshotId"]
    plan = readiness(PLAN_MARKER, lambda value: validate_plan_marker(value, snapshot_id or ""))
    vault_ui = readiness(
        VAULT_UI_MARKER,
        lambda value: validate_vault_ui_marker(value, snapshot_id or ""),
    )
    prepared = readiness(PREPARED_MARKER, validate_prepared_marker)
    acceptance = {"ready": False, "reason": "missing"}
    if prepared["ready"] and FINAL_ACCEPTANCE_MARKER.exists():
        try:
            prepared_value = private_json(PREPARED_MARKER)
            validate_final_acceptance_marker(
                private_json(FINAL_ACCEPTANCE_MARKER),
                prepared_value,
                file_sha256(PREPARED_MARKER),
            )
            acceptance = {"ready": True}
        except Exception as error:
            acceptance = {"ready": False, "reason": type(error).__name__}
    complete = readiness(COMPLETE_MARKER, validate_completion_marker)
    report = {
        "mode": "dry-run",
        "readyToExecute": backup["ready"] and plan["ready"] and vault_ui["ready"],
        "readyToFinalize": prepared["ready"] and acceptance["ready"],
        "markers": {
            "backup": backup,
            "plan": plan,
            "vaultUi": vault_ui,
            "prepared": prepared,
            "finalAcceptance": acceptance,
            "complete": complete,
        },
        "operations": reset_plan(),
        "protected": [
            "Cloudflare",
            "SSH",
            "owner login",
            "canonical repositories and /home/pw/Projekte working trees",
            "encrypted backup repository and password",
        ],
        "vaultAfterReset": "disabled-and-hidden",
        "secretValuesExposed": False,
    }
    print(json.dumps(report, indent=2, sort_keys=True))


def prepare_reset(snapshot_id):
    legacy_trash = load_legacy_trash_allowlist()
    hermes_home = STACK / "data/hermes"
    auth_path = hermes_home / "auth.json"
    if not auth_path.is_file():
        raise ResetError("Hermes auth store is missing")
    preserved_auth = copilot_only(json.loads(auth_path.read_text()))

    apps = STACK / "compose.apps.yml"
    vault = STACK / "compose.vault.yml"

    for unit in (
        "volition-backup.timer",
        "volition-backup.service",
        "volition-offsite.timer",
        "volition-offsite.service",
        "volition-artifact-sync.timer",
        "volition-artifact-sync.service",
        "volition-browser-ensure.timer",
        "volition-browser-ensure.service",
        "volition-provisioning.service",
        "volition-hermes-runner.service",
        "volition-standalone-browser.target",
    ):
        service("stop", unit, check=False)

    compose(
        [apps],
        "stop",
        "workspace",
        "nextcloud",
        "nextcloud-init",
        "nextcloud-cron",
        "nextcloud-db",
        "nextcloud-redis",
        project="volition-apps",
        check=False,
    )
    compose(
        [apps],
        "rm",
        "-sf",
        "workspace",
        "nextcloud",
        "nextcloud-init",
        "nextcloud-cron",
        "nextcloud-db",
        "nextcloud-redis",
        project="volition-apps",
        check=False,
    )
    compose([vault], "down", project="volition-vault", check=False)

    for name in (
        "volition-apps_workspace_home",
        "volition-apps_nextcloud_html",
        "volition-apps_nextcloud_data",
        "volition-nextcloud-db-alpine-20260921-v2",
        "volition-nextcloud-redis-alpine-20260921-v2",
        "volition-apps_nextcloud_db",
        "volition-apps_nextcloud_redis",
    ):
        remove_volume(name)

    allowed = [
        STACK / ".state/vaultwarden",
        STACK / ".state/code-user-settings",
        STACK / "browser/profile",
        STACK / "ipc",
        hermes_home,
        WORKSPACES,
        BACKUP_STAGING,
    ]
    for path in allowed:
        clear_directory(path, allowed)
    verify_empty_directory(STACK / "browser/profile")
    browser_blank_at = utc_now()
    project_root = WORKSPACES / "projects"
    itsaplan_workspace = project_root / "itsaplan"
    itsaplan_workspace.mkdir(mode=0o700, parents=True)
    os.chmod(project_root, 0o700)
    os.chmod(itsaplan_workspace, 0o700)
    purge_legacy_trash(legacy_trash)
    verify_empty_directory(BACKUP_STAGING)

    for name in ("nextcloud_db_password", "nextcloud_admin_password", "redis_password"):
        atomic_secret(STACK / ".secrets" / name)
    app_password = STACK / ".secrets/nextcloud_patrick_app_password"
    if app_password.exists():
        app_password.unlink()

    write_fresh_hermes(hermes_home, preserved_auth)
    disable_vault_route()

    for name in ("volition-nextcloud-db-alpine-20260921-v2", "volition-nextcloud-redis-alpine-20260921-v2"):
        run(["docker", "volume", "create", name])

    compose(
        [apps],
        "up",
        "-d",
        "workspace",
        "nextcloud-db",
        "nextcloud-redis",
        "nextcloud",
        "nextcloud-init",
        "nextcloud-cron",
        project="volition-apps",
    )
    service("start", "volition-standalone-browser.target")
    run(["docker", "restart", "volition-stack-gateway-1"])

    for container in (
        "volition-apps-workspace-1",
        "volition-apps-nextcloud-db-1",
        "volition-apps-nextcloud-redis-1",
        "volition-apps-nextcloud-1",
        "volition-apps-nextcloud-cron-1",
    ):
        wait_healthy(container)
    wait_exited_success("volition-apps-nextcloud-init-1")
    wait_healthy("volition-stack-gateway-1", timeout=60)
    verify_vault_disabled()
    run([str(STACK / "browser/bin/probe")])

    auth_check = copilot_only(json.loads((hermes_home / "auth.json").read_text()))
    if set(auth_check["credential_pool"]) != {"copilot"}:
        raise ResetError("fresh Hermes auth store contains an unexpected provider")
    verify_hermes_bootstrap(auth_check)

    service("start", "volition-hermes-runner.service")
    wait_active("volition-hermes-runner.service")
    service("start", "volition-offsite.timer")
    verify_empty_directory(BACKUP_STAGING)
    if service("is-active", "--quiet", "volition-backup.timer", check=False).returncode == 0:
        raise ResetError("backup timer restarted before plaintext staging was hardened")

    atomic_json(PREPARED_MARKER, prepared_payload(snapshot_id, browser_blank_at))


def unit_fragment_hash(unit):
    fragment = service("show", "--property=FragmentPath", "--value", unit, check=False, capture=True)
    path = Path(fragment.stdout.strip())
    if fragment.returncode != 0 or not path.is_file():
        raise ResetError(f"runtime unit fragment is unavailable: {unit}")
    return file_sha256(path)


def browser_unit_set_hash():
    digest = hashlib.sha256()
    for unit in (
        "volition-standalone-browser.target",
        "volition-browser-xvfb.service",
        "volition-browser-chromium.service",
        "volition-browser-vnc.service",
        "volition-browser-novnc.service",
    ):
        fragment = service("show", "--property=FragmentPath", "--value", unit, check=False, capture=True)
        path = Path(fragment.stdout.strip())
        if fragment.returncode != 0 or not path.is_file():
            raise ResetError(f"browser unit fragment is unavailable: {unit}")
        digest.update(unit.encode() + b"\0" + path.read_bytes() + b"\0")
    return digest.hexdigest()


def current_runtime_identities():
    identities = {}
    for key, container in (("planApiImageId", "itsaplan-api-1"), ("planWebImageId", "itsaplan-web-1")):
        value = run(["docker", "inspect", "--format", "{{.Image}}", container], capture=True).stdout.strip()
        if re.fullmatch(r"sha256:[0-9a-f]{64}", value) is None:
            raise ResetError(f"runtime image identity is invalid: {container}")
        identities[key] = value
    identities["hermesUnitFragmentHash"] = unit_fragment_hash("volition-hermes-runner.service")
    identities["browserUnitSetHash"] = browser_unit_set_hash()
    return identities


def verify_final_live_state(expected_identities=None):
    verify_empty_directory(BACKUP_STAGING)
    verify_vault_disabled()
    verify_legacy_plan_volumes_empty()
    if service("is-active", "--quiet", "volition-backup.timer", check=False).returncode == 0:
        raise ResetError("backup timer is active before its staging cleanup is hardened")
    wait_active("volition-hermes-runner.service")
    run([str(STACK / "browser/bin/probe")])
    auth = copilot_only(json.loads((STACK / "data/hermes/auth.json").read_text()))
    if set(auth["credential_pool"]) != {"copilot"}:
        raise ResetError("Hermes credential boundary drifted")
    config = (STACK / "data/hermes/config.yaml").read_text()
    for expected in ("default: gpt-4.1", "provider: copilot", "reasoning_effort: medium"):
        if expected not in config:
            raise ResetError("Hermes model or reasoning configuration drifted")
    for container in (
        "volition-apps-workspace-1",
        "volition-apps-nextcloud-db-1",
        "volition-apps-nextcloud-redis-1",
        "volition-apps-nextcloud-1",
        "volition-apps-nextcloud-cron-1",
    ):
        wait_healthy(container, timeout=30)
    if expected_identities is not None and current_runtime_identities() != expected_identities:
        raise ResetError("runtime identities changed after final acceptance")


def finalize_reset(prepared, acceptance):
    snapshot_id = validate_prepared_marker(prepared)
    prepared_digest = file_sha256(PREPARED_MARKER)
    validate_final_acceptance_marker(acceptance, prepared, prepared_digest)
    verify_final_live_state(acceptance["runtimeIdentities"])
    completed = {
        **prepared,
        **{key: acceptance[key] for key in FINAL_ACCEPTANCE_REQUIREMENTS},
        "preparedMarkerSha256": prepared_digest,
        "finalAcceptanceMarkerSha256": file_sha256(FINAL_ACCEPTANCE_MARKER),
        "finalAcceptanceCompletedAt": acceptance["completedAt"],
        "runtimeIdentities": acceptance["runtimeIdentities"],
        "completedAt": iso(utc_now()),
        "backupSnapshotId": snapshot_id,
        "prepareComplete": True,
        "finalAcceptanceComplete": True,
        "resetComplete": True,
    }
    atomic_json(COMPLETE_MARKER, completed)


def main(argv=None):
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--execute", action="store_true")
    mode.add_argument("--finalize", action="store_true")
    mode.add_argument("--prepare-backup-marker", action="store_true")
    parser.add_argument("--confirm", default="")
    args = parser.parse_args(argv)

    if args.prepare_backup_marker:
        marker = prepare_backup_marker()
        print(json.dumps({"ok": True, "marker": str(BACKUP_MARKER), "expiresAt": marker["expiresAt"]}))
        return 0
    if not args.execute:
        if args.finalize:
            if args.confirm != FINALIZE_CONFIRMATION:
                raise ResetError("finalization requires the exact confirmation string")
            if COMPLETE_MARKER.exists():
                snapshot_id = validate_completion_marker(private_json(COMPLETE_MARKER))
                complete = private_json(COMPLETE_MARKER)
                verify_final_live_state(complete.get("runtimeIdentities"))
                print(
                    json.dumps(
                        {
                            "ok": True,
                            "alreadyComplete": True,
                            "backupSnapshotId": snapshot_id,
                            "completionMarker": str(COMPLETE_MARKER),
                            "livePostconditionsVerified": True,
                        }
                    )
                )
                return 0
            if not PREPARED_MARKER.exists():
                raise ResetError("finalization requires a prepared reset marker")
            if not FINAL_ACCEPTANCE_MARKER.exists():
                raise ResetError("finalization requires a post-rebuild E2E acceptance marker")
            finalize_reset(private_json(PREPARED_MARKER), private_json(FINAL_ACCEPTANCE_MARKER))
            print(json.dumps({"ok": True, "completionMarker": str(COMPLETE_MARKER)}))
            return 0
        dry_run()
        return 0
    if args.confirm != CONFIRMATION:
        raise ResetError("execution requires the exact confirmation string")
    if COMPLETE_MARKER.exists():
        snapshot_id = validate_completion_marker(private_json(COMPLETE_MARKER))
        complete = private_json(COMPLETE_MARKER)
        verify_final_live_state(complete.get("runtimeIdentities"))
        print(
            json.dumps(
                {
                    "ok": True,
                    "alreadyComplete": True,
                    "backupSnapshotId": snapshot_id,
                    "completionMarker": str(COMPLETE_MARKER),
                    "livePostconditionsVerified": True,
                }
            )
        )
        return 0
    if PREPARED_MARKER.exists():
        snapshot_id = validate_prepared_marker(private_json(PREPARED_MARKER))
        print(
            json.dumps(
                {
                    "ok": True,
                    "alreadyPrepared": True,
                    "backupSnapshotId": snapshot_id,
                    "preparedMarker": str(PREPARED_MARKER),
                }
            )
        )
        return 0
    snapshot_id = validate_live_markers()
    prepare_reset(snapshot_id)
    print(json.dumps({"ok": True, "preparedMarker": str(PREPARED_MARKER)}))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ResetError as error:
        print(json.dumps({"ok": False, "error": str(error)}), file=sys.stderr)
        raise SystemExit(1)
