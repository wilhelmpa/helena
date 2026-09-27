import json
import os
from pathlib import Path
import shutil
import stat
import tempfile
import unittest

from fixtures import fixture, prepare, verify


class FixturesTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        # macOS /var is a system symlink; the operator requires its canonical root.
        self.root = Path(self.temp.name).resolve()
        self.work = self.root / "review"
        self.vault = self.root / "vault"
        self.vault.mkdir()
        self.manifest = prepare(self.work, "PROOF", "vaultproof-abc123def456")
        self.folder = self.vault / self.manifest["folder"]

    def tearDown(self):
        self.temp.cleanup()

    def put(self, stage):
        manifest, contents, binaries, artifact = fixture("PROOF", "vaultproof-abc123def456")
        if self.folder.exists():
            shutil.rmtree(self.folder)
        self.folder.mkdir(parents=True)
        for name, data in binaries.items():
            (self.folder / name).write_bytes(data)
        (self.vault / manifest["stages"][stage]["path"]).write_bytes(contents[stage])
        if stage not in ("upload", "ui"):
            (self.folder / "Agent-artifact.md").write_bytes(artifact)

    def test_complete_cycle_and_no_overwrite(self):
        self.assertTrue(verify(self.work, self.vault, "absent")["success"])
        for stage in ("upload", "ui", "agent", "silverbullet", "renamed", "restart"):
            self.put(stage)
            self.assertTrue(verify(self.work, self.vault, stage)["success"])
        with self.assertRaises(FileExistsError):
            prepare(self.work, "PROOF", "vaultproof-abc123def456")
        self.assertEqual(stat.S_IMODE(self.work.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE((self.work / "manifest.json").stat().st_mode), 0o600)

    def test_changed_bytes_and_second_active_copy_fail(self):
        self.put("upload")
        (self.folder / "original.pdf").write_bytes(b"wrong")
        with self.assertRaises(ValueError):
            verify(self.work, self.vault, "upload")
        self.put("renamed")
        (self.folder / "Cycle.md").write_bytes(b"old copy")
        with self.assertRaises(ValueError):
            verify(self.work, self.vault, "renamed")

    def test_symlink_and_nonregular_files_are_never_read(self):
        self.put("upload")
        target = self.folder / "Cycle.md"
        target.unlink()
        target.symlink_to(self.work / "upload/Cycle.md")
        with self.assertRaises(OSError):
            verify(self.work, self.vault, "upload")
        target.unlink()
        os.mkfifo(target)
        with self.assertRaises(ValueError):
            verify(self.work, self.vault, "upload")
        target.unlink()
        target.write_bytes(b"x" * 16385)
        with self.assertRaises(ValueError):
            verify(self.work, self.vault, "upload")
        alias = self.root / "alias"
        alias.symlink_to(self.vault, target_is_directory=True)
        with self.assertRaises(OSError):
            verify(self.work, alias, "upload")

    def test_manifest_cannot_redirect_to_unrelated_files(self):
        saved = json.loads((self.work / "manifest.json").read_text())
        saved["stages"]["upload"]["path"] = "Private/real.md"
        (self.work / "manifest.json").write_text(json.dumps(saved))
        with self.assertRaises(ValueError):
            verify(self.work, self.vault, "upload")
        for project, run in (("../Private", "vaultproof-abc123def456"), ("PROOF", "../other")):
            with self.assertRaises(ValueError):
                fixture(project, run)


if __name__ == "__main__":
    unittest.main()
