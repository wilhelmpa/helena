"""Tests of the update center's host helper against fakes: canned apt output, a fake runtime
installer and a spool in a temporary folder. Nothing on the machine is read or changed and no
root is needed. Run with `python3 -m unittest test_helena_update` in this folder."""

from __future__ import annotations

import importlib.machinery
import importlib.util
import contextlib
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
loader = importlib.machinery.SourceFileLoader("helper", str(HERE / "helena-update"))
spec = importlib.util.spec_from_loader("helper", loader)
helper = importlib.util.module_from_spec(spec)
loader.exec_module(helper)

SIMULATION = """NOTE: This is only a simulation!
Inst libssl3t64 [3.5.1-1] (3.5.1-1+deb13u1 Debian-Security:13/stable-security [amd64])
Inst openssl [3.5.1-1] (3.5.1-1+deb13u1 Debian-Security:13/stable-security [amd64])
Inst tzdata [2025b-4] (2025c-0+deb13u1 Debian:13.2/stable [all])
Inst chromium [153.0.8010.52-1~deb13u1] (153.0.8010.70-1~deb13u1 Debian:13.2/stable, Debian-Security:13/stable-security [amd64])
Inst libnew1 (1.0-1 Debian:13.2/stable [amd64])
Conf libssl3t64 (3.5.1-1+deb13u1 Debian-Security:13/stable-security [amd64])
Remv oldthing [0.9-1]
"""
SOURCES = "libssl3t64\topenssl\nopenssl\topenssl\ntzdata\ttzdata\nchromium\tchromium\n"


def completed(args, stdout="", returncode=0):
    return subprocess.CompletedProcess(args, returncode, stdout, "")


class FakeSystem:
    """Answers the commands the helper runs, and remembers them."""

    def __init__(self) -> None:
        self.commands: list[list[str]] = []
        self.versions = {"libssl3t64": "3.5.1-1", "openssl": "3.5.1-1", "tzdata": "2025b-4",
                         "chromium": "153.0.8010.52-1~deb13u1", "kasmvncserver": "1.5.0-1"}
        self.simulation = SIMULATION

    def __call__(self, args, **kwargs):
        self.commands.append(list(args))
        if args[:2] == ["apt-get", "-s"]:
            if 'install' in args:
                wanted = set(args[args.index('install') + 1:])
                return completed(args, '\n'.join(line for line in self.simulation.splitlines()
                    if line.startswith('Inst ') and line.split()[1] in wanted))
            return completed(args, self.simulation)
        if args[:2] == ["apt-get", "update"]:
            return completed(args, "Hit:1 http://deb.debian.org/debian trixie InRelease")
        if args[:3] == ["apt-get", "install", "--only-upgrade"]:
            for name in [arg for arg in args[3:] if not arg.startswith("-") and "=" not in arg
                         and arg not in ("DPkg::Lock::Timeout=600",)]:
                if name in self.versions:
                    self.versions[name] = {"tzdata": "2025c-0+deb13u1",
                                           "openssl": "3.5.1-1+deb13u1",
                                           "libssl3t64": "3.5.1-1+deb13u1"}.get(name, "new")
            return completed(args, "Setting up openssl ...")
        if args[:3] == ['apt-get', 'install', '--allow-downgrades']:
            for argument in args:
                if argument.startswith('/cache/') and argument.endswith('.deb'):
                    self.versions[Path(argument).stem] = '3.5.1-1'
            return completed(args, 'Originalpakete wiederhergestellt')
        if args[0] == "dpkg-query" and any("${source:Package}" in arg for arg in args):
            return completed(args, SOURCES)
        if args[0] == "dpkg-query":
            version = self.versions.get(args[-1])
            return completed(args, version or "", 0 if version else 1)
        if args[0] == "systemctl":
            return completed(args, "")
        return completed(args, "", 0)


class HelperTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.spool = self.root / "spool"
        (self.spool / "requests").mkdir(parents=True)
        (self.spool / "status").mkdir()
        self.config = helper.load_config(self.write_config())
        self.fake = FakeSystem()
        patcher = mock.patch.object(helper.subprocess, "run", side_effect=self.fake)
        patcher.start()
        self.addCleanup(patcher.stop)
        queue = mock.patch.object(helper.host_tools, "quiet_queue", return_value=contextlib.nullcontext())
        queue.start()
        self.addCleanup(queue.stop)
        rollback = mock.patch.object(helper, 'apt_rollback_packages',
                                     side_effect=lambda config, versions: {name: f'/cache/{name}.deb' for name in versions})
        rollback.start()
        self.addCleanup(rollback.stop)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def write_config(self, **changes) -> Path:
        path = self.root / "config.json"
        path.write_text(json.dumps({
            "spool": str(self.spool),
            "runtimesInstaller": str(self.root / "no-installer"),
            "tools": {},
            **changes,
        }))
        return path

    def request(self, request_id: str, body: dict) -> Path:
        path = self.spool / "requests" / f"{request_id}.json"
        path.write_text(json.dumps({"id": request_id, **body}))
        return path

    def status(self, request_id: str) -> dict:
        return json.loads((self.spool / "status" / f"{request_id}.json").read_text())


class InventoryTest(HelperTest):
    def test_groups_upgrades_by_source_and_marks_security_by_origin(self):
        apt = helper.apt_inventory()
        by_source = {group["source"]: group for group in apt["packages"]}
        self.assertEqual(sorted(by_source), ["chromium", "openssl", "tzdata"])
        self.assertEqual(sorted(by_source["openssl"]["packages"]), ["libssl3t64", "openssl"])
        self.assertTrue(by_source["openssl"]["security"])
        self.assertTrue(by_source["chromium"]["security"])
        self.assertFalse(by_source["tzdata"]["security"])
        self.assertEqual(by_source["tzdata"]["candidate"], "2025c-0+deb13u1")
        self.assertEqual(by_source["chromium"]["installed"], "153.0.8010.52-1~deb13u1")
        self.assertEqual(apt["newPackages"], ["libnew1"])
        self.assertEqual(apt["removals"], ["oldthing"])
        # A simulation changes nothing and takes no lock.
        simulate = next(c for c in self.fake.commands if c[:2] == ["apt-get", "-s"])
        self.assertIn("Debug::NoLocking=1", simulate)

    def test_reads_tool_versions_from_their_folders(self):
        runtime = self.root / "runtime"
        bun = runtime / "bun-v1.4.2" / "bun-linux-x64" / "bun"
        node = runtime / "node-v24.21.0-linux-x64" / "bin" / "node"
        server = runtime / "code-server-4.138.0-linux-amd64" / "bin" / "code-server"
        wetty = runtime / "wetty-3.2.2" / "node_modules" / "wetty" / "build" / "main.js"
        for path in (bun, node, server, wetty):
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("")
        (runtime / "code-server-4.138.0-linux-amd64" / "package.json").write_text('{"version":"4.138.0"}')
        (runtime / "wetty-3.2.2" / "node_modules" / "wetty" / "package.json").write_text('{"version":"3.2.2"}')
        link = self.root / "bin-bun"
        link.symlink_to(bun)
        self.assertEqual(helper.tool_version(str(link)), "1.4.2")
        self.assertEqual(helper.tool_version(str(node)), "24.21.0")
        self.assertEqual(helper.tool_version(str(server)), "4.138.0")
        self.assertEqual(helper.tool_version(str(wetty)), "3.2.2")
        self.assertIsNone(helper.tool_version(str(self.root / "missing")))

    def test_the_whole_inventory(self):
        with mock.patch.object(helper, "runtimes_status", return_value={"claude": {"current": "2.1.281"}}):
            answer = helper.perform(self.config, {"action": "inventory"})
        self.assertTrue(answer["ok"], answer)
        self.assertEqual(answer["result"]["runtimes"]["claude"]["current"], "2.1.281")
        self.assertEqual(answer["result"]["tools"]["chromium"], "153.0.8010.52-1~deb13u1")
        self.assertEqual(answer["result"]["tools"]["kasmvnc"], "1.5.0-1")
        self.assertFalse(any(c[:2] == ["apt-get", "update"] for c in self.fake.commands))


class WhisperInventoryTest(unittest.TestCase):
    def test_model_files_return_only_selected_model_names(self):
        command = ('{ path=/opt/helena-ai/voice/tts-server; argv[]=/opt/helena-ai/voice/tts-server '
                   '--model /var/lib/helena-voice/models/qwen-talker-1.7b-base-Q8_0.gguf '
                   '--codec /var/lib/helena-voice/models/qwen-tokenizer-12hz-Q8_0.gguf '
                   '--api-key test-only-value; }')
        with mock.patch.object(helper, 'run', return_value=completed([], command)) as run:
            self.assertEqual(helper.model_files('helena-voice-tts.service'), [
                'qwen-talker-1.7b-base-Q8_0.gguf', 'qwen-tokenizer-12hz-Q8_0.gguf'])
        self.assertEqual(run.call_args.args[1], ['systemctl', 'show', 'helena-voice-tts.service',
                                              '--property=ExecStart', '--value'])

    def test_unavailable_model_files_are_unknown(self):
        with mock.patch.object(helper, 'run', side_effect=OSError('unavailable')):
            self.assertEqual(helper.model_files('helena-embed.service'), [])

    def status(self, fields, executable=None):
        with mock.patch.object(helper, "run", return_value=completed([], fields)) as run, mock.patch.object(
                helper.os, "readlink", return_value=executable) as readlink:
            result = helper.whisper_status()
        self.assertEqual(run.call_args.args[1], ["systemctl", "show", "helena-voice-stt.service",
                                                "--property=LoadState,ActiveState,MainPID"])
        return result, readlink

    def test_reports_version_of_running_binary_without_argv_environment_or_execution(self):
        result, link = self.status("LoadState=loaded\nActiveState=active\nMainPID=123\n",
                                   "/opt/helena-ai/voice/whisper-1.8.4/whisper-server")
        self.assertEqual(result, {"present": True, "version": "1.8.4", "state": "active",
                                  "versionSource": "running-executable-path"})
        link.assert_called_once_with("/proc/123/exe")

    def test_reports_cpu_voice_and_pinned_gpu_builds(self):
        fields = "LoadState=loaded\nActiveState=active\nMainPID=123\n"
        result, _ = self.status(fields,
            "/opt/helena-ai/voice/whisper-1.8.4-cpu/whisper-server")
        self.assertEqual(result["version"], "1.8.4")
        for unit, pattern, executable, version in (
            ("helena-voice-tts.service",
             r"/opt/helena-ai/voice/qwentts-([0-9a-f]{9,40})(?:-rocm|-cpu)?/tts-server",
             "/opt/helena-ai/voice/qwentts-6a3e91283-rocm/tts-server", "6a3e91283"),
            ("helena-embed.service",
             r"/opt/helena-ai/llamacpp/(?:rocm|vulkan)-(b[0-9]+)/llama-server",
             "/opt/helena-ai/llamacpp/vulkan-b11166/llama-server", "b11166"),
        ):
            with mock.patch.object(helper, "run", return_value=completed([], fields)), mock.patch.object(
                    helper.os, "readlink", return_value=executable):
                self.assertEqual(helper.executable_status(unit, pattern)["version"], version)

    def test_absent_or_inactive_service_never_invents_an_installed_version(self):
        result, link = self.status("LoadState=not-found\nActiveState=inactive\nMainPID=0")
        self.assertFalse(result["present"])
        self.assertIsNone(result["version"])
        link.assert_not_called()
        result, link = self.status("LoadState=loaded\nActiveState=failed\nMainPID=0")
        self.assertTrue(result["present"])
        self.assertEqual(result["state"], "failed")
        self.assertIsNone(result["version"])
        link.assert_not_called()

    def test_unrecognized_or_deleted_binary_and_process_race_stay_unknown(self):
        for path in ("/tmp/whisper-1.8.4/whisper-server", "/opt/helena-ai/voice/whisper-1.8.4/whisper-server (deleted)"):
            result, _ = self.status("LoadState=loaded\nActiveState=active\nMainPID=123", path)
            self.assertIsNone(result["version"])
        with mock.patch.object(helper, "run", return_value=completed([], "LoadState=loaded\nActiveState=active\nMainPID=123")), mock.patch.object(
                helper.os, "readlink", side_effect=FileNotFoundError):
            self.assertIsNone(helper.whisper_status()["version"])


class ResourceScopeTest(unittest.TestCase):
    def test_full_gate_and_memory_pressure_block_updates(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            (root / '1').mkdir()
            pressure = root / 'memory'
            pressure.write_text('some avg10=0.00\nfull avg10=0.00\n')
            command = root / '1/cmdline'
            command.write_bytes(b'/bin/bash\0/home/test/agent-work/full-test.sh\0hub/test\0')
            with self.assertRaisesRegex(helper.host_tools.ToolError, 'full-test.sh'):
                helper.host_tools.build_preflight(root, pressure)
            command.write_bytes(b'/usr/bin/other\0')
            pressure.write_text('some avg10=6.00\nfull avg10=2.00\n')
            with self.assertRaisesRegex(helper.host_tools.ToolError, 'Speicherdruck'):
                helper.host_tools.build_preflight(root, pressure)
            pressure.write_text('some avg10=0.00\nfull avg10=0.00\n')
            helper.host_tools.build_preflight(root, pressure)

    def test_command_failure_exposes_the_diagnostic_without_credentials(self):
        output = '--pty/--pipe is not compatible in timer or --scope mode.\nAuthorization: Bearer test-only-secret'
        with mock.patch.object(helper.subprocess, 'run', return_value=completed([], output, 1)):
            with self.assertRaisesRegex(helper.UpdateError, 'not compatible') as failed:
                helper.run(helper.Log(), ['systemd-run'])
        self.assertNotIn('test-only-secret', str(failed.exception))

    def test_heavy_install_uses_systemd_scope(self):
        with mock.patch.object(helper.host_tools, "build_preflight"), mock.patch.object(
                helper.os, "geteuid", return_value=0), mock.patch.object(
                helper.subprocess, "run", return_value=completed([], "ok")) as execute:
            helper.run(helper.Log(), ["apt-get", "install", "--only-upgrade", "openssl"], limited=True)
        command = execute.call_args.args[0]
        self.assertEqual(command[:2], ["systemd-run", "--scope"])
        for prop in ("MemoryHigh=5G", "MemoryMax=8G", "CPUWeight=20"):
            self.assertIn(prop, command)
        self.assertNotIn('--pipe', command)
        self.assertNotIn('--wait', command)
        self.assertEqual(command[-4:], ["apt-get", "install", "--only-upgrade", "openssl"])


class AptRefreshTest(HelperTest):
    def test_refresh_records_success_without_installing_packages(self):
        answer = helper.perform(self.config, {"action": "apt-refresh"})
        self.assertTrue(answer["ok"], answer)
        state = answer["result"]["apt"]
        self.assertIsNotNone(state["refreshedAt"])
        self.assertIsNotNone(state["refreshAttemptedAt"])
        self.assertIsNone(state["refreshError"])
        self.assertFalse(any(c[:2] == ["apt-get", "install"] for c in self.fake.commands))
        self.assertEqual(helper.apt_refresh_state(self.config)["refreshedAt"], state["refreshedAt"])

    def test_failed_refresh_keeps_last_success_and_records_failed_attempt(self):
        last = "2026-09-26T19:00:00+00:00"
        (self.spool / "status" / ".apt-metadata").write_text(json.dumps({"refreshedAt": last}))
        with mock.patch.object(helper.subprocess, "run", side_effect=subprocess.TimeoutExpired("apt-get", 180)):
            answer = helper.perform(self.config, {"action": "apt-refresh"})
        self.assertFalse(answer["ok"])
        state = helper.apt_refresh_state(self.config)
        self.assertEqual(state["refreshedAt"], last)
        self.assertIsNotNone(state["refreshAttemptedAt"])
        self.assertIn("metadata refresh failed", state["refreshError"])

    def test_refresh_rejects_arbitrary_options(self):
        answer = helper.perform(self.config, {"action": "apt-refresh", "options": ["--allow-unauthenticated"]})
        self.assertFalse(answer["ok"])
        self.assertFalse(self.fake.commands)

    def test_unrecorded_refresh_does_not_invent_freshness(self):
        self.assertIsNone(helper.apt_refresh_state(self.config)["refreshedAt"])


class AptTest(HelperTest):
    def setUp(self):
        super().setUp()
        rollback = mock.patch.object(helper, 'apt_rollback_packages',
                                     side_effect=lambda config, versions: {name: f'/cache/{name}.deb' for name in versions})
        rollback.start()
        self.addCleanup(rollback.stop)
        smoke = mock.patch.object(helper, 'apt_smoke')
        self.smoke = smoke.start()
        self.addCleanup(smoke.stop)

    def test_missing_rollback_archive_refuses_installation(self):
        with mock.patch.object(helper, 'apt_rollback_packages', return_value={}):
            answer = helper.perform(self.config, {'action': 'apt', 'packages': ['openssl']})
        self.assertFalse(answer['ok'])
        self.assertIn('Originalpakete', answer['error'])
        self.assertFalse(any(command[:2] == ['apt-get', 'install'] for command in self.fake.commands))

    def test_failed_service_smoke_restores_packages_and_rechecks_services(self):
        self.smoke.side_effect = [helper.UpdateError('Dienst antwortet nicht'), None]
        answer = helper.perform(self.config, {'action': 'apt', 'packages': ['openssl']})
        self.assertFalse(answer['ok'])
        self.assertEqual(self.fake.versions['openssl'], '3.5.1-1')
        self.assertEqual(self.smoke.call_count, 2)
        self.assertIn('Dienst antwortet nicht', answer['error'])

    def test_rollback_service_failure_is_reported(self):
        self.smoke.side_effect = helper.UpdateError('Dienst antwortet nicht')
        answer = helper.perform(self.config, {'action': 'apt', 'packages': ['openssl']})
        self.assertFalse(answer['ok'])
        self.assertIn('Rollback-Rauchtest fehlgeschlagen', answer['error'])

    def test_busy_queue_refuses_before_package_install(self):
        with mock.patch.object(helper.host_tools, "quiet_queue", side_effect=helper.host_tools.ToolError("busy queue")):
            answer = helper.perform(self.config, {"action": "apt", "packages": ["openssl"]})
        self.assertFalse(answer["ok"])
        self.assertIn("busy queue", answer["error"])
        self.assertFalse(any(command[:2] == ["apt-get", "install"] for command in self.fake.commands))

    def test_failed_metadata_refresh_never_installs_from_cached_candidates(self):
        def failed_refresh(args, **kwargs):
            if args[:2] == ["apt-get", "update"]:
                self.fake.commands.append(list(args))
                return completed(args, "A security index could not be fetched", 100)
            return self.fake(args, **kwargs)

        with mock.patch.object(helper.subprocess, "run", side_effect=failed_refresh):
            answer = helper.perform(self.config, {"action": "apt", "packages": ["openssl"]})
        self.assertFalse(answer["ok"])
        self.assertIn("metadata refresh failed", answer["error"])
        self.assertFalse(any(c[:2] == ["apt-get", "install"] for c in self.fake.commands))
        self.assertEqual(self.fake.versions["openssl"], "3.5.1-1")

    def test_upgrades_only_the_chosen_packages_that_are_upgradable(self):
        answer = helper.perform(self.config, {"action": "apt",
                                              "packages": ["openssl", "libssl3t64", "vim"]})
        self.assertTrue(answer["ok"], answer)
        install = next(c for c in self.fake.commands if c[:3] == ["apt-get", "install", "--only-upgrade"])
        self.assertEqual(install[-2:], ["libssl3t64", "openssl"])
        self.assertIn("Dpkg::Options::=--force-confold", install)
        # apt's own hooks run as always (on Kingston: DPkg::Post-Invoke mirrors the ESP of the
        # RAID 1 to the second disk, /etc/apt/apt.conf.d/99helena-esp-sync).
        self.assertFalse(any("Invoke" in arg or "no-triggers" in arg for arg in install))
        result = answer["result"]
        self.assertEqual(result["skipped"], ["vim"])
        self.assertEqual({e["package"]: e["to"] for e in result["upgraded"]},
                         {"libssl3t64": "3.5.1-1+deb13u1", "openssl": "3.5.1-1+deb13u1"})
        self.assertIn("openssl=3.5.1-1", result["rollback"])
        # The lists are refreshed first.
        self.assertTrue(any(c[:2] == ["apt-get", "update"] for c in self.fake.commands))
        refresh = next(c for c in self.fake.commands if c[:2] == ["apt-get", "update"])
        self.assertIn("APT::Update::Error-Mode=any", refresh)

    def test_refuses_names_that_are_not_packages(self):
        answer = helper.perform(self.config, {"action": "apt", "packages": ["openssl; rm -rf /"]})
        self.assertFalse(answer["ok"])
        self.assertFalse(any(c[:2] == ["apt-get", "install"] for c in self.fake.commands))
        answer = helper.perform(self.config, {"action": "apt", "packages": "openssl"})
        self.assertFalse(answer["ok"])

    def test_nothing_upgradable_installs_nothing(self):
        self.fake.simulation = "NOTE: This is only a simulation!\n"
        answer = helper.perform(self.config, {"action": "apt", "packages": ["openssl"]})
        self.assertTrue(answer["ok"])
        self.assertEqual(answer["result"]["upgraded"], [])
        self.assertFalse(any(c[:2] == ["apt-get", "install"] for c in self.fake.commands))


class RuntimeTest(unittest.TestCase):
    """Against a real (fake) installer script, without the patched subprocess."""

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.state = root / "state.json"
        self.installer = root / "installer"
        self.installer.write_text(
            "#!/bin/sh\n"
            f'STATE="{self.state}"\n'
            'if [ "$1" = status ]; then cat "$STATE" 2>/dev/null || echo "{}"; exit 0; fi\n'
            'if [ "$1" = upgrade ]; then\n'
            '  [ "$3" = 9.9.9 ] && { echo "the manifest is not signed"; exit 1; }\n'
            '  printf \'{"%s":{"pinned":"%s","current":"%s","previous":"1.0.0","intact":true}}\' "$2" "$3" "$3" > "$STATE"\n'
            '  echo "$2 upgraded"; exit 0\n'
            "fi\n"
            'if [ "$1" = rollback ]; then\n'
            '  printf \'{"%s":{"current":"1.0.0","intact":true}}\' "$2" > "$STATE"\n'
            '  echo "$2 restored"; exit 0\n'
            'fi\n'
            "exit 64\n")
        self.installer.chmod(0o755)
        path = root / "config.json"
        path.write_text(json.dumps({"spool": str(root / "spool"),
                                    "runtimesInstaller": str(self.installer), "tools": {}}))
        self.config = helper.load_config(path)
        self.state.write_text('{"codex":{"current":"1.0.0","intact":true}}')
        self.smoke = mock.patch.object(helper, 'runtime_smoke', create=True)
        self.smoke_mock = self.smoke.start()
        self.smoke_mock.return_value = {'smoke': 'passed', 'model': 'gpt-6.1-sol'}
        self.addCleanup(self.smoke.stop)
        preflight = mock.patch.object(helper, 'runtime_preflight', create=True)
        preflight.start()
        self.addCleanup(preflight.stop)
        quiet = mock.patch.object(helper.host_tools, 'quiet_queue', return_value=contextlib.nullcontext())
        quiet.start()
        self.addCleanup(quiet.stop)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_upgrades_a_runtime_through_the_installer(self):
        with mock.patch.object(helper, "failed_units", return_value=[]):
            answer = helper.perform(self.config, {"action": "cli-runtime", "runtime": "codex",
                                                  "version": "0.158.0"})
        self.assertTrue(answer["ok"], answer)
        self.assertEqual(answer["result"]["to"], "0.158.0")
        self.assertIn("rollback codex", answer["result"]["rollback"])
        self.assertIn("codex upgraded", answer["log"])

    def test_a_failed_upgrade_is_the_answer(self):
        answer = helper.perform(self.config, {"action": "cli-runtime", "runtime": "codex",
                                              "version": "9.9.9"})
        self.assertFalse(answer["ok"])
        self.assertIn("not signed", answer["log"])

    def test_busy_queue_defers_before_upgrade(self):
        with mock.patch.object(helper.host_tools, 'quiet_queue', side_effect=helper.host_tools.ToolError('busy queue')):
            answer = helper.perform(self.config, {"action": "cli-runtime", "runtime": "codex",
                                                  "version": "0.158.0"})
        self.assertFalse(answer['ok'])
        self.assertIn('busy queue', answer['error'])
        self.assertEqual(json.loads(self.state.read_text())['codex']['current'], '1.0.0')

    def test_failed_installed_check_restores_previous_version(self):
        self.state.write_text('{"codex":{"current":"1.0.0","intact":true}}')
        original = helper.runtimes_status
        def status(config):
            value = original(config)
            if value.get('codex', {}).get('current') == '0.158.0':
                value['codex']['intact'] = False
            return value
        with mock.patch.object(helper, 'runtimes_status', side_effect=status):
            answer = helper.perform(self.config, {"action": "cli-runtime", "runtime": "codex",
                                                   "version": "0.158.0"})
        self.assertFalse(answer['ok'])
        self.assertIn('vorherige Version wiederhergestellt', answer['error'])
        self.assertEqual(json.loads(self.state.read_text())['codex']['current'], '1.0.0')

    def test_refuses_unknown_runtimes_and_versions(self):
        for runtime, version in (("evil", "1.0.0"), ("codex", "1.0; rm -rf /"), ("codex", "latest")):
            answer = helper.perform(self.config, {"action": "cli-runtime", "runtime": runtime,
                                                  "version": version})
            self.assertFalse(answer["ok"], (runtime, version))

    def test_model_failure_rolls_back_and_tests_the_restored_runtime(self):
        self.smoke_mock.side_effect = [helper.UpdateError('Modell nicht unterstützt'), None]
        answer = helper.perform(self.config, {'action': 'cli-runtime', 'runtime': 'codex',
                                              'version': '0.159.2'})
        self.assertFalse(answer['ok'])
        self.assertIn('Modell nicht unterstützt', answer['error'])
        self.assertEqual(json.loads(self.state.read_text())['codex']['current'], '1.0.0')
        self.assertEqual(self.smoke_mock.call_count, 2)

    def test_rollback_model_failure_is_never_done(self):
        self.smoke_mock.side_effect = helper.UpdateError('Modell nicht unterstützt')
        answer = helper.perform(self.config, {'action': 'cli-runtime', 'runtime': 'codex',
                                              'version': '0.159.2'})
        self.assertFalse(answer['ok'])
        self.assertIn('Rollback-Rauchtest', answer['error'])

    def test_no_update_without_an_intact_rollback_version(self):
        self.state.write_text('{}')
        answer = helper.perform(self.config, {'action': 'cli-runtime', 'runtime': 'codex',
                                              'version': '0.159.2'})
        self.assertFalse(answer['ok'])
        self.assertEqual(json.loads(self.state.read_text()), {})


class SpoolTest(HelperTest):
    def test_serves_every_request_and_writes_its_status(self):
        self.request("11111111-1111-4111-8111-111111111111", {"action": "apt", "packages": ["tzdata"]})
        self.request("22222222-2222-4222-8222-222222222222", {"action": "nope"})
        answered = helper.serve(self.config)
        self.assertEqual(len(answered), 2)
        done = self.status("11111111-1111-4111-8111-111111111111")
        self.assertEqual((done["state"], done["ok"]), ("done", True))
        self.assertEqual(done["result"]["upgraded"][0]["package"], "tzdata")
        failed = self.status("22222222-2222-4222-8222-222222222222")
        self.assertEqual((failed["state"], failed["error"]), ("failed", "unknown action"))
        self.assertEqual(list((self.spool / "requests").iterdir()), [])
        self.assertEqual(oct(os.stat(self.spool / "status" / "11111111-1111-4111-8111-111111111111.json").st_mode & 0o777), "0o644")

    def test_never_follows_a_link_and_drops_what_is_not_a_request(self):
        secret = self.root / "secret.json"
        secret.write_text(json.dumps({"id": "33333333-3333-4333-8333-333333333333", "action": "apt",
                                      "packages": ["openssl"]}))
        (self.spool / "requests" / "33333333-3333-4333-8333-333333333333.json").symlink_to(secret)
        (self.spool / "requests" / "notes.txt").write_text("hello")
        (self.spool / "requests" / "44444444-4444-4444-8444-444444444444.json").write_text("x" * 70_000)
        answered = helper.serve(self.config)
        self.assertEqual(answered, [])
        self.assertEqual(list((self.spool / "requests").iterdir()), [])
        self.assertTrue(secret.exists())
        self.assertFalse(any(c[:2] == ["apt-get", "install"] for c in self.fake.commands))

    def test_a_request_must_name_its_own_id(self):
        path = self.spool / "requests" / "55555555-5555-4555-8555-555555555555.json"
        path.write_text(json.dumps({"id": "66666666-6666-4666-8666-666666666666", "action": "inventory"}))
        helper.serve(self.config)
        status = self.status("55555555-5555-4555-8555-555555555555")
        self.assertEqual(status["error"], "the request names another id")


if __name__ == "__main__":
    unittest.main()


class WhisperDispatchTest(HelperTest):
    def test_only_fixed_version_reaches_installed_bridge(self):
        with mock.patch.object(helper, 'whisper_ui', return_value={'ok': True, 'result': {'phase': 'active'}}) as bridge:
            answer = helper.perform(self.config, {'action': 'whisper-ui', 'version': '1.9.4'})
            self.assertTrue(answer['ok'])
            bridge.assert_called_once_with('activate', version='1.9.4', database=self.config['hostToolsDatabase'])
        for fields in ({'version': '1.9.5'}, {'version': '1.9.4', 'corpus': '/tmp/unsafe'},
                       {'version': '1.9.4', 'command': 'echo unsafe'}, {}):
            with mock.patch.object(helper, 'whisper_ui') as bridge:
                self.assertFalse(helper.perform(self.config, {'action': 'whisper-ui', **fields})['ok'])
                bridge.assert_not_called()

    def test_failed_rollback_is_reported_as_failed_with_its_result(self):
        result = {'ok': False, 'error': 'speech failed', 'result': {'phase': 'restoring', 'speechVerified': False}}
        with mock.patch.object(helper, 'whisper_ui', return_value=result):
            self.assertEqual(helper.perform(self.config, {'action': 'whisper-ui', 'version': '1.9.4'}), result)

    def test_old_or_failed_bridge_never_advertises_ready(self):
        for response in ({'ok': False}, {'ok': True, 'result': 'wrong'}):
            with mock.patch.object(helper, 'whisper_ui', return_value=response):
                self.assertFalse(helper.whisper_readiness()['ready'])
