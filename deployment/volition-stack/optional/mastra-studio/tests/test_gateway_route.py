from __future__ import annotations

import importlib.util
import json
import stat
import tempfile
import unittest
from pathlib import Path
from unittest import mock


MODULE_PATH = Path(__file__).resolve().parents[1] / "gateway-route.py"
SPEC = importlib.util.spec_from_file_location("gateway_route", MODULE_PATH)
assert SPEC and SPEC.loader
gateway_route = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(gateway_route)


def base_config() -> dict:
    return {
        "port": 8088,
        "newConcurrentField": {"kept": True},
        "routes": {
            "plan.volition.one": {
                "target": "http://web:3001",
                "audience": "plan-audience",
                "paths": [
                    {"prefix": "/backend", "target": "http://api:3000"},
                    {"prefix": "/mcp", "target": "http://api:3000", "stripPrefix": False},
                ],
            },
            "other.volition.one": {"target": "http://other:8080", "custom": [1, 2, 3]},
        },
    }


class GatewayRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.config_path = Path(self.temporary.name) / "gateway.json"

    def write_config(self, value: dict, mode: int = 0o640) -> bytes:
        data = (json.dumps(value, indent=4) + "\n").encode()
        self.config_path.write_bytes(data)
        self.config_path.chmod(mode)
        return data

    def read_config(self) -> dict:
        return json.loads(self.config_path.read_bytes())

    def test_add_remove_roundtrip_preserves_unrelated_semantics_and_mode(self) -> None:
        original = base_config()
        original_bytes = self.write_config(original)

        self.assertEqual(gateway_route.update_route("add", self.config_path), "added")
        added = self.read_config()
        self.assertEqual(added["newConcurrentField"], {"kept": True})
        self.assertEqual(added["routes"]["other.volition.one"], original["routes"]["other.volition.one"])
        self.assertEqual(added["routes"][gateway_route.HOST]["paths"][-1], gateway_route.OWNED_ROUTE)
        self.assertEqual(stat.S_IMODE(self.config_path.stat().st_mode), 0o640)

        backup = self.config_path.parent / ".state" / "gateway.json.before-mastra-studio"
        self.assertEqual(backup.read_bytes(), original_bytes)
        self.assertEqual(stat.S_IMODE(backup.stat().st_mode), 0o600)

        self.assertEqual(gateway_route.update_route("add", self.config_path), "already present")
        self.assertEqual(gateway_route.update_route("remove", self.config_path), "removed")
        self.assertEqual(self.read_config(), original)
        self.assertEqual(gateway_route.update_route("remove", self.config_path), "already absent")
        self.assertEqual(backup.read_bytes(), original_bytes)

    def test_conflicting_exact_route_fails_without_writing(self) -> None:
        config = base_config()
        config["routes"][gateway_route.HOST]["paths"].append(
            {"prefix": "/mastra", "target": "http://127.0.0.1:4111", "stripPrefix": False}
        )
        original = self.write_config(config)
        for action in ("add", "remove"):
            with self.subTest(action=action):
                with self.assertRaises(gateway_route.RouteConflictError):
                    gateway_route.update_route(action, self.config_path)
                self.assertEqual(self.config_path.read_bytes(), original)

    def test_parent_and_child_prefixes_conflict(self) -> None:
        for prefix in ("/", "/mastra/admin"):
            with self.subTest(prefix=prefix):
                config = base_config()
                config["routes"][gateway_route.HOST]["paths"].append(
                    {"prefix": prefix, "target": "http://unrelated:9000"}
                )
                original = self.write_config(config)
                with self.assertRaises(gateway_route.RouteConflictError):
                    gateway_route.update_route("add", self.config_path)
                self.assertEqual(self.config_path.read_bytes(), original)

    def test_duplicate_owned_routes_are_never_removed(self) -> None:
        config = base_config()
        config["routes"][gateway_route.HOST]["paths"].extend(
            [dict(gateway_route.OWNED_ROUTE), dict(gateway_route.OWNED_ROUTE)]
        )
        original = self.write_config(config)
        with self.assertRaises(gateway_route.RouteConflictError):
            gateway_route.update_route("remove", self.config_path)
        self.assertEqual(self.config_path.read_bytes(), original)

    def test_concurrent_external_change_is_detected_and_preserved(self) -> None:
        config = base_config()
        self.write_config(config)
        reads = 0

        def racing_read(path: Path) -> bytes:
            nonlocal reads
            reads += 1
            if reads == 2:
                concurrent = json.loads(path.read_bytes())
                concurrent["newConcurrentField"] = {"kept": "external-update"}
                path.write_text(json.dumps(concurrent) + "\n")
            return path.read_bytes()

        with mock.patch.object(gateway_route, "_read_bytes", side_effect=racing_read):
            with self.assertRaises(gateway_route.ConcurrentModificationError):
                gateway_route.update_route("add", self.config_path)
        self.assertEqual(self.read_config()["newConcurrentField"], {"kept": "external-update"})
        self.assertNotIn(gateway_route.OWNED_ROUTE, self.read_config()["routes"][gateway_route.HOST]["paths"])
        self.assertFalse((self.config_path.parent / ".state" / "gateway.json.before-mastra-studio").exists())


if __name__ == "__main__":
    unittest.main()
