import datetime as dt
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fresh_reset
import final_acceptance


class FreshResetTest(unittest.TestCase):
    def setUp(self):
        self.now = dt.datetime(2026, 9, 22, 12, 0, tzinfo=dt.timezone.utc)
        self.snapshot = "a" * 64

    def backup_marker(self):
        return {
            "schemaVersion": 1,
            "resetVersion": fresh_reset.RESET_VERSION,
            "scriptVersion": fresh_reset.SCRIPT_VERSION,
            "snapshotId": self.snapshot,
            "backupCompletedAt": "2026-09-22T11:45:00Z",
            "createdAt": "2026-09-22T11:50:00Z",
            "expiresAt": "2026-09-22T17:50:00Z",
            "scopeDigest": fresh_reset.backup_scope_digest(),
        }

    def test_accepts_current_backup_marker(self):
        value = fresh_reset.validate_backup_marker(
            self.backup_marker(),
            self.snapshot,
            dt.datetime(2026, 9, 22, 11, 45, tzinfo=dt.timezone.utc),
            self.snapshot,
            self.now,
        )
        self.assertEqual(value, self.snapshot)

    def test_rejects_stale_backup_marker(self):
        marker = self.backup_marker()
        marker["expiresAt"] = "2026-09-22T11:59:59Z"
        with self.assertRaises(fresh_reset.ResetError):
            fresh_reset.validate_backup_marker(
                marker,
                self.snapshot,
                dt.datetime(2026, 9, 22, 11, 45, tzinfo=dt.timezone.utc),
                self.snapshot,
                self.now,
            )

    def test_plan_marker_requires_empty_rotated_garage_and_home_scope(self):
        marker = {
            "schemaVersion": 1,
            "resetVersion": fresh_reset.RESET_VERSION,
            "scriptVersion": "plan-1",
            "completedAt": "2026-09-22T11:55:00Z",
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
            "backupSnapshotId": self.snapshot,
        }
        fresh_reset.validate_plan_marker(marker, self.snapshot, self.now)
        marker["garageObjectCount"] = 1
        with self.assertRaises(fresh_reset.ResetError):
            fresh_reset.validate_plan_marker(marker, self.snapshot, self.now)
        marker["garageObjectCount"] = 0
        marker["homeChatProjectKey"] = "PRIV"
        with self.assertRaises(fresh_reset.ResetError):
            fresh_reset.validate_plan_marker(marker, self.snapshot, self.now)

    def test_backup_success_reads_json_marker(self):
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(
            fresh_reset, "BACKUPS", Path(directory)
        ):
            (Path(directory) / "last-success").write_text(
                json.dumps(
                    {
                        "schemaVersion": 1,
                        "completedAt": "2026-09-22T11:45:00Z",
                        "snapshotId": self.snapshot,
                        "restoreProbeVerified": True,
                        "plaintextStagingEmpty": True,
                    }
                )
            )
            completed, snapshot_id = fresh_reset.backup_success()
            self.assertEqual(completed, dt.datetime(2026, 9, 22, 11, 45, tzinfo=dt.timezone.utc))
            self.assertEqual(snapshot_id, self.snapshot)

    def test_backup_scope_fails_when_an_archive_is_missing(self):
        rows = [
            json.dumps({"struct_type": "node", "path": path})
            for path in fresh_reset.BACKUP_SCOPE
            if not path.endswith("/vaultwarden-volumes.tar")
        ]
        with mock.patch.object(fresh_reset, "run", return_value=mock.Mock(stdout="\n".join(rows))):
            with self.assertRaises(fresh_reset.ResetError):
                fresh_reset.verify_backup_scope(self.snapshot)

    def test_backup_restore_probe_checks_manifest(self):
        counts = mock.Mock(stdout=json.dumps({"plan": "0,0,0,0,0", "nextcloud": "0,0,0"}))
        with mock.patch.object(fresh_reset, "run", return_value=counts):
            fresh_reset.verify_backup_restore_probe(self.snapshot)

    def test_backup_restore_probe_rejects_wrong_manifest(self):
        counts = mock.Mock(stdout=json.dumps({"plan": "0,0,0,0,0"}))
        with mock.patch.object(fresh_reset, "run", return_value=counts):
            with self.assertRaises(fresh_reset.ResetError):
                fresh_reset.verify_backup_restore_probe(self.snapshot)

    def test_legacy_plan_volume_probe_rejects_remaining_data(self):
        responses = [
            mock.Mock(returncode=0),
            mock.Mock(stdout="/data/plain.dump\n"),
        ]
        with mock.patch.object(fresh_reset, "run", side_effect=responses):
            with self.assertRaises(fresh_reset.ResetError):
                fresh_reset.verify_legacy_plan_volumes_empty()

    def test_legacy_plan_volume_probe_accepts_absent_volumes(self):
        with mock.patch.object(
            fresh_reset,
            "run",
            side_effect=[mock.Mock(returncode=1), mock.Mock(returncode=1)],
        ):
            fresh_reset.verify_legacy_plan_volumes_empty()

    def test_latest_snapshot_uses_newest_time_across_path_groups(self):
        rows = [
            {"id": "b" * 64, "time": "2026-09-21T12:00:00Z"},
            {"id": self.snapshot, "time": "2026-09-22T12:00:00Z"},
        ]
        with mock.patch.object(
            fresh_reset,
            "run",
            return_value=mock.Mock(stdout=json.dumps(rows)),
        ):
            self.assertEqual(fresh_reset.latest_snapshot()["id"], self.snapshot)

    def test_vault_ui_marker_must_match_running_image(self):
        marker = {
            "schemaVersion": 1,
            "resetVersion": fresh_reset.RESET_VERSION,
            "scriptVersion": "web-1",
            "completedAt": "2026-09-22T11:55:00Z",
            "backupSnapshotId": self.snapshot,
            "vaultUiHidden": True,
            "deployedWebImageId": "sha256:" + "d" * 64,
        }
        with mock.patch.object(
            fresh_reset,
            "run",
            return_value=mock.Mock(stdout="sha256:" + "d" * 64 + "\n"),
        ):
            fresh_reset.validate_vault_ui_marker(marker, self.snapshot, self.now)
        marker["deployedWebImageId"] = "sha256:" + "e" * 64
        with mock.patch.object(
            fresh_reset,
            "run",
            return_value=mock.Mock(stdout="sha256:" + "d" * 64 + "\n"),
        ):
            with self.assertRaises(fresh_reset.ResetError):
                fresh_reset.validate_vault_ui_marker(marker, self.snapshot, self.now)

    def test_legacy_trash_purge_removes_only_allowlisted_entries(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            files = root / "files"
            info = root / "info"
            files.mkdir()
            info.mkdir()
            (files / "paperless.dump").write_text("legacy")
            (info / "paperless.dump.trashinfo").write_text("metadata")
            (files / "keep.txt").write_text("keep")
            with mock.patch.object(fresh_reset, "TRASH_FILES", files), mock.patch.object(
                fresh_reset, "TRASH_INFO", info
            ):
                fresh_reset.purge_legacy_trash(["paperless.dump"])
            self.assertFalse((files / "paperless.dump").exists())
            self.assertFalse((info / "paperless.dump.trashinfo").exists())
            self.assertEqual((files / "keep.txt").read_text(), "keep")

    def test_legacy_trash_allowlist_rejects_path_traversal(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "allowlist.json"
            path.write_text(
                json.dumps(
                    {
                        "schemaVersion": 1,
                        "resetVersion": fresh_reset.RESET_VERSION,
                        "entries": ["../outside"],
                    }
                )
            )
            with mock.patch.object(fresh_reset, "TRASH_ALLOWLIST", path):
                with self.assertRaises(fresh_reset.ResetError):
                    fresh_reset.load_legacy_trash_allowlist()

    def test_copilot_is_the_only_preserved_credential(self):
        source = {
            "version": 3,
            "providers": {"openrouter": {"token": "discard"}},
            "credential_pool": {
                "copilot": [{"api_key": "preserve", "source": "gh_cli"}],
                "other": [{"api_key": "discard"}],
            },
        }
        result = fresh_reset.copilot_only(source)
        self.assertEqual(set(result["credential_pool"]), {"copilot"})
        self.assertEqual(result["providers"], {})
        self.assertNotIn("discard", json.dumps(result))

    def test_safe_path_rejects_repo_and_backup(self):
        with self.assertRaises(fresh_reset.ResetError):
            fresh_reset.safe_path(fresh_reset.REPO, [fresh_reset.REPO])
        with self.assertRaises(fresh_reset.ResetError):
            fresh_reset.safe_path(fresh_reset.BACKUPS, [fresh_reset.BACKUPS])
        self.assertEqual(
            fresh_reset.safe_path(fresh_reset.BACKUP_STAGING, [fresh_reset.BACKUP_STAGING]),
            fresh_reset.BACKUP_STAGING.resolve(),
        )
        with self.assertRaises(fresh_reset.ResetError):
            fresh_reset.safe_path(fresh_reset.PROJECTS, [fresh_reset.PROJECTS])

    def test_private_json_rejects_group_readable_marker(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "marker.json"
            path.write_text("{}")
            path.chmod(0o640)
            with self.assertRaises(fresh_reset.ResetError):
                fresh_reset.private_json(path)

    def test_atomic_private_file_replaces_symlink_without_following_it(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            victim = root / "victim"
            victim.write_text("unchanged")
            path = root / "secret"
            path.symlink_to(victim)
            fresh_reset.atomic_private_file(path, "replacement")
            self.assertEqual(victim.read_text(), "unchanged")
            self.assertFalse(path.is_symlink())
            self.assertEqual(path.read_text(), "replacement")
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_fresh_hermes_home_contains_no_old_runtime_state(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory) / "hermes"
            auth = fresh_reset.copilot_only(
                {"credential_pool": {"copilot": [{"api_key": "preserve"}]}}
            )
            fresh_reset.write_fresh_hermes(home, auth)
            self.assertEqual(
                {path.name for path in home.iterdir()},
                {
                    "workspace",
                    "sessions",
                    "memories",
                    "skills",
                    "cron",
                    "cache",
                    "logs",
                    "runtime",
                    "auth.json",
                    "config.yaml",
                    "SOUL.md",
                    ".no-bundled-skills",
                },
            )
            self.assertEqual(set(json.loads((home / "auth.json").read_text())["credential_pool"]), {"copilot"})
            self.assertNotIn("mcp_servers", (home / "config.yaml").read_text())

    def test_hermes_acceptance_requires_exact_response(self):
        accepted = mock.Mock(stdout="HERMES_OK\n")
        with mock.patch.object(fresh_reset, "run", return_value=accepted):
            fresh_reset.verify_hermes_bootstrap(
                fresh_reset.copilot_only(
                    {"credential_pool": {"copilot": [{"api_key": "preserve"}]}}
                )
            )
        rejected = mock.Mock(stdout="different\n")
        with mock.patch.object(fresh_reset, "run", return_value=rejected):
            with self.assertRaises(fresh_reset.ResetError):
                fresh_reset.verify_hermes_bootstrap(
                    fresh_reset.copilot_only(
                        {"credential_pool": {"copilot": [{"api_key": "preserve"}]}}
                    )
                )

    def test_dry_run_does_not_expose_secrets(self):
        output = io.StringIO()
        with mock.patch.object(fresh_reset, "latest_snapshot", side_effect=RuntimeError), mock.patch(
            "sys.stdout", output
        ):
            fresh_reset.dry_run()
        report = json.loads(output.getvalue())
        self.assertEqual(report["mode"], "dry-run")
        self.assertFalse(report["secretValuesExposed"])
        self.assertNotIn("api_key", output.getvalue())

    def test_execute_requires_confirmation_before_marker_validation(self):
        with mock.patch.object(fresh_reset, "validate_live_markers") as validate:
            with self.assertRaises(fresh_reset.ResetError):
                fresh_reset.main(["--execute"])
            validate.assert_not_called()

    def test_execute_is_idempotent_after_matching_completion_marker(self):
        output = io.StringIO()
        with tempfile.TemporaryDirectory() as directory:
            marker_path = Path(directory) / "complete.json"
            fresh_reset.atomic_json(
                marker_path,
                {
                    "schemaVersion": 1,
                    "resetVersion": fresh_reset.RESET_VERSION,
                    "scriptVersion": fresh_reset.SCRIPT_VERSION,
                    "completedAt": "2026-09-22T12:00:00Z",
                    "backupSnapshotId": self.snapshot,
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
                },
            )
            with mock.patch.object(fresh_reset, "COMPLETE_MARKER", marker_path), mock.patch.object(
                fresh_reset, "validate_live_markers"
            ) as validate, mock.patch.object(fresh_reset, "prepare_reset") as execute, mock.patch.object(
                fresh_reset, "verify_final_live_state"
            ), mock.patch("sys.stdout", output
            ):
                result = fresh_reset.main(
                    ["--execute", "--confirm", fresh_reset.CONFIRMATION]
                )
            self.assertEqual(result, 0)
            self.assertTrue(json.loads(output.getvalue())["alreadyComplete"])
            validate.assert_not_called()
            execute.assert_not_called()


    def test_prepared_marker_is_versioned_and_not_complete(self):
        marker = fresh_reset.prepared_payload(self.snapshot)
        marker["preparedAt"] = "2026-09-22T12:00:00Z"
        marker["browserBlankVerifiedAt"] = "2026-09-22T11:59:00Z"
        self.assertEqual(fresh_reset.validate_prepared_marker(marker), self.snapshot)
        self.assertTrue(marker["prepareComplete"])
        self.assertFalse(marker["resetComplete"])

    def test_final_acceptance_must_follow_and_bind_exact_prepare(self):
        prepared = fresh_reset.prepared_payload(self.snapshot)
        prepared["preparedAt"] = "2026-09-22T12:00:00Z"
        prepared["browserBlankVerifiedAt"] = "2026-09-22T11:59:00Z"
        acceptance = {
            "schemaVersion": 1,
            "resetVersion": fresh_reset.RESET_VERSION,
            "scriptVersion": fresh_reset.SCRIPT_VERSION,
            "backupSnapshotId": self.snapshot,
            "preparedMarkerSha256": "d" * 64,
            "startedAt": "2026-09-22T12:01:00Z",
            "completedAt": "2026-09-22T12:10:00Z",
            "runtimeIdentities": {
                "planApiImageId": "sha256:" + "1" * 64,
                "planWebImageId": "sha256:" + "2" * 64,
                "hermesUnitFragmentHash": "3" * 64,
                "browserUnitSetHash": "4" * 64,
            },
            "evidence": {
                "planRun": {
                    "runId": "run-1",
                    "claimedAt": "2026-09-22T12:02:00Z",
                    "heartbeatAt": "2026-09-22T12:03:00Z",
                    "resultAt": "2026-09-22T12:04:00Z",
                    "resultStatus": "success",
                },
                "agUi": {
                    "threadId": "thread-1",
                    "firstMessageId": "message-1",
                    "secondMessageId": "message-2",
                    "sessionId": "session-1",
                    "resumedSessionId": "session-1",
                    "streamStartedAt": "2026-09-22T12:04:00Z",
                    "streamCompletedAt": "2026-09-22T12:05:00Z",
                    "terminalEventType": "RUN_FINISHED",
                    "streamFrameCount": 3,
                    "model": "gpt-4.1",
                    "reasoning": "medium",
                },
                "hermes": {
                    "activeAt": "2026-09-22T12:06:00Z",
                    "profileVerifiedAfterRestartAt": "2026-09-22T12:07:00Z",
                    "profileMarkerSha256": "5" * 64,
                },
                "browser": {
                    "blankVerifiedAt": "2026-09-22T11:59:00Z",
                    "restartedAt": "2026-09-22T12:08:00Z",
                    "profileVerifiedAt": "2026-09-22T12:09:00Z",
                    "profileMarkerSha256": "6" * 64,
                    "cdpEndpoint": "http://127.0.0.1:9223",
                    "noVncWebSocketEndpoint": "ws://127.0.0.1:6081/websockify",
                    "noVncVerifiedAt": "2026-09-22T12:09:30Z",
                },
            },
            **fresh_reset.FINAL_ACCEPTANCE_REQUIREMENTS,
        }
        fresh_reset.validate_final_acceptance_marker(
            acceptance,
            prepared,
            "d" * 64,
            dt.datetime(2026, 9, 22, 12, 11, tzinfo=dt.timezone.utc),
        )
        acceptance["startedAt"] = "2026-09-22T11:59:59Z"
        with self.assertRaises(fresh_reset.ResetError):
            fresh_reset.validate_final_acceptance_marker(
                acceptance,
                prepared,
                "d" * 64,
                dt.datetime(2026, 9, 22, 12, 11, tzinfo=dt.timezone.utc),
            )

    def test_finalize_refuses_missing_prepared_marker(self):
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(
            fresh_reset, "PREPARED_MARKER", Path(directory) / "missing-prepared.json"
        ), mock.patch.object(
            fresh_reset, "COMPLETE_MARKER", Path(directory) / "missing-complete.json"
        ):
            with self.assertRaises(fresh_reset.ResetError):
                fresh_reset.main(["--finalize", "--confirm", fresh_reset.FINALIZE_CONFIRMATION])

    def test_acceptance_harness_is_dry_run_by_default(self):
        output = io.StringIO()
        with mock.patch("sys.stdout", output):
            self.assertEqual(final_acceptance.main([]), 0)
        report = json.loads(output.getvalue())
        self.assertEqual(report["mode"], "dry-run")
        self.assertFalse(report["secretValuesExposed"])

    def test_acceptance_harness_requires_exact_confirmation(self):
        with self.assertRaises(final_acceptance.AcceptanceError):
            final_acceptance.main(["--execute"])

    def test_execute_returns_already_prepared_without_repeating_reset(self):
        output = io.StringIO()
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / "prepared.json"
            value = fresh_reset.prepared_payload(self.snapshot)
            value["preparedAt"] = "2026-09-22T12:00:00Z"
            value["browserBlankVerifiedAt"] = "2026-09-22T11:59:00Z"
            fresh_reset.atomic_json(marker, value)
            with mock.patch.object(fresh_reset, "PREPARED_MARKER", marker), mock.patch.object(
                fresh_reset, "COMPLETE_MARKER", Path(directory) / "missing-complete.json"
            ), mock.patch.object(fresh_reset, "validate_live_markers") as validate, mock.patch.object(
                fresh_reset, "prepare_reset"
            ) as prepare, mock.patch("sys.stdout", output):
                fresh_reset.main(["--execute", "--confirm", fresh_reset.CONFIRMATION])
            self.assertTrue(json.loads(output.getvalue())["alreadyPrepared"])
            validate.assert_not_called()
            prepare.assert_not_called()


if __name__ == "__main__":
    unittest.main()
