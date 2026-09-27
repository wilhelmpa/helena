"""Pinned host-tool updates. Only imported by the root-owned helena-update helper.

No URL, path, command or unit comes from a spool request. TLS-authenticated official
metadata supplies digests (not a claim of independent publisher signatures). New trees
are prepared beside the current tree; only a quiet, locked queue permits activation.
"""
from __future__ import annotations

import base64
import contextlib
import hashlib
import json
import os
import platform
import pwd
import re
import select
import shutil
import stat
import subprocess
import tarfile
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath

TOOLS = ("bun", "node", "code-server", "wetty", "kasmvnc", "uv")
VERSION = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+$")
HOSTS = {"api.github.com", "github.com", "release-assets.githubusercontent.com",
         "objects.githubusercontent.com", "nodejs.org", "registry.npmjs.org"}
LIMIT = 600 * 1024 * 1024
UNPACK_LIMIT = 3 * 1024 * 1024 * 1024
UNITS = {
    "bun": ["volition-plan-api.service", "volition-plan-worker.service"],
    "node": ["volition-plan-web.service", "volition-provisioning.service",
             "volition-terminal.service", "volition-project-browser-router.service"],
    "code-server": ["volition-code.service"],
    "wetty": ["volition-terminal.service"],
    "kasmvnc": [],
    "uv": [],
}
SMOKE_URLS = {
    "volition-plan-api.service": ("http://127.0.0.1:3000/docs", {200}),
    "volition-plan-web.service": ("http://127.0.0.1:3001/login", {200}),
    "volition-provisioning.service": ("http://127.0.0.1:18800/healthz", {200}),
    "volition-code.service": ("http://127.0.0.1:8443/healthz", {200}),
    "volition-terminal.service": ("http://127.0.0.1:8444/", {400, 404}),
    "volition-project-browser-router.service": ("http://127.0.0.1:6082/api/overview", {200}),
}


class ToolError(Exception):
    pass


def config_defaults(config: dict) -> None:
    config.setdefault("hostToolsPrefix", "/opt/helena/host-tools")
    config.setdefault("hostToolsBin", "/usr/local/bin")
    config.setdefault("hostToolsUnits", "/etc/systemd/system")
    config.setdefault("hostToolsDatabase", "itsaplan")


def url_allowed(url: str) -> None:
    parsed = urllib.parse.urlsplit(url)
    if (parsed.scheme != "https" or parsed.hostname not in HOSTS or parsed.username
            or parsed.password or parsed.port not in (None, 443) or parsed.fragment):
        raise ToolError("download URL is not an official HTTPS source")


class Redirects(urllib.request.HTTPRedirectHandler):
    max_redirections = 3

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        url_allowed(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch(url: str, destination: Path, limit: int = LIMIT) -> None:
    url_allowed(url)
    # No inherited proxy, credentials, cookie jar or user npm configuration.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), Redirects())
    accept = "application/vnd.github+json" if urllib.parse.urlsplit(url).hostname == "api.github.com" else "*/*"
    request = urllib.request.Request(url, headers={"User-Agent": "helena-update", "Accept": accept})
    try:
        with opener.open(request, timeout=30) as response, destination.open("xb") as output:
            count = 0
            deadline = time.monotonic() + 600
            while block := response.read(1024 * 1024):
                count += len(block)
                if count > limit or time.monotonic() > deadline:
                    raise ToolError("download exceeds its size or time limit")
                output.write(block)
    except (urllib.error.URLError, OSError) as error:
        # Redirect URLs may contain signed query parameters: never include them in logs.
        raise ToolError("official source could not be downloaded") from error


def metadata(url: str, work: Path) -> dict:
    path = work / ("metadata-" + str(time.time_ns()) + ".json")
    fetch(url, path, 4 * 1024 * 1024)
    value = json.loads(path.read_text())
    if not isinstance(value, dict):
        raise ToolError("invalid release manifest")
    return value


def verify(path: Path, digest: str) -> None:
    if re.fullmatch(r"sha256:[0-9a-f]{64}", digest):
        algorithm, expected = "sha256", bytes.fromhex(digest[7:])
    elif re.fullmatch(r"sha512-[A-Za-z0-9+/]+={0,2}", digest):
        algorithm, expected = "sha512", base64.b64decode(digest[7:], validate=True)
        if len(expected) != 64:
            raise ToolError("invalid SHA-512 digest")
    else:
        raise ToolError("release has no supported integrity digest")
    result = hashlib.new(algorithm)
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            result.update(block)
    if result.digest() != expected:
        raise ToolError("download checksum mismatch; nothing activated")


def release_asset(tool: str, version: str, work: Path) -> dict:
    arch = {"x86_64": "amd64", "aarch64": "arm64"}.get(platform.machine())
    if not arch:
        raise ToolError("unsupported host architecture")
    if tool == "node":
        name = f"node-v{version}-linux-{'x64' if arch == 'amd64' else 'arm64'}.tar.xz"
        base = f"https://nodejs.org/dist/v{version}/"
        manifest = work / "SHASUMS256.txt"
        fetch(base + manifest.name, manifest, 256 * 1024)
        matches = [line.split()[0] for line in manifest.read_text().splitlines()
                   if len(line.split()) == 2 and line.split()[1].lstrip("*") == name]
        if len(matches) != 1 or not re.fullmatch(r"[0-9a-f]{64}", matches[0]):
            raise ToolError("Node manifest does not identify this archive")
        return {"url": base + name, "digest": "sha256:" + matches[0], "name": name,
                "verification": "Node HTTPS SHASUMS256 manifest"}
    if tool == "wetty":
        data = metadata(f"https://registry.npmjs.org/wetty/{version}", work)
        dist = data.get("dist", {})
        url = f"https://registry.npmjs.org/wetty/-/wetty-{version}.tgz"
        if data.get("name") != "wetty" or data.get("version") != version or dist.get("tarball") != url:
            raise ToolError("npm manifest does not identify wetty at the requested version")
        if not re.fullmatch(r"sha512-[A-Za-z0-9+/]+={0,2}", dist.get("integrity", "")):
            raise ToolError("Wetty registry manifest has no SHA-512 integrity")
        return {"url": url, "digest": dist["integrity"], "name": f"wetty-{version}.tgz",
                "verification": "npm HTTPS manifest and locked dependency integrity"}
    repo = {"bun": "oven-sh/bun", "code-server": "coder/code-server",
            "kasmvnc": "kasmtech/KasmVNC", "uv": "astral-sh/uv"}[tool]
    tag = f"bun-v{version}" if tool == "bun" else version if tool == "uv" else f"v{version}"
    if tool == "bun":
        name = f"bun-linux-{'x64' if arch == 'amd64' else 'aarch64'}.zip"
    elif tool == "uv":
        name = f"uv-{'x86_64' if arch == 'amd64' else 'aarch64'}-unknown-linux-gnu.tar.gz"
    elif tool == "code-server":
        name = f"code-server-{version}-linux-{arch}.tar.gz"
    else:
        info = dict(line.split("=", 1) for line in Path("/etc/os-release").read_text().splitlines()
                    if "=" in line)
        codename = info.get("VERSION_CODENAME", "").strip('"')
        if info.get("ID", "").strip('"') != "debian" or codename not in ("bookworm", "trixie"):
            raise ToolError("KasmVNC requires a supported Debian release")
        name = f"kasmvncserver_{codename}_{version}_{arch}.deb"
    data = metadata(f"https://api.github.com/repos/{repo}/releases/tags/{tag}", work)
    if data.get("tag_name") != tag or data.get("draft") or data.get("prerelease"):
        raise ToolError("release manifest is not the requested stable release")
    assets = [a for a in data.get("assets", []) if a.get("name") == name]
    if len(assets) != 1:
        raise ToolError("release does not contain this platform archive")
    asset = assets[0]
    url = f"https://github.com/{repo}/releases/download/{tag}/{name}"
    if (asset.get("browser_download_url") != url or asset.get("state") != "uploaded"
            or not re.fullmatch(r"sha256:[0-9a-f]{64}", asset.get("digest") or "")
            or not isinstance(asset.get("size"), int) or not 0 < asset["size"] <= LIMIT):
        raise ToolError("release asset lacks authenticated SHA-256 metadata")
    return {"url": url, "digest": asset["digest"], "name": name, "size": asset["size"],
            "verification": "GitHub HTTPS release asset SHA-256 (not publisher signature)"}


def member_path(name: str) -> Path:
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts or "\\" in name:
        raise ToolError("archive path escapes the installation")
    return Path(*path.parts)


def unpack(archive: Path, destination: Path) -> None:
    """No devices, privileges, escaping links, duplicate files or writes through links."""
    destination.mkdir()
    links = []
    seen = set()
    total = 0
    if zipfile.is_zipfile(archive):
        with zipfile.ZipFile(archive) as source:
            entries = [(x.filename, x.file_size, (x.external_attr >> 16) & 0o777,
                        "dir" if x.is_dir() else "file", None, x) for x in source.infolist()]
            if any(stat.S_ISLNK(x.external_attr >> 16) for x in source.infolist()):
                raise ToolError("zip symlinks are not supported")
            readers = lambda entry: source.open(entry)
            _extract(entries, readers, destination, seen, links)
    else:
        with tarfile.open(archive) as source:
            entries = []
            for entry in source:
                total += entry.size
                if total > UNPACK_LIMIT or len(entries) >= 100_000:
                    raise ToolError("archive exceeds extraction limit")
                kind = "dir" if entry.isdir() else "file" if entry.isfile() else "link" if entry.issym() else "invalid"
                entries.append((entry.name, entry.size, entry.mode, kind, entry.linkname, entry))
            _extract(entries, source.extractfile, destination, seen, links)
    for target, link in links:
        # All regular members were written before links. Verify the full final chain.
        target.symlink_to(link)
    for target, _ in links:
        try:
            target.resolve().relative_to(destination.resolve())
        except (ValueError, RuntimeError) as error:
            raise ToolError("archive symlink escapes the installation") from error


def _extract(entries, reader, destination, seen, links) -> None:
    total = 0
    for name, size, mode, kind, link, entry in entries:
        path = member_path(name)
        if path == Path(".") and kind == "dir":
            continue
        if path in seen or len(seen) >= 100_000:
            raise ToolError("duplicate archive member or too many files")
        seen.add(path)
        total += size
        if size < 0 or total > UNPACK_LIMIT:
            raise ToolError("archive exceeds extraction limit")
        target = destination / path
        target.parent.mkdir(parents=True, exist_ok=True)
        if kind == "dir":
            target.mkdir(exist_ok=True)
        elif kind == "file":
            with reader(entry) as source, target.open("xb") as output:
                shutil.copyfileobj(source, output, 1024 * 1024)
            target.chmod(0o755 if mode & 0o111 else 0o644)
        elif kind == "link":
            if PurePosixPath(link).is_absolute():
                raise ToolError("absolute archive symlink")
            try:
                (target.parent / link).resolve().relative_to(destination.resolve())
            except ValueError as error:
                raise ToolError("archive symlink escapes the installation") from error
            links.append((target, link))
        else:
            raise ToolError("archive contains a device, hardlink or unsupported entry")


def command(args: list[str], *, cwd: Path | None = None, user: str | None = None,
            timeout: int = 60) -> str:
    # A version command may create configuration even inside a frozen installation.
    # Never use a passwd HOME, an owner's profile, shared /tmp or the release tree.
    home_scope = (tempfile.TemporaryDirectory(prefix="helena-host-tool-", dir="/tmp")
                  if user else contextlib.nullcontext(None))
    with home_scope as temporary:
        home = Path(temporary) if temporary else (cwd or Path("/tmp"))
        if temporary and os.geteuid() == 0:
            account = pwd.getpwnam(user)
            os.chown(home, account.pw_uid, account.pw_gid)
        env = {"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": str(home),
               "LC_ALL": "C", "NPM_CONFIG_USERCONFIG": "/dev/null",
               "NPM_CONFIG_GLOBALCONFIG": "/dev/null", "NPM_CONFIG_REGISTRY": "https://registry.npmjs.org",
               "NPM_CONFIG_CACHE": str((cwd or home) / ".npm"),
               "NPM_CONFIG_UPDATE_NOTIFIER": "false"}
        if user and os.geteuid() == 0:
            args = ["/usr/sbin/runuser", "--preserve-environment", "-u", user, "--",
                    "setpriv", "--no-new-privs", "--", *args]
        result = subprocess.run(args, cwd=cwd, env=env, text=True, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, timeout=timeout)
        if result.returncode:
            # Package scripts and npm logs can echo user configuration. Report command identity
            # and code only; our step log explains which bounded operation failed.
            raise ToolError(f"{Path(args[0]).name} failed (exit {result.returncode})")
        return result.stdout


@contextlib.contextmanager
def quiet_queue(config: dict):
    """Local peer auth, no secrets. SHARE locks prevent new runs/chats until activation ends."""
    database = config["hostToolsDatabase"]
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,62}", database):
        raise ToolError("invalid configured database name")
    process = subprocess.Popen(["/usr/sbin/runuser", "-u", "postgres", "--", "psql", "-XAtq",
                                "-v", "ON_ERROR_STOP=1", "-d", database],
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.DEVNULL, text=True, bufsize=1)
    try:
        process.stdin.write("BEGIN; SET LOCAL lock_timeout='3s'; "
                            "SET LOCAL idle_in_transaction_session_timeout='300s'; "
                            "LOCK TABLE agent_run, agent_chat_message IN SHARE MODE;\n"
                            "SELECT CASE WHEN EXISTS (SELECT 1 FROM agent_run WHERE status IN ('pending','running')) "
                            "OR EXISTS (SELECT 1 FROM agent_chat_message WHERE status IN ('pending','streaming')) "
                            "THEN 'busy' ELSE 'quiet' END;\n")
        process.stdin.flush()
        ready, _, _ = select.select([process.stdout], [], [], 8)
        if not ready or process.stdout.readline().strip() != "quiet":
            raise ToolError("update deferred: active run/chat, busy queue or database unavailable; try again when idle")
        yield
        if process.poll() is not None:
            raise ToolError("update queue lock was lost")
    finally:
        try:
            process.communicate("ROLLBACK;\n", timeout=5)
        except (subprocess.TimeoutExpired, BrokenPipeError):
            process.kill()
            process.wait()


def atomic_link(target: str | Path, path: Path) -> None:
    temp = path.with_name("." + path.name + ".new")
    if temp.is_symlink():
        temp.unlink()
    temp.symlink_to(target)
    os.replace(temp, path)


def own_tree(path: Path, user: str) -> None:
    account = pwd.getpwnam(user)
    for base, dirs, files in os.walk(path, followlinks=False):
        os.chown(base, account.pw_uid, account.pw_gid)
        for name in dirs + files:
            os.chown(Path(base) / name, account.pw_uid, account.pw_gid, follow_symlinks=False)


def freeze_tree(path: Path) -> None:
    """Only root can alter an activated tool, including npm's extracted native helpers."""
    root = path.resolve()
    for base, dirs, files in os.walk(path, followlinks=False):
        for entry in [Path(base), *[Path(base) / name for name in dirs + files]]:
            info = entry.lstat()
            if entry.is_symlink():
                try:
                    entry.resolve().relative_to(root)
                except (ValueError, RuntimeError) as error:
                    raise ToolError("installed package link escapes its version tree") from error
                continue
            if not stat.S_ISREG(info.st_mode) and not stat.S_ISDIR(info.st_mode):
                raise ToolError("installed package contains a special file")
            entry.chmod(0o755 if entry.is_dir() or info.st_mode & 0o111 else 0o644)


def npm_lock(lock: dict, version: str, digest: str) -> None:
    packages = lock.get("packages", {})
    wetty = packages.get("node_modules/wetty", {})
    if wetty.get("version") != version or wetty.get("integrity") != digest:
        raise ToolError("npm lock does not match the pinned Wetty manifest")
    if not packages or len(packages) > 5000:
        raise ToolError("invalid npm dependency manifest")
    for key, entry in packages.items():
        if not key:
            continue
        member_path(key)
        resolved = entry.get("resolved", "")
        url_allowed(resolved)
        if (urllib.parse.urlsplit(resolved).hostname != "registry.npmjs.org"
                or not re.fullmatch(r"sha512-[A-Za-z0-9+/]+={0,2}", entry.get("integrity", ""))):
            raise ToolError("npm dependency lacks official registry SHA-512 integrity")


def prepare_wetty(tree: Path, version: str, asset: dict, log) -> None:
    node = Path("/usr/local/bin/node").resolve()
    node_root = node.parent.parent
    npm = node_root / "lib/node_modules/npm/bin/npm-cli.js"
    gyp = node_root / "lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js"
    if not all(p.is_file() for p in (npm, gyp, node_root / "include/node/node.h")) or not all(
            shutil.which(p) for p in ("make", "g++", "python3")):
        raise ToolError("Wetty needs existing npm/node-gyp, local Node headers, make, g++ and Python; none will be installed automatically")
    tree.mkdir()
    tree.chmod(0o755)
    (tree / "package.json").write_text(json.dumps({"name": "helena-wetty", "private": True,
                                                  "dependencies": {"wetty": version}}))
    own_tree(tree, "nobody")
    flags = ["--ignore-scripts", "--omit=dev", "--no-audit", "--no-fund", "--loglevel=error"]
    log.note("Resolve Wetty's exact version and verify every dependency's registry integrity")
    command([str(node), str(npm), "install", "--package-lock-only", *flags], cwd=tree,
            user="nobody", timeout=600)
    npm_lock(json.loads((tree / "package-lock.json").read_text()), version, asset["digest"])
    command([str(node), str(npm), "ci", *flags], cwd=tree, user="nobody", timeout=600)
    log.note("Compile only verified node-pty with installed tools and local Node headers; no lifecycle scripts")
    command([str(node), str(gyp), "rebuild", "--nodedir=" + str(node_root)],
            cwd=tree / "node_modules/node-pty", user="nobody", timeout=600)
    own_tree(tree, "root")
    (tree / "bin").mkdir()
    (tree / "bin/wetty").symlink_to("../node_modules/wetty/build/main.js")
    shutil.rmtree(tree / ".npm", ignore_errors=True)


def prepare(tool: str, version: str, parent: Path, log) -> Path:
    with tempfile.TemporaryDirectory(prefix=".prepare-", dir=parent) as temporary:
        work = Path(temporary)
        work.chmod(0o755)  # smoke/npm run as nobody, never root
        asset = release_asset(tool, version, work)
        log.note(f"Pinned {tool} {version}: {asset['verification']}")
        tree = work / "tree"
        if tool == "wetty":
            prepare_wetty(tree, version, asset, log)
        else:
            archive = work / asset["name"]
            fetch(asset["url"], archive)
            verify(archive, asset["digest"])
            if asset.get("size") and archive.stat().st_size != asset["size"]:
                raise ToolError("archive size differs from release manifest")
            if tool == "kasmvnc":
                identity = command(["dpkg-deb", "-f", str(archive), "Package", "Version", "Architecture"])
                fields = dict(line.split(": ", 1) for line in identity.splitlines() if ": " in line)
                arch = {"x86_64": "amd64", "aarch64": "arm64"}.get(platform.machine())
                if (fields.get("Package") != "kasmvncserver"
                        or fields.get("Version", "").split("-")[0] != version
                        or fields.get("Architecture") != arch):
                    raise ToolError("Debian archive identifies another package/version")
                payload = work / "payload.tar"
                with payload.open("xb") as handle:
                    subprocess.run(["dpkg-deb", "--fsys-tarfile", str(archive)], stdout=handle,
                                   stderr=subprocess.DEVNULL, check=True, timeout=60)
                unpack(payload, tree)
                # No maintainer scripts, dpkg database changes or overwrites in /usr.
                (tree / "bin").mkdir()
                (tree / "bin/Xvnc").symlink_to("../usr/bin/Xkasmvnc")
            else:
                unpack(archive, tree)
                roots = list(tree.iterdir())
                if len(roots) != 1 or not roots[0].is_dir() or roots[0].is_symlink():
                    raise ToolError("unexpected standalone archive layout")
                content = work / "content"
                roots[0].rename(content)
                tree.rmdir()
                content.rename(tree)
                if tool == "bun":
                    (tree / "bin").mkdir()
                    (tree / "bin/bun").symlink_to("../bun")
                    (tree / "bin/bunx").symlink_to("../bun")
                elif tool == "uv":
                    (tree / "bin").mkdir()
                    for entry in ("uv", "uvx"):
                        (tree / "bin" / entry).symlink_to("../" + entry)
        freeze_tree(tree)
        binary_smoke(tool, tree, version)
        (tree / ".helena-installed.json").write_text(json.dumps({
            "tool": tool, "version": version, "asset": asset,
            "installedAt": time.time(), "state": "prepared"}))
        destination = parent / version
        if destination.exists():
            # Keep previous/failed installs for inspection; never overwrite an installed tree.
            raise ToolError("this version already has an installation; use the retained prepared version")
        tree.rename(destination)
        return destination


def pty_smoke(node: Path, wetty: Path) -> None:
    # A real PTY spawn catches ABI mismatches and missing spawn-helper, not just imports.
    script = ("const p=require(process.argv[1]);const t=p.spawn('/bin/sh',['-c','printf helena-pty'],"
              "{env:{PATH:'/usr/bin:/bin'},cols:80,rows:24});let text='';"
              "t.onData(x=>text+=x);t.onExit(()=>process.exit(text.includes('helena-pty')?0:1));"
              "setTimeout(()=>process.exit(2),3000).unref();")
    command([str(node), "-e", script, str(wetty / "node_modules/node-pty")],
            cwd=wetty, user="nobody", timeout=10)


def uv_pair_smoke(bindir: Path, version: str | None = None) -> str:
    """Both launchers belong to one version; --version never installs Python or tools."""
    for name in ("uv", "uvx"):
        binary = bindir / name
        if not binary.is_file():
            raise ToolError("uv installation lacks both uv and uvx")
        output = command([str(binary), "--version"], user="nobody", timeout=20)
        match = re.match(r"^" + name + r" ([0-9]+\.[0-9]+\.[0-9]+)(?:\s|$)", output.strip())
        if not match or (version is not None and match.group(1) != version):
            raise ToolError("uv/uvx do not report the same requested version")
        version = match.group(1)
    return version


def binary_smoke(tool: str, tree: Path, version: str) -> None:
    if tool == "uv":
        uv_pair_smoke(tree / "bin", version)
        return
    binary = tree / "bin" / ("Xvnc" if tool == "kasmvnc" else tool)
    if not binary.is_file():
        raise ToolError("prepared installation lacks its executable")
    if tool == "kasmvnc":
        # Xvnc supports -version; its HTTP files must belong to this same release.
        args = [str(binary), "-version"]
        if not (tree / "usr/share/kasmvnc/www/index.html").is_file():
            raise ToolError("KasmVNC archive has no web client")
    else:
        args = [str(binary), "--version"]
    output = command(args, cwd=tree, user="nobody", timeout=20)
    if not re.search(r"(?<![0-9.])v?" + re.escape(version) +
                     (r"(?![0-9])" if tool == "kasmvnc" else r"(?![0-9.])"), output):
        raise ToolError("prepared executable does not report the requested version")
    if tool == "wetty":
        pty_smoke(Path("/usr/local/bin/node"), tree)
    elif tool == "node":
        wetty = Path("/usr/local/bin/wetty").resolve().parent.parent.parent.parent
        if (wetty / "node_modules/node-pty").is_dir():
            pty_smoke(binary, wetty)


def affected_units(tool: str) -> list[str]:
    if tool == "kasmvnc":
        names = command(["systemctl", "list-units", "--state=active", "--type=service",
                         "--no-legend", "--plain", "volition-project-browser-kasm@*.service"])
        units = [line.split()[0] for line in names.splitlines() if line.strip()]
        if any(not re.fullmatch(r"volition-project-browser-kasm@[a-z0-9][a-z0-9-]{0,39}\.service", x) for x in units):
            raise ToolError("unexpected project browser unit")
        # Restarting Xvnc disconnects its Chromium from X; stopped consumers stay stopped.
        units = [name for unit in units for name in
                 (unit, unit.replace("-kasm@", "-chromium@"))]
    else:
        units = UNITS[tool]
    return [unit for unit in units if subprocess.run(
        ["systemctl", "is-active", "--quiet", unit], stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL, timeout=10).returncode == 0]


def service_smoke(units: list[str]) -> None:
    deadline = time.monotonic() + 45
    pending = list(units)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}),
                                        urllib.request.HTTPHandler())
    while pending and time.monotonic() < deadline:
        for unit in list(pending):
            try:
                command(["systemctl", "is-active", "--quiet", unit], timeout=5)
                if unit in SMOKE_URLS:
                    url, statuses = SMOKE_URLS[unit]
                    try:
                        with opener.open(url, timeout=2) as response:
                            status = response.status
                    except urllib.error.HTTPError as error:
                        status = error.code
                    if status not in statuses:
                        continue
                pending.remove(unit)
            except (ToolError, OSError, urllib.error.URLError):
                pass
        if pending:
            time.sleep(1)
    if pending:
        raise ToolError("service smoke failed: " + ", ".join(pending))


def kasm_dropin(current: Path) -> str:
    return ("[Service]\nExecStart=\nExecStart=" + str(current / "bin/Xvnc") +
            " ${PROJECT_BROWSER_DISPLAY} -geometry 3840x2160 -depth 24 -auth ${PROJECT_BROWSER_XAUTHORITY}"
            " -interface 127.0.0.1 -websocketPort ${PROJECT_BROWSER_NOVNC_PORT} -rfbport 0 -localhost"
            " -nolisten tcp -httpd " + str(current / "usr/share/kasmvnc/www") +
            " -SecurityTypes None -DisableBasicAuth -AcceptSetDesktopSize -udpFullFrameFrequency 0 -publicIP 127.0.0.1\n")


def activate(config: dict, tool: str, tree: Path, log) -> dict:
    parent = tree.parent
    current = parent / "current"
    bindir = Path(config["hostToolsBin"])
    links = ["node", "npm", "npx"] if tool == "node" else ["bun", "bunx"] if tool == "bun" else ["uv", "uvx"] if tool == "uv" else [tool]
    old_uv_version = uv_pair_smoke(bindir) if tool == "uv" else None
    if tool == "kasmvnc":
        links = []
    paths = [current, *[bindir / link for link in links]]
    before = {}
    for path in paths:
        if path.exists() and not path.is_symlink():
            raise ToolError("refusing to replace a non-symlink installation: " + path.name)
        before[path] = os.readlink(path) if path.is_symlink() else None
    old_binary = (bindir / tool).resolve() if tool != "kasmvnc" else (
        (current / "bin/Xvnc").resolve() if current.exists() else Path("/usr/bin/Xvnc"))
    dropin = Path(config["hostToolsUnits"]) / "volition-project-browser-kasm@.service.d/helena-update.conf"
    old_dropin = dropin.read_bytes() if dropin.exists() else None
    old_dropin_mode = stat.S_IMODE(dropin.stat().st_mode) if old_dropin is not None else None
    units = affected_units(tool)
    with quiet_queue(config):
        # Persist recovery data before switching: a process/host failure loses the
        # in-memory snapshot, including Kasm's previous unit override.
        with tempfile.NamedTemporaryFile(mode="w", prefix="rollback-", suffix=".json",
                                         dir=parent, delete=False) as record:
            json.dump({"tool": tool, "to": tree.name, "links": {str(k): v for k, v in before.items()},
                       "previousExecutable": str(old_binary), "units": units,
                       "dropin": {"path": str(dropin), "contentBase64": (
                           base64.b64encode(old_dropin).decode() if old_dropin is not None else None),
                           "mode": old_dropin_mode}
                       if tool == "kasmvnc" else None}, record)
            record.flush()
            os.fsync(record.fileno())
            rollback_artifact = record.name
        directory = os.open(parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
        log.note("Rollback snapshot: " + rollback_artifact)
        try:
            # One mutable version pointer. Entry links stay stable after this first adoption.
            atomic_link(tree.name, current)
            for link in links:
                atomic_link(current / "bin" / link, bindir / link)
            if tool == "kasmvnc":
                dropin.parent.mkdir(parents=True, exist_ok=True)
                temp = dropin.with_suffix(".new")
                temp.write_text(kasm_dropin(current))
                os.replace(temp, dropin)
                command(["systemctl", "daemon-reload"])
            if units:
                log.note("Restarting only: " + ", ".join(units))
                command(["systemctl", "restart", *units], timeout=60)
            service_smoke(units)
            if tool == "uv":
                uv_pair_smoke(bindir, tree.name)
        except Exception as error:
            for path, target in before.items():
                if target is not None:
                    atomic_link(target, path)
                elif path.is_symlink():
                    path.unlink()
            if tool == "kasmvnc":
                if old_dropin is None:
                    dropin.unlink(missing_ok=True)
                else:
                    dropin.write_bytes(old_dropin)
                    dropin.chmod(old_dropin_mode)
                command(["systemctl", "daemon-reload"])
            try:
                if units:
                    command(["systemctl", "restart", *units], timeout=60)
                service_smoke(units)
                if tool == "uv":
                    uv_pair_smoke(bindir, old_uv_version)
            except Exception as rollback_error:
                raise ToolError("update failed; previous paths restored but rollback smoke failed; operator check required") from rollback_error
            log.note("Rollback succeeded: previous paths restored and affected services healthy")
            raise ToolError("update failed; previous version restored: " + str(error)) from error
    try:
        old = before[current]
        if old:
            atomic_link(old, parent / "previous")
        else:
            (parent / "legacy.json").write_text(json.dumps({str(k): v for k, v in before.items()}))
    except OSError:
        log.note("Previous-version shortcut unavailable; use the retained rollback snapshot")
    return {"tool": tool, "to": tree.name, "previousExecutable": str(old_binary),
            "units": units, "rollback": "previous installation retained",
            "rollbackArtifact": rollback_artifact, "smoke": "passed"}


def apply(config: dict, tool: str, version: str, log) -> dict:
    config_defaults(config)
    if tool not in TOOLS or not VERSION.fullmatch(version):
        raise ToolError("unknown host tool or non-stable version")
    binary = Path(config["hostToolsBin"]) / tool if tool != "kasmvnc" else (
        Path(config["hostToolsPrefix"]) / tool / "current/bin/Xvnc")
    if tool == "kasmvnc" and not binary.exists():
        binary = Path("/usr/bin/Xvnc")
    if not binary.is_file():
        raise ToolError("only an already installed host tool can be updated")
    output = command([str(binary), "-version" if tool == "kasmvnc" else "--version"],
                     user="nobody", timeout=20)
    match = re.search(r"(?<![0-9])v?([0-9]+\.[0-9]+\.[0-9]+)", output)
    if not match:
        raise ToolError("installed version cannot be verified")
    old_version = match.group(1)
    if tool == "uv":
        uv_pair_smoke(Path(config["hostToolsBin"]), old_version)
    if old_version == version:
        return {"tool": tool, "from": version, "to": version, "note": "already installed"}
    if tuple(map(int, version.split("."))) < tuple(map(int, old_version.split("."))):
        raise ToolError("host-tool update refuses a downgrade")
    if tool == "node" and version.split(".")[0] != old_version.split(".")[0]:
        raise ToolError("a Node major migration is not an in-place update")
    # Refuse immediately when busy, before the approved download starts. Gate again after
    # preparation, holding the lock only for the short activation/smoke/rollback window.
    with quiet_queue(config):
        pass
    parent = Path(config["hostToolsPrefix"]) / tool
    parent.mkdir(parents=True, exist_ok=True)
    tree = parent / version
    if tree.exists():
        manifest = json.loads((tree / ".helena-installed.json").read_text())
        if manifest.get("tool") != tool or manifest.get("version") != version:
            raise ToolError("existing prepared installation has invalid metadata")
        binary_smoke(tool, tree, version)
    else:
        tree = prepare(tool, version, parent, log)
    result = activate(config, tool, tree, log)
    result["from"] = old_version
    return result


def installed(config: dict) -> dict:
    config_defaults(config)
    found = {}
    for tool in TOOLS:
        current = Path(config["hostToolsPrefix"]) / tool / "current"
        try:
            data = json.loads((current / ".helena-installed.json").read_text())
            if data.get("tool") == tool and VERSION.fullmatch(data.get("version", "")):
                found[tool] = data["version"]
        except (OSError, ValueError):
            pass
    return found
