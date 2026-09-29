#!/usr/bin/env python3
"""Root-only local concurrency probe; pass a consented short WAV test fixture."""
import argparse
import concurrent.futures
import json
import os
import re
import subprocess
import time
from pathlib import Path
from urllib.request import Request, urlopen

FAULT = re.compile(r"GPU reset\(\d+\) succeeded|MES failed to respond|aperture.violation|amdgpu.*page fault", re.I)


def kernel_counts(since: int) -> dict[str, int]:
    journal = subprocess.run(["journalctl", "-k", "--since", f"@{since}", "-o", "cat", "--no-pager"],
                             text=True, capture_output=True, check=True).stdout
    lines = [line for line in journal.splitlines() if FAULT.search(line)]
    return {name: sum(bool(re.search(pattern, line, re.I)) for line in lines) for name, pattern in {
        "resets": r"GPU reset\(\d+\) succeeded", "mesTimeouts": r"MES failed to respond",
        "apertureViolations": r"aperture.violation", "pageFaults": r"amdgpu.*page fault"}.items()}


def request(kind: str, wav: bytes, key: str) -> dict:
    start = time.monotonic()
    if kind == "halogen":
        url = "http://127.0.0.1:8731/v1/chat/completions"
        body = json.dumps({"model": "halogen-qwen3.8-flash-next", "messages": [{"role": "user", "content": "Antworte mit OK."}], "max_tokens": 8}).encode()
        headers = {"Content-Type": "application/json"}
    elif kind == "embed":
        url = "http://127.0.0.1:13308/v1/embeddings"
        body = json.dumps({"model": "Qwen3-Embedding-0.6B-GGUF", "input": "GPU Paralleltest"}).encode()
        headers = {"Content-Type": "application/json", "Authorization": f"Bearer {key}"}
    else:
        url = "http://127.0.0.1:13306/v1/audio/transcriptions"
        boundary = "helena-gpu-probe"
        body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"probe.wav\"\r\nContent-Type: audio/wav\r\n\r\n".encode()
                + wav + f"\r\n--{boundary}--\r\n".encode())
        headers = {"Content-Type": f"multipart/form-data; boundary={boundary}"}
    try:
        with urlopen(Request(url, data=body, headers=headers), timeout=120) as response:
            response.read()
            return {"kind": kind, "status": response.status, "seconds": round(time.monotonic() - start, 3)}
    except Exception as error:
        return {"kind": kind, "error": str(error), "seconds": round(time.monotonic() - start, 3)}


def main():
    if os.geteuid() != 0:
        raise SystemExit("run as root to read the local key and kernel journal")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("wav", type=Path, help="short local WAV fixture, never a private recording")
    parser.add_argument("--rounds", type=int, default=10)
    args = parser.parse_args()
    if args.rounds < 1 or args.rounds > 100:
        parser.error("--rounds must be 1..100")
    wav = args.wav.read_bytes()
    if not wav.startswith(b"RIFF"):
        parser.error("WAV must start with RIFF")
    key = Path("/etc/helena/local-ai.key").read_text().strip()
    since = int(time.time())
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        results = []
        for _ in range(args.rounds):
            futures = [pool.submit(request, kind, wav, key) for kind in ("halogen", "embed", "whisper")]
            results.extend(f.result() for f in futures)
    print(json.dumps({"requests": results, "kernel": kernel_counts(since)}, indent=2))


if __name__ == "__main__":
    main()
