#!/usr/bin/env python3
"""Offline synthetic upload fixtures and read-only checks of their exact vault paths."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import struct
import sys
import zlib

STAGES = ("upload", "ui", "agent", "silverbullet", "renamed", "restart")


def png_chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))


PNG = (b"\x89PNG\r\n\x1a\n" + png_chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
       + png_chunk(b"IDAT", zlib.compress(b"\x00\x40\x80\xc0")) + png_chunk(b"IEND", b""))


def require(value, message):
    if not value:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def pdf(marker):
    stream = f"BT /F1 12 Tf 30 100 Td ({marker}) Tj ET\n".encode()
    objects = [b"<< /Type /Catalog /Pages 2 0 R >>",
               b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
               b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 150] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
               b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
               b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"endstream"]
    result = b"%PDF-1.4\n"
    offsets = [0]
    for number, obj in enumerate(objects, 1):
        offsets.append(len(result))
        result += f"{number} 0 obj\n".encode() + obj + b"\nendobj\n"
    start = len(result)
    result += b"xref\n0 6\n0000000000 65535 f \n"
    result += b"".join(f"{offset:010d} 00000 n \n".encode() for offset in offsets[1:])
    return result + f"trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n".encode()


def fixture(project, run):
    require(bool(re.fullmatch(r"[A-Z][A-Z0-9_-]{0,31}", project)), "invalid project")
    require(bool(re.fullmatch(r"vaultproof-[a-z0-9]{12}", run)), "invalid run id")
    folder = f"Projects/{project}/Files/{run}"
    base = f"# Helena synthetic vault proof\n\nMarker: {run}\nProject: {project}\nStage: upload\n"
    contents = {"upload": base.encode()}
    for previous, stage in zip(STAGES, STAGES[1:4]):
        contents[stage] = contents[previous] + f"Stage: {stage}\n".encode()
    contents["renamed"] = contents["silverbullet"]
    contents["restart"] = contents["silverbullet"]
    binaries = {"original.pdf": pdf(run), "original.png": PNG}
    artifact = f"# Helena synthetic agent artifact\n\nMarker: {run}\nProject: {project}\nSource: [[{folder}/Cycle]]\n".encode()
    manifest = {"version": 1, "project": project, "run": run, "folder": folder,
                "stages": {stage: {"path": f"{folder}/{'Renamed' if stage in ('renamed', 'restart') else 'Cycle'}.md",
                                    "sha256": sha(data), "size": len(data)} for stage, data in contents.items()},
                "binaries": {name: {"path": f"{folder}/{name}", "sha256": sha(data), "size": len(data)} for name, data in binaries.items()},
                "artifact": {"path": f"{folder}/Agent-artifact.md", "sha256": sha(artifact), "size": len(artifact)}}
    return manifest, contents, binaries, artifact


def directory_fd(directory):
    absolute = Path(os.path.abspath(directory))
    fd = os.open(absolute.anchor, os.O_RDONLY | os.O_DIRECTORY)
    try:
        for component in absolute.parts[1:]:
            next_fd = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = next_fd
        return fd
    except BaseException:
        os.close(fd)
        raise


def read_exact(directory, relative, max_bytes=16384):
    require(all(part and part not in (".", "..") for part in relative.split("/")), "invalid relative path")
    fd = directory_fd(directory)
    try:
        parts = relative.split("/")
        for component in parts[:-1]:
            next_fd = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = next_fd
        file_fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
        try:
            info = os.fstat(file_fd)
            require(stat.S_ISREG(info.st_mode) and info.st_size <= max_bytes, "unexpected fixture file type or size")
            with os.fdopen(file_fd, "rb", closefd=False) as source:
                data = source.read(max_bytes + 1)
            require(len(data) <= max_bytes, "oversize fixture")
            return data
        finally:
            os.close(file_fd)
    finally:
        os.close(fd)


def prepare(work, project, run):
    manifest, contents, binaries, artifact = fixture(project, run)
    parent_fd = directory_fd(Path(work).parent)
    os.close(parent_fd)
    os.mkdir(work, 0o700)
    os.mkdir(Path(work) / "upload", 0o700)
    os.mkdir(Path(work) / "expected", 0o700)
    folder = manifest["folder"]
    paths = [f"{folder}/{name}" for name in ("Cycle.md", "Renamed.md", "original.pdf", "original.png", "Agent-artifact.md")]
    names = ", ".join(f"'{name}'" for name in paths)
    metadata = f"""-- Synthetic fixture metadata only; execute through ksql.sh WITHOUT -w.
BEGIN READ ONLY;
SELECT id, path, sha256, size_bytes, last_author, last_run_id, extraction_status
FROM vault_entry WHERE path IN ({names}) ORDER BY path;
SELECT a.id, a.public_id, a.issue_id, a.vault_path, a.sha256, a.linked, a.s3_key IS NULL AS vault_only
FROM issue_attachment a JOIN issue i ON i.id = a.issue_id JOIN project p ON p.id = i.project_id
WHERE p.key = '{project}' AND a.vault_path IN ({names}) ORDER BY a.id;
SELECT public_id, project_id, vault_path, sha256, s3_key IS NULL AS vault_only
FROM chat_attachment WHERE vault_path IN ({names}) ORDER BY public_id;
SELECT from_path, to_path FROM vault_move WHERE from_path IN ({names}) OR to_path IN ({names});
SELECT m.id, m.thread_id, t.project_id, item->>'path' AS file_path
FROM agent_chat_message m JOIN agent_chat_thread t ON t.id = m.thread_id
CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(m.attachments) = 'array' THEN m.attachments ELSE '[]'::jsonb END) AS item
WHERE item->>'kind' = 'file' AND item->>'path' IN ({names}) ORDER BY m.id;
ROLLBACK;
"""
    files = {"manifest.json": (json.dumps(manifest, indent=2) + "\n").encode(),
             "metadata.sql": metadata.encode(),
             "upload/Cycle.md": contents["upload"],
             "expected/Agent-artifact.md": artifact}
    files.update({f"upload/{name}": data for name, data in binaries.items()})
    files.update({f"expected/{stage}.md": data for stage, data in contents.items()})
    for name, data in files.items():
        fd = os.open(Path(work) / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "wb") as target:
            target.write(data)
    return manifest


def verify(work, vault, stage):
    saved = json.loads(read_exact(work, "manifest.json"))
    manifest, contents, binaries, artifact = fixture(saved["project"], saved["run"])
    require(saved == manifest, "manifest differs from deterministic fixture")
    folder = manifest["folder"]
    require(stage in STAGES or stage == "absent", "invalid stage")
    root_fd = directory_fd(vault)
    os.close(root_fd)
    if stage == "absent":
        try:
            fd = directory_fd(Path(vault) / folder)
        except FileNotFoundError:
            return {"success": True, "stage": stage, "folder": folder}
        else:
            os.close(fd)
            raise ValueError("proof folder already exists")
    expected = {manifest["stages"][stage]["path"]: contents[stage]}
    expected.update({f"{folder}/{name}": data for name, data in binaries.items()})
    if STAGES.index(stage) >= STAGES.index("agent"):
        expected[manifest["artifact"]["path"]] = artifact
    folder_fd = directory_fd(Path(vault) / folder)
    try:
        require(set(os.listdir(folder_fd)) == {Path(name).name for name in expected}, "unexpected or duplicate file in proof folder")
    finally:
        os.close(folder_fd)
    checks = []
    for relative, data in expected.items():
        actual = read_exact(vault, relative)
        require(actual == data, f"fixture bytes differ: {relative}")
        checks.append({"path": relative, "sha256": sha(actual), "size": len(actual)})
    return {"success": True, "stage": stage, "files": checks}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="mode", required=True)
    create = sub.add_parser("prepare")
    create.add_argument("--work", required=True)
    create.add_argument("--project", required=True)
    create.add_argument("--run", required=True)
    check = sub.add_parser("verify")
    check.add_argument("--work", required=True)
    check.add_argument("--vault", required=True)
    check.add_argument("--stage", choices=("absent", *STAGES), required=True)
    args = parser.parse_args()
    try:
        if args.mode == "prepare":
            result = prepare(args.work, args.project, args.run)
            print(json.dumps({"success": True, "work": os.path.abspath(args.work), "manifestSha256": sha((json.dumps(result, indent=2) + "\n").encode()), "folder": result["folder"]}))
        else:
            print(json.dumps(verify(args.work, args.vault, args.stage)))
    except (OSError, ValueError, KeyError, TypeError):
        print(json.dumps({"success": False, "phase": args.mode}), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
