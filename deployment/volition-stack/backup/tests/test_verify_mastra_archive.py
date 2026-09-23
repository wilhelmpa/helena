import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import unittest

MODULE_PATH = Path(__file__).with_name("verify-mastra-archive.py")
SPEC = importlib.util.spec_from_file_location("verify_mastra_archive", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class VerifyMastraArchiveTest(unittest.TestCase):
    def archive(self, entries):
        temporary = tempfile.NamedTemporaryFile(suffix=".tar", delete=False)
        temporary.close()
        path = Path(temporary.name)
        self.addCleanup(path.unlink, missing_ok=True)
        with tarfile.open(path, "w") as handle:
            for name, kind, value in entries:
                info = tarfile.TarInfo(name)
                if kind == "file":
                    data = value.encode()
                    info.size = len(data)
                    handle.addfile(info, io.BytesIO(data))
                elif kind == "directory":
                    info.type = tarfile.DIRTYPE
                    handle.addfile(info)
                elif kind == "symlink":
                    info.type = tarfile.SYMTYPE
                    info.linkname = value
                    handle.addfile(info)
        return path

    def test_accepts_non_empty_sqlite_archive(self):
        path = self.archive(
            [
                ("./mastra-data", "directory", ""),
                ("./mastra-data/studio.db", "file", "sqlite"),
                ("./mastra-data/studio.db-wal", "file", "wal"),
            ]
        )
        MODULE.validate_archive(path)

    def test_rejects_missing_or_empty_database(self):
        with self.assertRaises(ValueError):
            MODULE.validate_archive(self.archive([("./mastra-data/studio.db", "file", "")]))

    def test_rejects_paths_outside_root(self):
        with self.assertRaises(ValueError):
            MODULE.validate_archive(
                self.archive(
                    [
                        ("./mastra-data/studio.db", "file", "sqlite"),
                        ("./other/secret", "file", "no"),
                    ]
                )
            )

    def test_rejects_links(self):
        with self.assertRaises(ValueError):
            MODULE.validate_archive(
                self.archive(
                    [
                        ("./mastra-data/studio.db", "file", "sqlite"),
                        ("./mastra-data/link", "symlink", "/etc/passwd"),
                    ]
                )
            )

    def test_backup_contract_pauses_archives_restores_and_cleans_mastra(self):
        script = MODULE_PATH.parent.parent.joinpath("backup.sh").read_text()
        paused = script.index("pause_containers itsaplan-api-1")
        self.assertIn("volition-mastra-studio-studio-1", script[paused : paused + 160])
        archived = script.index("/backup/mastra-data.tar.new")
        unpaused = script.index("unpause_containers", archived)
        self.assertLess(paused, archived)
        self.assertLess(archived, unpaused)
        self.assertIn(
            "--include /home/pw/services/volition-backups/current/mastra-data.tar",
            script,
        )
        self.assertIn("plan-residual-volumes.tar mastra-data.tar application-volumes.tar", script)


if __name__ == "__main__":
    unittest.main()
