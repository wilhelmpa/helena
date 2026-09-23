#!/usr/bin/env python3
"""Publish a LAN-only hostname and service records through the host Avahi daemon."""

from __future__ import annotations

import argparse
import fcntl
import ipaddress
import re
import signal
import socket
import struct
import sys

import dbus
from dbus.mainloop.glib import DBusGMainLoop
from gi.repository import GLib


AVAHI_BUS = "org.freedesktop.Avahi"
AVAHI_SERVER = "org.freedesktop.Avahi.Server"
AVAHI_ENTRY_GROUP = "org.freedesktop.Avahi.EntryGroup"
AVAHI_PROTO_INET = 0
AVAHI_SERVER_RUNNING = 2
AVAHI_ENTRY_GROUP_ESTABLISHED = 2
AVAHI_ENTRY_GROUP_COLLISION = 3
AVAHI_ENTRY_GROUP_FAILURE = 4
AVAHI_PUBLISH_NO_REVERSE = 16
SIOCGIFADDR = 0x8915


def interface_ipv4(name: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_.:-]{1,15}", name):
        raise ValueError("invalid interface name")
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
        packed = struct.pack("256s", name.encode("ascii"))
        result = fcntl.ioctl(probe.fileno(), SIOCGIFADDR, packed)
    return socket.inet_ntoa(result[20:24])


def validate(interface: str, address: str, hostname: str) -> int:
    expected = ipaddress.ip_address(address)
    if expected.version != 4 or not expected.is_private:
        raise ValueError("publisher address must be a private IPv4 address")
    if not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.local", hostname):
        raise ValueError("publisher hostname must be a lowercase single-label .local name")
    index = socket.if_nametoindex(interface)
    actual = interface_ipv4(interface)
    if actual != address:
        raise RuntimeError(f"{interface} has {actual}, expected {address}; refusing publication")
    return index


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser()
    result.add_argument("--interface", required=True)
    result.add_argument("--address", required=True)
    result.add_argument("--hostname", required=True)
    result.add_argument("--http-port", type=int, default=80)
    result.add_argument("--ssh-port", type=int, default=2222)
    result.add_argument("--check", action="store_true")
    return result


def run() -> int:
    args = parser().parse_args()
    if not 1 <= args.http_port <= 65535 or not 1 <= args.ssh_port <= 65535:
        raise ValueError("service port is outside the valid range")

    interface_index = validate(args.interface, args.address, args.hostname)
    DBusGMainLoop(set_as_default=True)
    bus = dbus.SystemBus()
    server_object = bus.get_object(AVAHI_BUS, "/")
    server = dbus.Interface(server_object, AVAHI_SERVER)
    if int(server.GetState()) != AVAHI_SERVER_RUNNING:
        raise RuntimeError("Avahi is not ready")
    avahi_index = int(server.GetNetworkInterfaceIndexByName(args.interface))
    if avahi_index != interface_index:
        raise RuntimeError("Avahi and the kernel disagree about the interface index")

    if args.check:
        print(
            f"publisher check passed: {args.hostname} -> {args.address} "
            f"on {args.interface} ({interface_index})"
        )
        return 0

    group_path = server.EntryGroupNew()
    group_object = bus.get_object(AVAHI_BUS, group_path)
    group = dbus.Interface(group_object, AVAHI_ENTRY_GROUP)
    loop = GLib.MainLoop()
    outcome = {"code": 1, "established": False}

    def state_changed(state: int, error: str) -> None:
        state = int(state)
        if state == AVAHI_ENTRY_GROUP_ESTABLISHED:
            outcome["code"] = 0
            outcome["established"] = True
            print(
                f"published {args.hostname} -> {args.address} on {args.interface}; "
                f"HTTP {args.http_port}, SSH {args.ssh_port}",
                flush=True,
            )
        elif state == AVAHI_ENTRY_GROUP_COLLISION:
            print(f"Avahi name collision for {args.hostname}: {error}", file=sys.stderr, flush=True)
            outcome["code"] = 3
            loop.quit()
        elif state == AVAHI_ENTRY_GROUP_FAILURE:
            print(f"Avahi publication failed: {error}", file=sys.stderr, flush=True)
            outcome["code"] = 4
            loop.quit()

    group.connect_to_signal("StateChanged", state_changed)
    empty_txt = dbus.Array([], signature="ay")
    try:
        group.AddAddress(
            dbus.Int32(interface_index),
            dbus.Int32(AVAHI_PROTO_INET),
            # The host address already owns the m5.local reverse PTR. This is
            # an additional forward alias, so publishing another PTR would be
            # a local collision and would also make reverse lookup ambiguous.
            dbus.UInt32(AVAHI_PUBLISH_NO_REVERSE),
            args.hostname,
            args.address,
        )
        group.AddService(
            dbus.Int32(interface_index),
            dbus.Int32(AVAHI_PROTO_INET),
            dbus.UInt32(0),
            "Volition Plan on Kingston",
            "_http._tcp",
            "",
            args.hostname,
            dbus.UInt16(args.http_port),
            empty_txt,
        )
        group.AddService(
            dbus.Int32(interface_index),
            dbus.Int32(AVAHI_PROTO_INET),
            dbus.UInt32(0),
            "Kingston SSH relay",
            "_ssh._tcp",
            "",
            args.hostname,
            dbus.UInt16(args.ssh_port),
            empty_txt,
        )
        group.Commit()
    except dbus.DBusException as error:
        name = error.get_dbus_name() or "D-Bus error"
        detail = error.get_dbus_message() or str(error)
        print(f"Avahi publication rejected ({name}): {detail}", file=sys.stderr)
        try:
            group.Free()
        except dbus.DBusException:
            pass
        return 3 if "Collision" in name else 4

    def stop(_signum: int, _frame: object) -> None:
        outcome["code"] = 0
        loop.quit()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    loop.run()
    try:
        group.Free()
    except dbus.DBusException:
        pass
    if not outcome["established"] and outcome["code"] == 0:
        print("publication stopped before it was established", file=sys.stderr)
    return int(outcome["code"])


def main() -> int:
    try:
        return run()
    except (OSError, RuntimeError, ValueError, dbus.DBusException) as error:
        print(f"publisher error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
