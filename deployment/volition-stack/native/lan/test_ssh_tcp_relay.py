#!/usr/bin/env python3

import argparse
import asyncio
import unittest
from unittest.mock import patch

from ssh_tcp_relay import Relay


class ResetReader:
    async def read(self, _size: int) -> bytes:
        raise ConnectionResetError("reset")


class ResetWriter:
    def __init__(self, peer: tuple[str, int]) -> None:
        self.peer = peer
        self.closed = False

    def get_extra_info(self, name: str):
        return self.peer if name == "peername" else None

    def close(self) -> None:
        self.closed = True

    async def wait_closed(self) -> None:
        raise ConnectionResetError("reset while closing")

    def can_write_eof(self) -> bool:
        return False

    def write(self, _data: bytes) -> None:
        pass

    async def drain(self) -> None:
        pass


def options() -> argparse.Namespace:
    return argparse.Namespace(
        allow_source="192.168.2.0/24",
        max_connections=32,
        target_host="192.168.122.58",
        target_port=22,
        connect_timeout=5.0,
        idle_timeout=900.0,
        max_lifetime=28_800.0,
    )


class RelayCleanupTest(unittest.IsolatedAsyncioTestCase):
    async def test_connection_resets_cannot_leak_capacity(self) -> None:
        relay = Relay(options())
        for _ in range(40):
            downstream = ResetWriter(("192.168.2.42", 50_000))
            upstream = ResetWriter(("192.168.122.58", 22))
            with patch.object(
                asyncio,
                "open_connection",
                return_value=(ResetReader(), upstream),
            ):
                await relay.handle(ResetReader(), downstream)
            self.assertTrue(downstream.closed)
            self.assertTrue(upstream.closed)
            self.assertEqual(relay.active, 0)

    async def test_denied_connection_ignores_reset_during_close(self) -> None:
        relay = Relay(options())
        denied = ResetWriter(("192.168.3.42", 50_000))
        await relay.handle(ResetReader(), denied)
        self.assertTrue(denied.closed)
        self.assertEqual(relay.active, 0)


if __name__ == "__main__":
    unittest.main()
