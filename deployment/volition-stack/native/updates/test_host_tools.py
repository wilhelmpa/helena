"""Offline host update fixtures: no network, installation, root or service changes."""
import base64
import contextlib
import hashlib
import io
import json
import os
import subprocess
import tarfile
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

import host_tools as h


class Log:
    def __init__(self):
        self.lines = []

    def note(self, text):
        self.lines.append(text)


class HostToolsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.config = {"hostToolsPrefix": str(self.root / "tools"),
                       "hostToolsBin": str(self.root / "bin"),
                       "hostToolsUnits": str(self.root / "units"),
                       "hostToolsDatabase": "fixture"}
        (self.root / "bin").mkdir()
        self.log = Log()

    def fixture(self, entries):
        archive = self.root / "fixture.tar.gz"
        with tarfile.open(archive, "w:gz") as target:
            for name, content, link in entries:
                entry = tarfile.TarInfo(name)
                if link is not None:
                    entry.type = tarfile.SYMTYPE
                    entry.linkname = link
                    target.addfile(entry)
                else:
                    entry.mode = 0o6755
                    entry.size = len(content)
                    target.addfile(entry, io.BytesIO(content))
        return archive

    def installed_tree(self, tool="bun", version="1.4.3"):
        parent = Path(self.config["hostToolsPrefix"]) / tool
        tree = parent / version
        (tree / "bin").mkdir(parents=True)
        (tree / "bin" / tool).write_text("fixture")
        (tree / ".helena-installed.json").write_text(json.dumps({"tool": tool, "version": version}))
        old = parent / "1.4.2"
        old.mkdir()
        (parent / "current").symlink_to(old.name)
        (Path(self.config["hostToolsBin"]) / tool).symlink_to("/fixture/old/" + tool)
        return tree

    def test_only_official_https_and_no_credentials_or_nonstandard_ports(self):
        h.url_allowed("https://nodejs.org/dist/v24.1.0/SHASUMS256.txt")
        for url in ("http://nodejs.org/a", "https://nodejs.org.evil/a", "file:///a",
                    "https://user@nodejs.org/a", "https://nodejs.org:8443/a"):
            with self.subTest(url=url), self.assertRaises(h.ToolError):
                h.url_allowed(url)

    def test_every_redirect_is_checked(self):
        request = h.urllib.request.Request("https://github.com/file")
        with self.assertRaises(h.ToolError):
            h.Redirects().redirect_request(request, None, 302, "", {}, "http://127.0.0.1/secret")

    def test_checksum_is_verified_before_archive_parse(self):
        path = self.root / "download"
        path.write_bytes(b"fixture")
        h.verify(path, "sha256:" + hashlib.sha256(b"fixture").hexdigest())
        h.verify(path, "sha512-" + base64.b64encode(hashlib.sha512(b"fixture").digest()).decode())
        for digest in ("sha256:" + "0" * 64, "sha1:abc", "sha512-YQ=="):
            with self.subTest(digest=digest), self.assertRaises(h.ToolError):
                h.verify(path, digest)

    def test_archive_extracts_links_last_and_drops_suid(self):
        archive = self.fixture([("app/bin/tool", b"okay", None), ("app/tool", b"", "bin/tool")])
        target = self.root / "unpack"
        h.unpack(archive, target)
        self.assertEqual((target / "app/tool").read_bytes(), b"okay")
        self.assertEqual((target / "app/bin/tool").stat().st_mode & 0o7777, 0o755)

    def test_archive_rejects_traversal_absolute_links_chains_and_duplicates(self):
        fixtures = [[("../escape", b"x", None)], [("/escape", b"x", None)],
                    [("a", b"", "/etc/passwd")], [("a", b"", "../../etc/passwd")],
                    [("a", b"", "b"), ("b", b"", "../escape")],
                    [("a", b"1", None), ("a", b"2", None)]]
        for index, entries in enumerate(fixtures):
            with self.subTest(entries=entries), self.assertRaises(h.ToolError):
                h.unpack(self.fixture(entries), self.root / str(index))

    def test_bun_zip_executable_mode_is_preserved(self):
        archive = self.root / "bun.zip"
        with zipfile.ZipFile(archive, "w") as target:
            entry = zipfile.ZipInfo("bun-linux-x64/bun")
            entry.external_attr = 0o100755 << 16
            target.writestr(entry, b"fixture")
        target = self.root / "unpacked"
        h.unpack(archive, target)
        self.assertEqual((target / "bun-linux-x64/bun").stat().st_mode & 0o777, 0o755)

    def test_github_missing_digest_and_wrong_tag_refused(self):
        name = "code-server-4.139.1-linux-amd64.tar.gz"
        data = {"tag_name": "v4.139.1", "assets": [{"name": name, "state": "uploaded",
                "size": 10, "browser_download_url": "https://github.com/coder/code-server/releases/download/v4.139.1/" + name}]}
        with mock.patch.object(h.platform, "machine", return_value="x86_64"), mock.patch.object(h, "metadata", return_value=data):
            with self.assertRaisesRegex(h.ToolError, "SHA-256"):
                h.release_asset("code-server", "4.139.1", self.root)
            data["assets"][0]["digest"] = "sha256:" + "a" * 64
            self.assertEqual(h.release_asset("code-server", "4.139.1", self.root)["digest"], "sha256:" + "a" * 64)
            data["tag_name"] = "v4.139.2"
            with self.assertRaisesRegex(h.ToolError, "requested stable"):
                h.release_asset("code-server", "4.139.1", self.root)

    def test_node_manifest_selects_only_exact_platform_version(self):
        def fetch(url, dest, limit):
            self.assertEqual(url, "https://nodejs.org/dist/v24.22.0/SHASUMS256.txt")
            dest.write_text("a" * 64 + "  node-v24.22.0-linux-x64.tar.xz\n" + "b" * 64 + "  other.tar.xz\n")
        with mock.patch.object(h, "fetch", side_effect=fetch), mock.patch.object(h.platform, "machine", return_value="x86_64"):
            asset = h.release_asset("node", "24.22.0", self.root)
        self.assertEqual(asset["digest"], "sha256:" + "a" * 64)

    def test_uv_asset_uses_exact_unprefixed_tag_platform_and_digest(self):
        for machine in ("x86_64", "aarch64"):
            name = f"uv-{machine}-unknown-linux-gnu.tar.gz"
            url = "https://github.com/astral-sh/uv/releases/download/0.12.19/" + name
            data = {"tag_name": "0.12.19", "assets": [{"name": name, "state": "uploaded",
                    "size": 10, "browser_download_url": url, "digest": "sha256:" + "a" * 64}]}
            with mock.patch.object(h.platform, "machine", return_value=machine), mock.patch.object(
                    h, "metadata", return_value=data) as metadata:
                self.assertEqual(h.release_asset("uv", "0.12.19", self.root)["url"], url)
                metadata.assert_called_with("https://api.github.com/repos/astral-sh/uv/releases/tags/0.12.19", self.root)
                data["assets"][0]["digest"] = None
                with self.assertRaisesRegex(h.ToolError, "SHA-256"):
                    h.release_asset("uv", "0.12.19", self.root)
                data["tag_name"] = "v0.12.19"
                with self.assertRaisesRegex(h.ToolError, "requested stable"):
                    h.release_asset("uv", "0.12.19", self.root)

    def test_uv_prepares_and_checks_both_launchers_without_installing_python(self):
        archive = self.fixture([("uv-x86_64-unknown-linux-gnu/uv", b"uv", None),
                                ("uv-x86_64-unknown-linux-gnu/uvx", b"uvx", None)])
        data = archive.read_bytes()
        asset = {"url": "https://github.com/astral-sh/uv/fixture", "name": "uv.tar.gz",
                 "digest": "sha256:" + hashlib.sha256(data).hexdigest(),
                 "size": len(data), "verification": "fixture digest"}
        parent = self.root / "prepared"
        parent.mkdir()
        def command(args, **kwargs):
            self.assertEqual(args[1:], ["--version"])
            self.assertEqual(kwargs["user"], "nobody")
            return Path(args[0]).name + " 0.12.19 (fixture)"
        with mock.patch.object(h, "release_asset", return_value=asset), mock.patch.object(
                h, "fetch", side_effect=lambda url, dest: dest.write_bytes(data)), mock.patch.object(
                h, "command", side_effect=command) as run:
            tree = h.prepare("uv", "0.12.19", parent, self.log)
        self.assertEqual([Path(call.args[0][0]).name for call in run.call_args_list], ["uv", "uvx"])
        self.assertEqual((tree / "bin/uvx").resolve(), (tree / "uvx").resolve())
        self.assertEqual(json.loads((tree / ".helena-installed.json").read_text())["asset"]["digest"], asset["digest"])
        with mock.patch.object(h, "command", side_effect=["uv 0.12.19", "uvx 0.12.17"]):
            with self.assertRaisesRegex(h.ToolError, "same requested version"):
                h.binary_smoke("uv", tree, "0.12.19")

    def uv_trees(self):
        parent = Path(self.config["hostToolsPrefix"]) / "uv"
        old, tree = parent / "0.12.17", parent / "0.12.19"
        bindir = Path(self.config["hostToolsBin"])
        for directory in (old, tree):
            (directory / "bin").mkdir(parents=True)
            for name in ("uv", "uvx"):
                (directory / "bin" / name).write_text("fixture")
        for name in ("uv", "uvx"):
            (bindir / name).symlink_to(old / "bin" / name)
        return old, tree, bindir

    def test_uv_first_adoption_switches_pair_and_saves_both_original_links(self):
        old, tree, bindir = self.uv_trees()
        with mock.patch.object(h, "quiet_queue", return_value=contextlib.nullcontext()), mock.patch.object(
                h, "uv_pair_smoke", return_value="0.12.17") as smoke:
            result = h.activate(self.config, "uv", tree, self.log)
        self.assertEqual(result["units"], [])
        for name in ("uv", "uvx"):
            self.assertEqual((bindir / name).resolve(), (tree / "bin" / name).resolve())
        smoke.assert_any_call(bindir, "0.12.19")
        snapshot = json.loads(Path(result["rollbackArtifact"]).read_text())
        for name in ("uv", "uvx"):
            self.assertEqual(snapshot["links"][str(bindir / name)], str(old / "bin" / name))
        self.assertIsNone(snapshot["links"][str(tree.parent / "current")])

    def test_uv_failed_smoke_restores_both_launchers_and_checks_old_pair(self):
        old, tree, bindir = self.uv_trees()
        with mock.patch.object(h, "quiet_queue", return_value=contextlib.nullcontext()), mock.patch.object(
                h, "uv_pair_smoke", side_effect=["0.12.17", h.ToolError("bad uvx"), "0.12.17"]) as smoke:
            with self.assertRaisesRegex(h.ToolError, "previous version restored"):
                h.activate(self.config, "uv", tree, self.log)
        for name in ("uv", "uvx"):
            self.assertEqual((bindir / name).resolve(), (old / "bin" / name).resolve())
        self.assertFalse((tree.parent / "current").is_symlink())
        self.assertEqual(smoke.call_args_list[-1], mock.call(bindir, "0.12.17"))
        self.assertEqual(len(list(tree.parent.glob("rollback-*.json"))), 1)

    def test_npm_lock_requires_each_registry_digest_and_exact_wetty_pin(self):
        digest = "sha512-" + base64.b64encode(b"x" * 64).decode()
        lock = {"packages": {"": {}, "node_modules/wetty": {"version": "3.2.3",
                "resolved": "https://registry.npmjs.org/wetty/-/wetty-3.2.3.tgz", "integrity": digest}}}
        h.npm_lock(lock, "3.2.3", digest)
        lock["packages"]["node_modules/untrusted"] = {"resolved": "https://github.com/anything", "integrity": digest}
        with self.assertRaisesRegex(h.ToolError, "registry"):
            h.npm_lock(lock, "3.2.3", digest)

    def test_failed_smoke_restores_all_original_links_and_only_affected_units(self):
        tree = self.installed_tree()
        with mock.patch.object(h, "quiet_queue", return_value=contextlib.nullcontext()), mock.patch.object(
                h, "affected_units", return_value=["volition-plan-api.service"]), mock.patch.object(
                h, "command") as command, mock.patch.object(h, "service_smoke", side_effect=[h.ToolError("bad"), None]):
            with self.assertRaisesRegex(h.ToolError, "previous version restored"):
                h.activate(self.config, "bun", tree, self.log)
        self.assertEqual(os.readlink(tree.parent / "current"), "1.4.2")
        self.assertEqual(os.readlink(self.root / "bin/bun"), "/fixture/old/bun")
        self.assertFalse((self.root / "bin/bunx").is_symlink())
        self.assertEqual(command.call_args_list, [mock.call(["systemctl", "restart", "volition-plan-api.service"], timeout=60)] * 2)
        self.assertIn("Rollback succeeded", "\n".join(self.log.lines))

    def test_wetty_335_pins_manifest_and_restores_on_failed_smoke(self):
        version = "3.3.5"
        digest = "sha512-" + "a" * 86 + "=="
        url = "https://registry.npmjs.org/wetty/-/wetty-3.3.5.tgz"
        with mock.patch.object(h, "metadata", return_value={"name": "wetty", "version": version,
                "dist": {"tarball": url, "integrity": digest}}):
            asset = h.release_asset("wetty", version, self.root)
        self.assertEqual(asset["digest"], digest)
        tree = self.installed_tree("wetty", version)
        pointer = tree.parent / "current"
        old = pointer.resolve()
        with mock.patch.object(h, "quiet_queue", return_value=contextlib.nullcontext()), mock.patch.object(
                h, "command", return_value=""), mock.patch.object(h, "affected_units", return_value=h.UNITS["wetty"]), mock.patch.object(
                h, "session_smoke"), mock.patch.object(h, "service_smoke") as smoke:
            result = h.activate(self.config, "wetty", tree, self.log)
        self.assertEqual(result["to"], version)
        self.assertEqual(result["units"], ["volition-terminal.service", "volition-owner-terminal.service"])
        smoke.assert_called_once_with(["volition-terminal.service", "volition-owner-terminal.service"])
        self.assertEqual(pointer.resolve(), tree)
        pointer.unlink()
        pointer.symlink_to(old.name)
        bindir = Path(self.config["hostToolsBin"])
        (bindir / "wetty").unlink()
        (bindir / "wetty").symlink_to("/fixture/old/wetty")
        with mock.patch.object(h, "quiet_queue", return_value=contextlib.nullcontext()), mock.patch.object(
                h, "command", return_value=""), mock.patch.object(h, "affected_units", return_value=h.UNITS["wetty"]), mock.patch.object(
                h, "session_smoke"), mock.patch.object(h, "service_smoke", side_effect=[h.ToolError("not active"), None]):
            with self.assertRaisesRegex(h.ToolError, "previous version restored"):
                h.activate(self.config, "wetty", tree, self.log)
        self.assertEqual(pointer.resolve(), old)
        self.assertEqual(os.readlink(bindir / "wetty"), "/fixture/old/wetty")

    def test_session_failure_rolls_back_even_with_no_active_consumers(self):
        for tool in ("wetty", "code-server"):
            with self.subTest(tool=tool):
                tree = self.installed_tree(tool, "3.3.5")
                pointer = tree.parent / "current"
                old = pointer.resolve()
                link = Path(self.config["hostToolsBin"]) / tool
                previous = os.readlink(link)
                with mock.patch.object(h, "quiet_queue", return_value=contextlib.nullcontext()), mock.patch.object(
                        h, "affected_units", return_value=[]), mock.patch.object(h, "command") as run, mock.patch.object(
                        h, "session_smoke", create=True, side_effect=[h.ToolError("login prompt"), None]) as smoke:
                    with self.assertRaisesRegex(h.ToolError, "previous version restored.*login prompt"):
                        h.activate(self.config, tool, tree, self.log)
                self.assertEqual(pointer.resolve(), old)
                self.assertEqual(os.readlink(link), previous)
                self.assertEqual(smoke.call_args_list, [mock.call(tool, link), mock.call(tool, Path(previous).resolve())])
                run.assert_not_called()

    def test_session_failure_with_failed_rollback_requires_operator_check(self):
        tree = self.installed_tree("wetty", "3.3.5")
        previous = os.readlink(tree.parent / "current")
        with mock.patch.object(h, "quiet_queue", return_value=contextlib.nullcontext()), mock.patch.object(
                h, "affected_units", return_value=[]), mock.patch.object(h, "session_smoke", create=True,
                side_effect=h.ToolError("no prompt")):
            with self.assertRaisesRegex(h.ToolError, "rollback smoke failed"):
                h.activate(self.config, "wetty", tree, self.log)
        self.assertEqual(os.readlink(tree.parent / "current"), previous)

    def test_node_update_smokes_wetty_with_candidate_node(self):
        tree = self.installed_tree("node", "24.22.0")
        binary = tree / "bin/node"
        with mock.patch.object(h, "command", return_value="v24.22.0"), mock.patch.object(
                h.Path, "is_file", return_value=True), mock.patch.object(h, "session_smoke", create=True) as smoke:
            h.binary_smoke("node", tree, "24.22.0")
        smoke.assert_called_once_with("wetty", Path("/usr/local/bin/wetty"), binary)
        self.assertIn("volition-owner-terminal.service", h.UNITS["node"])
        self.assertIn("volition-owner-terminal.service", h.UNITS["wetty"])

    @unittest.skipUnless(os.environ.get("VOLITION_HOST_SESSION_TEST") == "1", "opt-in installed packages")
    def test_installed_wetty_versions_and_code_server_sessions(self):
        self.assertNotEqual(os.geteuid(), 0, "regression must exercise unprivileged local execution")
        for version in ("3.3.3", "3.3.5"):
            with self.subTest(wetty=version):
                h.session_smoke("wetty", Path("/opt/helena/host-tools/wetty") / version / "bin/wetty")
        h.session_smoke("code-server", Path("/opt/helena/host-tools/code-server/4.139.1/bin/code-server"))

    def test_terminal_smoke_checks_active_unit_without_http(self):
        with mock.patch.object(h.urllib.request, "build_opener") as build, mock.patch.object(
                h, "command") as command:
            h.service_smoke(["volition-terminal.service"])
        command.assert_called_once_with(
            ["systemctl", "is-active", "--quiet", "volition-terminal.service"], timeout=5)
        build.return_value.open.assert_not_called()

    def test_success_retains_previous_and_inventory_reports_managed_version(self):
        tree = self.installed_tree()
        with mock.patch.object(h, "quiet_queue", return_value=contextlib.nullcontext()), mock.patch.object(
                h, "affected_units", return_value=[]), mock.patch.object(h, "service_smoke"):
            result = h.activate(self.config, "bun", tree, self.log)
        self.assertEqual(os.readlink(tree.parent / "current"), "1.4.3")
        self.assertEqual(os.readlink(tree.parent / "previous"), "1.4.2")
        self.assertEqual(result["smoke"], "passed")
        self.assertEqual(h.installed(self.config), {"bun": "1.4.3"})

    def test_busy_queue_never_changes_links(self):
        tree = self.installed_tree()
        with mock.patch.object(h, "quiet_queue", side_effect=h.ToolError("busy")), mock.patch.object(h, "affected_units", return_value=[]):
            with self.assertRaisesRegex(h.ToolError, "busy"):
                h.activate(self.config, "bun", tree, self.log)
        self.assertEqual(os.readlink(tree.parent / "current"), "1.4.2")

    def test_kasm_first_adoption_keeps_dropin_and_missing_link_in_durable_snapshot(self):
        tree = self.installed_tree("kasmvnc")
        (tree.parent / "current").unlink()
        dropin = Path(self.config["hostToolsUnits"]) / "volition-project-browser-kasm@.service.d/helena-update.conf"
        dropin.parent.mkdir(parents=True)
        original = b"[Service]\nEnvironment=FIXTURE=previous\n"
        dropin.write_bytes(original)
        dropin.chmod(0o640)
        with mock.patch.object(h, "quiet_queue", return_value=contextlib.nullcontext()), mock.patch.object(
                h, "affected_units", return_value=[]), mock.patch.object(h, "command"), mock.patch.object(h, "service_smoke"):
            result = h.activate(self.config, "kasmvnc", tree, self.log)
        artifact = Path(result["rollbackArtifact"])
        snapshot = json.loads(artifact.read_text())
        self.assertEqual(snapshot["links"], {str(tree.parent / "current"): None})
        self.assertEqual(snapshot["dropin"], {"path": str(dropin), "contentBase64": base64.b64encode(original).decode(), "mode": 0o640})
        self.assertEqual(artifact.stat().st_mode & 0o777, 0o600)

    def test_snapshot_flush_failure_prevents_activation(self):
        tree = self.installed_tree()
        with mock.patch.object(h, "quiet_queue", return_value=contextlib.nullcontext()), mock.patch.object(
                h, "affected_units", return_value=[]), mock.patch.object(h.os, "fsync", side_effect=OSError("disk full")), mock.patch.object(h, "atomic_link") as switch:
            with self.assertRaisesRegex(OSError, "disk full"):
                h.activate(self.config, "bun", tree, self.log)
        switch.assert_not_called()
        self.assertEqual(os.readlink(tree.parent / "current"), "1.4.2")

    def test_kasm_failed_smoke_restores_dropin_bytes_and_mode(self):
        tree = self.installed_tree("kasmvnc")
        dropin = Path(self.config["hostToolsUnits"]) / "volition-project-browser-kasm@.service.d/helena-update.conf"
        dropin.parent.mkdir(parents=True)
        original = b"[Service]\nEnvironment=FIXTURE=previous\n"
        dropin.write_bytes(original)
        dropin.chmod(0o640)
        with mock.patch.object(h, "quiet_queue", return_value=contextlib.nullcontext()), mock.patch.object(
                h, "affected_units", return_value=[]), mock.patch.object(h, "command"), mock.patch.object(
                h, "service_smoke", side_effect=[h.ToolError("smoke failed"), None]):
            with self.assertRaisesRegex(h.ToolError, "previous version restored"):
                h.activate(self.config, "kasmvnc", tree, self.log)
        self.assertEqual(dropin.read_bytes(), original)
        self.assertEqual(dropin.stat().st_mode & 0o777, 0o640)
        self.assertEqual(os.readlink(tree.parent / "current"), "1.4.2")
        self.assertEqual(len(list(tree.parent.glob("rollback-*.json"))), 1)

    def test_shortcut_failure_after_success_keeps_authoritative_recovery_artifact(self):
        tree = self.installed_tree()
        original = h.atomic_link

        def switch(target, path):
            if path.name == "previous":
                raise OSError("shortcut unavailable")
            return original(target, path)

        with mock.patch.object(h, "quiet_queue", return_value=contextlib.nullcontext()), mock.patch.object(
                h, "affected_units", return_value=[]), mock.patch.object(h, "service_smoke"), mock.patch.object(h, "atomic_link", side_effect=switch):
            result = h.activate(self.config, "bun", tree, self.log)
        self.assertEqual(result["smoke"], "passed")
        self.assertEqual(os.readlink(tree.parent / "current"), "1.4.3")
        self.assertEqual(json.loads(Path(result["rollbackArtifact"]).read_text())["links"][str(tree.parent / "current")], "1.4.2")

    def test_regular_installation_is_never_overwritten(self):
        tree = self.installed_tree()
        (self.root / "bin/bun").unlink()
        (self.root / "bin/bun").write_text("keep")
        with self.assertRaisesRegex(h.ToolError, "non-symlink"):
            h.activate(self.config, "bun", tree, self.log)
        self.assertEqual((self.root / "bin/bun").read_text(), "keep")

    def test_busy_precheck_has_no_download(self):
        tree = self.installed_tree()
        (self.root / "bin/bun").unlink()
        (self.root / "bin/bun").symlink_to(tree / "bin/bun")
        with mock.patch.object(h, "command", return_value="1.4.2"), mock.patch.object(
                h, "quiet_queue", side_effect=h.ToolError("busy")), mock.patch.object(h, "prepare") as prepare:
            with self.assertRaisesRegex(h.ToolError, "busy"):
                h.apply(self.config, "bun", "1.4.3", self.log)
        prepare.assert_not_called()

    def test_node_major_migration_and_unknown_tool_are_rejected(self):
        node = self.root / "bin/node"
        node.write_text("fixture")
        with mock.patch.object(h, "command", return_value="v24.21.0"):
            with self.assertRaisesRegex(h.ToolError, "major migration"):
                h.apply(self.config, "node", "26.0.0", self.log)
        for tool, version in (("curl", "1.0.0"), ("node", "latest"), ("node", "1.2.3;id")):
            with self.assertRaisesRegex(h.ToolError, "unknown"):
                h.apply(self.config, tool, version, self.log)

    def test_kasm_has_scoped_parallel_path_no_dpkg_install(self):
        content = h.kasm_dropin(Path("/opt/helena/host-tools/kasmvnc/current"))
        self.assertIn("current/bin/Xvnc", content)
        self.assertIn("current/usr/share/kasmvnc/www", content)
        self.assertNotIn("apt", content)
        with mock.patch.object(h, "command", return_value="volition-project-browser-kasm@vol.service loaded active running\n"), mock.patch.object(h.subprocess, "run", return_value=mock.Mock(returncode=0)):
            self.assertEqual(h.affected_units("kasmvnc"), ["volition-project-browser-kasm@vol.service", "volition-project-browser-chromium@vol.service"])

    def test_kasm_update_does_not_start_a_stopped_chromium(self):
        def active(args, **kwargs):
            return mock.Mock(returncode=1 if "-chromium@" in args[-1] else 0)

        with mock.patch.object(h, "command", return_value="volition-project-browser-kasm@vol.service loaded active running\n"), mock.patch.object(h.subprocess, "run", side_effect=active):
            self.assertEqual(h.affected_units("kasmvnc"), ["volition-project-browser-kasm@vol.service"])

    def test_quiet_gate_fails_closed_and_checks_pending_chats(self):
        process = mock.Mock()
        process.stdout.readline.return_value = "busy\n"
        with mock.patch.object(h.subprocess, "Popen", return_value=process) as popen, mock.patch.object(h.select, "select", return_value=([process.stdout], [], [])):
            with self.assertRaisesRegex(h.ToolError, "deferred"):
                with h.quiet_queue(self.config):
                    self.fail("busy gate entered")
        self.assertEqual(popen.call_args.args[0], ["/usr/sbin/runuser", "-u", "postgres",
                         "--", "psql", "-XAtq", "-v", "ON_ERROR_STOP=1", "-d", "fixture"])
        sql = process.stdin.write.call_args.args[0]
        self.assertIn("LOCK TABLE agent_run, agent_chat_message IN SHARE MODE", sql)
        self.assertIn("('pending','streaming')", sql)
        process.communicate.assert_called_once_with("ROLLBACK;\n", timeout=5)

    def test_privilege_drop_resolves_runuser_without_widening_child_path(self):
        with mock.patch.object(h.os, "geteuid", return_value=0), mock.patch.object(
                h.os, "chown") as chown, mock.patch.object(
                h.subprocess, "run", return_value=mock.Mock(returncode=0, stdout="65534\n")) as run:
            result = h.command(["/usr/bin/id", "-u"], user="nobody", timeout=5)
        self.assertEqual(result, "65534\n")
        self.assertEqual(run.call_args.args[0], ["/usr/sbin/runuser", "--preserve-environment", "-u", "nobody", "--",
                         "setpriv", "--no-new-privs", "--", "/usr/bin/id", "-u"])
        self.assertEqual(run.call_args.kwargs["env"]["PATH"], "/usr/local/bin:/usr/bin:/bin")
        self.assertEqual(run.call_args.kwargs["timeout"], 5)
        home = Path(run.call_args.kwargs["env"]["HOME"])
        self.assertTrue(str(home).startswith("/tmp/helena-host-tool-"))
        self.assertFalse(home.exists())
        account = h.pwd.getpwnam("nobody")
        self.assertEqual(chown.call_args_list, [
            mock.call(home / "npm-user-config", account.pw_uid, account.pw_gid),
            mock.call(home / "npm-global-config", account.pw_uid, account.pw_gid),
            mock.call(home, account.pw_uid, account.pw_gid),
        ])

    def test_npm_build_uses_memory_limited_scope_with_private_home(self):
        with mock.patch.object(h.os, "geteuid", return_value=0), mock.patch.object(
                h.os, "chown"), mock.patch.object(
                h.subprocess, "run", return_value=mock.Mock(returncode=0, stdout="")) as execute:
            h.command(["/usr/bin/node", "npm-cli.js", "ci"], user="nobody", limited=True)
        command = execute.call_args.args[0]
        self.assertEqual(command[:2], ["systemd-run", "--scope"])
        self.assertIn("MemoryHigh=12G", command)
        self.assertIn("MemoryMax=16G", command)
        self.assertIn("CPUWeight=20", command)
        self.assertIn("/usr/sbin/runuser", command)

    def test_version_and_frozen_prepared_smoke_use_private_home(self):
        tree = self.root / "code-fixture"
        (tree / "bin").mkdir(parents=True)
        binary = tree / "bin/code-server"
        binary.write_text("#!/bin/sh\n"
                          "case \"$HOME\" in /tmp/helena-host-tool-*) ;; *) exit 37;; esac\n"
                          "test \"$HOME\" != \"$PWD\" || exit 38\n"
                          "mkdir -p \"$HOME/.config/code-server\" || exit 39\n"
                          "printf fixture > \"$HOME/.config/code-server/config.yaml\"\n"
                          "printf '4.139.1\\n'\n")
        binary.chmod(0o755)
        h.freeze_tree(tree)
        tree.chmod(0o555)  # Even the local fixture owner cannot use the release as HOME.
        self.addCleanup(tree.chmod, 0o755)
        self.assertFalse(tree.stat().st_mode & 0o222)
        self.assertEqual(h.command([str(binary), "--version"], user="nobody").strip(), "4.139.1")
        with mock.patch.object(h, "session_smoke") as smoke:
            h.binary_smoke("code-server", tree, "4.139.1")
        smoke.assert_called_once_with("code-server", binary)
        self.assertFalse((tree / ".config").exists())
        self.assertEqual(sorted(p.name for p in tree.iterdir()), ["bin"])

    def test_private_home_preserves_controlled_npm_cache_and_drops_owner_env(self):
        homes = []
        def run(args, **kwargs):
            env = kwargs["env"]
            home = Path(env["HOME"])
            homes.append(home)
            self.assertEqual(home.stat().st_mode & 0o777, 0o700)
            self.assertNotEqual(home, self.root)
            self.assertEqual(env["NPM_CONFIG_CACHE"], str(self.root / ".npm"))
            configs = [Path(env[name]) for name in
                       ("NPM_CONFIG_USERCONFIG", "NPM_CONFIG_GLOBALCONFIG")]
            self.assertNotEqual(configs[0], configs[1])
            for config in configs:
                self.assertEqual(config.parent, home)
                self.assertEqual(config.stat().st_mode & 0o777, 0o600)
                self.assertEqual(config.read_bytes(), b"")
                self.assertFalse(config.is_symlink())
            self.assertNotIn("OWNER_SECRET_FIXTURE", env)
            self.assertNotIn("XDG_CONFIG_HOME", env)
            return mock.Mock(returncode=0, stdout="ok")
        with mock.patch.dict(os.environ, {"HOME": "/private-owner-home", "XDG_CONFIG_HOME": "/private-owner-config", "OWNER_SECRET_FIXTURE": "synthetic"}), mock.patch.object(h.subprocess, "run", side_effect=run):
            for _ in range(2):
                h.command(["synthetic-npm"], cwd=self.root, user="nobody")
        self.assertNotEqual(homes[0], homes[1])
        self.assertTrue(all(not p.exists() for p in homes))

    def test_root_command_also_has_private_distinct_empty_npm_configs(self):
        homes = []
        def run(args, **kwargs):
            env = kwargs["env"]
            home = Path(env["HOME"])
            homes.append(home)
            self.assertEqual(home.stat().st_mode & 0o777, 0o700)
            self.assertNotEqual(home, self.root)
            configs = [Path(env[name]) for name in
                       ("NPM_CONFIG_USERCONFIG", "NPM_CONFIG_GLOBALCONFIG")]
            self.assertNotEqual(configs[0].stat().st_ino, configs[1].stat().st_ino)
            for config in configs:
                self.assertEqual(config.parent, home)
                self.assertEqual(config.stat().st_mode & 0o777, 0o600)
                self.assertEqual(config.stat().st_uid, os.geteuid())
                self.assertEqual(config.read_bytes(), b"")
            self.assertEqual(env["PATH"], "/usr/local/bin:/usr/bin:/bin")
            self.assertEqual(env["NPM_CONFIG_CACHE"], str((kwargs["cwd"] or home) / ".npm"))
            self.assertNotIn("OWNER_SECRET_FIXTURE", env)
            self.assertNotIn("NPM_TOKEN", env)
            self.assertEqual(args, ["synthetic-npm", "config", "get", "registry"])
            return mock.Mock(returncode=0, stdout="https://registry.npmjs.org\n")
        with mock.patch.dict(os.environ, {"OWNER_SECRET_FIXTURE": "synthetic", "NPM_TOKEN": "synthetic"}), mock.patch.object(h.subprocess, "run", side_effect=run), mock.patch.object(h.os, "chown") as chown:
            for cwd in (None, self.root):
                self.assertEqual(h.command(["synthetic-npm", "config", "get", "registry"], cwd=cwd),
                                 "https://registry.npmjs.org\n")
        chown.assert_not_called()
        self.assertNotEqual(homes[0], homes[1])
        self.assertTrue(all(not home.exists() for home in homes))

    def test_private_home_is_cleaned_after_error_or_timeout(self):
        homes = []
        for user in ("nobody", None):
            for fail in (False, True):
                def run(args, **kwargs):
                    home = Path(kwargs["env"]["HOME"])
                    homes.append(home)
                    (home / "temporary-config").write_text("synthetic")
                    if fail:
                        raise subprocess.TimeoutExpired(args, kwargs["timeout"])
                    return mock.Mock(returncode=1, stdout="synthetic private failure detail")
                with mock.patch.object(h.subprocess, "run", side_effect=run):
                    with self.assertRaises(subprocess.TimeoutExpired if fail else h.ToolError):
                        h.command(["synthetic-version"], user=user, timeout=1)
        self.assertTrue(all(not p.exists() for p in homes))

    def test_binary_smoke_executes_fixture_and_matches_version(self):
        tree = self.root / "fixture"
        (tree / "bin").mkdir(parents=True)
        binary = tree / "bin/bun"
        binary.write_text("#!/bin/sh\nprintf '1.4.3\\n'\n")
        binary.chmod(0o755)
        h.binary_smoke("bun", tree, "1.4.3")
        with self.assertRaisesRegex(h.ToolError, "requested version"):
            h.binary_smoke("bun", tree, "1.4.4")


if __name__ == "__main__":
    unittest.main()
