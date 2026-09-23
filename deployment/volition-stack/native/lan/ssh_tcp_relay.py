#!/usr/bin/env python3
"""Small, bounded TCP relay for LAN access to the native Debian SSH service."""

import argparse
import asyncio
import ipaddress
import signal
import time
from contextlib import suppress


BUFFER_BYTES = 64 * 1024


class Relay:
    def __init__(self, args: argparse.Namespace) -> None:
        self.args = args
        self.allowed = ipaddress.ip_network(args.allow_source, strict=True)
        self.active = 0

    async def handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        peer = writer.get_extra_info("peername")
        try:
            address = ipaddress.ip_address(peer[0]) if peer else None
        except ValueError:
            address = None
        if address is None or address not in self.allowed or self.active >= self.args.max_connections:
            writer.close()
            with suppress(ConnectionError, OSError):
                await writer.wait_closed()
            return

        self.active += 1
        upstream_writer: asyncio.StreamWriter | None = None
        try:
            upstream_reader, upstream_writer = await asyncio.wait_for(
                asyncio.open_connection(self.args.target_host, self.args.target_port),
                timeout=self.args.connect_timeout,
            )
            last_activity = time.monotonic()

            async def pump(source: asyncio.StreamReader, destination: asyncio.StreamWriter) -> None:
                nonlocal last_activity
                while data := await source.read(BUFFER_BYTES):
                    last_activity = time.monotonic()
                    destination.write(data)
                    await destination.drain()
                if destination.can_write_eof():
                    destination.write_eof()
                    await destination.drain()

            async def watchdog() -> None:
                started = time.monotonic()
                while True:
                    await asyncio.sleep(min(5.0, self.args.idle_timeout))
                    now = time.monotonic()
                    if now - last_activity >= self.args.idle_timeout:
                        raise TimeoutError("relay idle timeout")
                    if now - started >= self.args.max_lifetime:
                        raise TimeoutError("relay lifetime limit")

            pumps = asyncio.gather(
                pump(reader, upstream_writer),
                pump(upstream_reader, writer),
            )
            timer = asyncio.create_task(watchdog())
            done, pending = await asyncio.wait({pumps, timer}, return_when=asyncio.FIRST_COMPLETED)
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
            for task in done:
                task.result()
        except (ConnectionError, OSError, TimeoutError, asyncio.CancelledError):
            pass
        finally:
            try:
                if upstream_writer is not None:
                    upstream_writer.close()
                    with suppress(ConnectionError, OSError):
                        await upstream_writer.wait_closed()
                writer.close()
                with suppress(ConnectionError, OSError):
                    await writer.wait_closed()
            finally:
                self.active -= 1


async def run(args: argparse.Namespace) -> None:
    relay = Relay(args)
    server = await asyncio.start_server(relay.handle, args.bind_host, args.bind_port, backlog=64)
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for event in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(event, stop.set)
    async with server:
        await stop.wait()


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bind-host", default="192.168.2.220")
    parser.add_argument("--bind-port", type=int, default=2222)
    parser.add_argument("--allow-source", default="192.168.2.0/24")
    parser.add_argument("--target-host", default="192.168.122.58")
    parser.add_argument("--target-port", type=int, default=22)
    parser.add_argument("--connect-timeout", type=float, default=5.0)
    parser.add_argument("--idle-timeout", type=float, default=900.0)
    parser.add_argument("--max-lifetime", type=float, default=28_800.0)
    parser.add_argument("--max-connections", type=int, default=32)
    args = parser.parse_args()
    if args.connect_timeout <= 0 or args.idle_timeout <= 0 or args.max_lifetime <= 0:
        parser.error("timeouts must be positive")
    if not 1 <= args.max_connections <= 256:
        parser.error("max-connections must be between 1 and 256")
    return args


if __name__ == "__main__":
    asyncio.run(run(arguments()))
