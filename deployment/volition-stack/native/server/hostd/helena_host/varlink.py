"""A small Varlink server (https://varlink.org): JSON messages terminated by a NUL byte over a
Unix socket. Varlink is systemd's own IPC for new services, so `varlinkctl` (systemd ≥ 255)
can call and introspect the helper without any Helena code:

    varlinkctl info /run/helena-hostd/hostd.sock
    varlinkctl call /run/helena-hostd/hostd.sock io.helena.hostd.SystemStatus '{}'

Only what hostd needs is implemented: calls with one reply, `oneway`, the
org.varlink.service interface (GetInfo, GetInterfaceDescription) and the standard errors.
Streaming replies ("more") are answered with one final reply."""

from __future__ import annotations

import json
import pwd
import socket
import struct
import threading
from typing import Callable

MAX_MESSAGE = 1_048_576
IDLE_TIMEOUT = 60.0
MAX_CONNECTIONS = 16
_UCRED = struct.Struct('3i')

SERVICE_INTERFACE = """# The Varlink service interface
interface org.varlink.service

method GetInfo() -> (
  vendor: string,
  product: string,
  version: string,
  url: string,
  interfaces: []string
)

method GetInterfaceDescription(interface: string) -> (description: string)

error InterfaceNotFound (interface: string)
error MethodNotFound (method: string)
error MethodNotImplemented (method: string)
error InvalidParameter (parameter: string)
error PermissionDenied ()
error ExpectedMore ()
"""


class VarlinkError(Exception):
    def __init__(self, error: str, parameters: dict | None = None):
        super().__init__(error)
        self.error = error
        self.parameters = parameters or {}


def peer_credentials(sock: socket.socket) -> tuple[int, int, int]:
    data = sock.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, _UCRED.size)
    return _UCRED.unpack(data)


class Server:
    """Serves one interface. `dispatch(method, parameters, caller)` returns the reply's
    parameters or raises VarlinkError; `authorize(uid)` returns the caller's name or None."""

    def __init__(self, *, interface: str, description: str, info: dict,
                 dispatch: Callable[[str, dict, dict], dict],
                 authorize: Callable[[int], str | None], log: Callable[[str], None]):
        self.interface = interface
        self.description = description
        self.info = info
        self.dispatch = dispatch
        self.authorize = authorize
        self.log = log
        self.slots = threading.BoundedSemaphore(MAX_CONNECTIONS)
        self.stopping = threading.Event()

    def serve(self, listener: socket.socket) -> None:
        listener.settimeout(1.0)
        while not self.stopping.is_set():
            try:
                conn, _ = listener.accept()
            except socket.timeout:
                continue
            except OSError:
                if self.stopping.is_set():
                    break
                raise
            if not self.slots.acquire(blocking=False):
                conn.close()
                continue
            threading.Thread(target=self._connection, args=(conn,), daemon=True).start()

    def _connection(self, conn: socket.socket) -> None:
        try:
            _pid, uid, _gid = peer_credentials(conn)
            caller_name = self.authorize(uid)
            if caller_name is None:
                try:
                    name = pwd.getpwuid(uid).pw_name
                except KeyError:
                    name = str(uid)
                self.log(f'refused a connection from {name}')
                self._send(conn, {'error': 'org.varlink.service.PermissionDenied', 'parameters': {}})
                return
            caller = {'uid': uid, 'name': caller_name}
            conn.settimeout(IDLE_TIMEOUT)
            buffer = b''
            while True:
                while b'\0' not in buffer:
                    chunk = conn.recv(65536)
                    if not chunk:
                        return
                    buffer += chunk
                    if len(buffer) > MAX_MESSAGE:
                        self._send(conn, {'error': 'org.varlink.service.InvalidParameter',
                                          'parameters': {'parameter': 'message'}})
                        return
                raw, buffer = buffer.split(b'\0', 1)
                reply = self._handle(raw, caller)
                if reply is not None:
                    self._send(conn, reply)
        except (OSError, socket.timeout):
            pass
        finally:
            try:
                conn.close()
            finally:
                self.slots.release()

    def _handle(self, raw: bytes, caller: dict) -> dict | None:
        try:
            message = json.loads(raw)
        except ValueError:
            return {'error': 'org.varlink.service.InvalidParameter', 'parameters': {'parameter': 'message'}}
        if not isinstance(message, dict) or not isinstance(message.get('method'), str):
            return {'error': 'org.varlink.service.InvalidParameter', 'parameters': {'parameter': 'method'}}
        oneway = message.get('oneway') is True
        method = message['method']
        parameters = message.get('parameters') or {}
        if not isinstance(parameters, dict):
            return {'error': 'org.varlink.service.InvalidParameter', 'parameters': {'parameter': 'parameters'}}
        try:
            result = self._call(method, parameters, caller)
            reply: dict = {'parameters': result}
        except VarlinkError as error:
            reply = {'error': error.error, 'parameters': error.parameters}
        except Exception as error:  # noqa: BLE001 - one bad request never stops the helper
            self.log(f'{method} failed: {type(error).__name__}: {error}')
            reply = {'error': f'{self.interface}.Internal', 'parameters': {'message': 'the helper failed'}}
        return None if oneway else reply

    def _call(self, method: str, parameters: dict, caller: dict) -> dict:
        interface, _, name = method.rpartition('.')
        if interface == 'org.varlink.service':
            if name == 'GetInfo':
                return {**self.info, 'interfaces': ['org.varlink.service', self.interface]}
            if name == 'GetInterfaceDescription':
                wanted = parameters.get('interface')
                if wanted == self.interface:
                    return {'description': self.description}
                if wanted == 'org.varlink.service':
                    return {'description': SERVICE_INTERFACE}
                raise VarlinkError('org.varlink.service.InterfaceNotFound', {'interface': str(wanted)})
            raise VarlinkError('org.varlink.service.MethodNotFound', {'method': method})
        if interface != self.interface:
            raise VarlinkError('org.varlink.service.InterfaceNotFound', {'interface': interface})
        return self.dispatch(name, parameters, caller)

    @staticmethod
    def _send(conn: socket.socket, reply: dict) -> None:
        conn.sendall(json.dumps(reply, separators=(',', ':'), ensure_ascii=False).encode() + b'\0')


def call(path: str, method: str, parameters: dict | None = None, timeout: float = 60) -> dict:
    """A client for the command line and the tests."""
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.settimeout(timeout)
    try:
        sock.connect(path)
        sock.sendall(json.dumps({'method': method, 'parameters': parameters or {}}).encode() + b'\0')
        buffer = b''
        while b'\0' not in buffer:
            chunk = sock.recv(65536)
            if not chunk:
                break
            buffer += chunk
        return json.loads(buffer.split(b'\0', 1)[0] or b'{}')
    finally:
        sock.close()
