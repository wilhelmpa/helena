#!/bin/bash
set -euo pipefail

if (( $# > 1 )); then
  printf 'exactly one project slug is allowed\n' >&2
  exit 64
fi

slug="${1:-default}"
if [[ "${slug}" == "default" ]]; then
  target=/projects
elif [[ "${slug}" =~ ^[a-z0-9][a-z0-9-]{0,31}$ ]]; then
  target="/projects/${slug}"
else
  printf 'invalid project slug\n' >&2
  exit 64
fi

projects_root="$(realpath -e -- /projects)"
target="$(realpath -e -- "${target}")" || {
  printf 'project directory does not exist\n' >&2
  exit 66
}

if [[ "${target}" != "${projects_root}" && "${target}" != "${projects_root}/"* ]]; then
  printf 'project directory escapes /projects\n' >&2
  exit 77
fi

exec /usr/bin/tmux new-session -A -s "volition-${slug}" -c "${target}"
