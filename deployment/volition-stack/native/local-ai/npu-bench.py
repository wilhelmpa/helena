#!/usr/bin/python3
"""Compare sequential and concurrent GPU/NPU completion latency under one benchmark lock."""
import argparse
import concurrent.futures
import fcntl
import json
import statistics
import subprocess
import threading
import time
from pathlib import Path
from urllib.request import Request, urlopen


def completion(base, model, key):
    start = time.monotonic()
    request = Request(base + '/chat/completions', headers={
        'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + key} if key else {})},
        data=json.dumps({'model': model, 'messages': [{'role': 'user', 'content': 'List the numbers from 1 to 60.'}],
                         'max_tokens': 256, 'temperature': 0, 'stream': False}).encode())
    with urlopen(request, timeout=240) as response:
        data = json.load(response)
    if not data.get('choices'):
        raise RuntimeError('No completion')
    seconds = time.monotonic() - start
    tokens = data.get('usage', {}).get('completion_tokens')
    return {'seconds': seconds, 'tokens': tokens, 'tokensPerSecond': tokens / seconds if tokens else None}


def devices():
    group = subprocess.check_output(['systemctl', 'show', '-p', 'ControlGroup', '--value', 'volition-npu.service'], text=True).strip()
    if not group.startswith('/') or group == '/':
        raise RuntimeError('NPU service has no cgroup')
    found = set()
    for procs in Path('/sys/fs/cgroup' + group).rglob('cgroup.procs'):
        for pid in procs.read_text().split():
            for fd in Path('/proc', pid, 'fd').iterdir():
                try:
                    target = str(fd.readlink())
                    if target.startswith('/dev/'):
                        found.add(target)
                except FileNotFoundError:
                    pass
    if '/dev/accel/accel0' not in found or any(path == '/dev/kfd' or path.startswith('/dev/dri/') for path in found):
        raise RuntimeError('NPU device isolation check failed: ' + ', '.join(sorted(found)))
    return sorted(found)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--gpu-base', default='http://127.0.0.1:13305/api/v1')
    parser.add_argument('--gpu-model', default='Qwen3.8-27B-GGUF')
    parser.add_argument('--gpu-key-file', type=Path)
    parser.add_argument('--npu-model', choices=['qwen3.5:4b', 'qwen3.5:2b'], required=True)
    parser.add_argument('--npu-key-file', type=Path, default=Path('/etc/helena/volition-npu.key'))
    parser.add_argument('--lock', type=Path, default=Path.home() / 'agent-work/halogen-bench.lock')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--samples', type=int, default=5)
    args = parser.parse_args()
    if args.samples < 3:
        parser.error('Use at least three samples')
    gpu = (args.gpu_base, args.gpu_model, args.gpu_key_file.read_text().strip() if args.gpu_key_file else '')
    npu = ('http://127.0.0.1:13309/v1', args.npu_model, args.npu_key_file.read_text().strip())
    with args.lock.open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        completion(*gpu)
        completion(*npu)
        result = {'gpuBefore': [], 'npuAlone': [], 'parallel': [], 'gpuAfter': [], 'devicesBefore': devices()}
        for _ in range(args.samples):
            result['gpuBefore'].append(completion(*gpu))
            result['npuAlone'].append(completion(*npu))
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            for _ in range(args.samples):
                start = threading.Barrier(2)
                def request(target):
                    start.wait()
                    return completion(*target)
                g = pool.submit(request, gpu)
                n = pool.submit(request, npu)
                result['parallel'].append({'gpu': g.result(), 'npu': n.result()})
        result['gpuAfter'] = [completion(*gpu) for _ in range(args.samples)]
        baseline = statistics.median(row['seconds'] for row in result['gpuBefore'])
        parallel = statistics.median(row['gpu']['seconds'] for row in result['parallel'])
        after = statistics.median(row['seconds'] for row in result['gpuAfter'])
        result['devicesAfter'] = devices()
        result.update(gpuSlowdown=parallel / baseline - 1, gpuAfterSlowdown=after / baseline - 1,
                      passed=parallel <= baseline and after <= baseline)
        args.output.write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps({key: result[key] for key in ('gpuSlowdown', 'gpuAfterSlowdown', 'passed')}))
        return 0 if result['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
