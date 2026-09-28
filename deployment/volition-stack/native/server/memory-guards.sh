#!/usr/bin/env bash
# Persist systemd memory protection for local AI and limits for the development account.
set -euo pipefail

dev_user=${HELENA_DEV_USER:-wilhelmpa}
system_low=${HELENA_MEMORY_SYSTEM_LOW:-11G}
lemond_low=${HELENA_MEMORY_LEMOND_LOW:-7G}
service_low=${HELENA_MEMORY_SERVICE_LOW:-512M}
postgres_low=${HELENA_MEMORY_POSTGRES_LOW:-1G}
dev_high=${HELENA_MEMORY_DEV_HIGH:-12G}
dev_max=${HELENA_MEMORY_DEV_MAX:-15G}
postgres_unit=${HELENA_POSTGRES_UNIT:-postgresql@17-main.service}
install_path=${HELENA_MEMORY_INSTALL_PATH:-/usr/local/libexec/helena-memory-guards}

dry_run=0
action=
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=1 ;;
    apply|check) [[ -z $action ]] || { echo 'one action only' >&2; exit 2; }; action=$arg ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done
[[ -n $action ]] || { echo "usage: $0 [--dry-run] apply|check" >&2; exit 2; }
[[ $action != check || $dry_run -eq 0 ]] || { echo 'check does not change anything' >&2; exit 2; }

bytes() {
  local number suffix factor
  [[ $1 =~ ^([0-9]+)([KMGT])$ ]] || { echo "invalid memory value: $1" >&2; exit 2; }
  number=${BASH_REMATCH[1]}
  suffix=${BASH_REMATCH[2]}
  [[ ${#number} -le 4 ]] || { echo "memory value too large: $1" >&2; exit 2; }
  case $suffix in K) factor=1024 ;; M) factor=1048576 ;; G) factor=1073741824 ;; T) factor=1099511627776 ;; esac
  echo $((10#$number * factor))
}

uid=$(id -u "$dev_user" 2>/dev/null) || { echo "development user not found: $dev_user" >&2; exit 1; }
[[ $uid =~ ^[0-9]+$ ]] || { echo "invalid UID for $dev_user" >&2; exit 1; }
units=(system.slice lemond.service volition-plan-api.service volition-plan-web.service
  volition-plan-worker.service volition-hermes-runner.service "$postgres_unit" "user-$uid.slice")
properties=(MemoryLow MemoryLow MemoryLow MemoryLow MemoryLow MemoryLow MemoryLow MemoryHigh)
values=("$system_low" "$lemond_low" "$service_low" "$service_low" "$service_low"
  "$service_low" "$postgres_low" "$dev_high")
units+=("user-$uid.slice")
properties+=(MemoryMax)
values+=("$dev_max")

expected=()
for value in "${values[@]}"; do
  expected_value=$(bytes "$value") || exit 2
  expected+=("$expected_value")
done

problems=()
changes=()
for i in "${!units[@]}"; do
  unit=${units[i]}
  property=${properties[i]}
  state=$(systemctl show "$unit" --property=LoadState --value 2>/dev/null || true)
  if [[ $state != loaded ]]; then
    problems+=("$unit is ${state:-unavailable}")
    continue
  fi
  actual=$(systemctl show "$unit" "--property=$property" --value 2>/dev/null || true)
  if [[ $actual != "${expected[i]}" ]]; then
    problems+=("$unit $property=${actual:-unavailable}, expected ${values[i]}")
    changes+=("$i")
  fi
done

if [[ $action == check ]]; then
  if ((${#problems[@]})); then
    printf '%s\n' "${problems[@]}"
    exit 1
  fi
  echo 'memory guards match'
  exit 0
fi

for problem in "${problems[@]}"; do
  if [[ $problem == *' is '* ]]; then
    echo "cannot apply: $problem" >&2
    exit 1
  fi
done
[[ $dry_run -eq 1 || $EUID -eq 0 ]] || { echo 'run as root' >&2; exit 1; }

if [[ ! -e $install_path ]] || ! cmp -s "$0" "$install_path"; then
  if [[ $dry_run -eq 1 ]]; then
    echo "would install $install_path"
  else
    install -d -m 0755 "$(dirname "$install_path")"
    install -m 0755 "$0" "$install_path"
  fi
fi
user_change=0
for i in "${changes[@]}"; do
  if [[ ${units[i]} == "user-$uid.slice" ]]; then
    user_change=1
    continue
  fi
  if [[ $dry_run -eq 1 ]]; then
    echo "would set ${units[i]} ${properties[i]}=${values[i]}"
  else
    systemctl set-property "${units[i]}" "${properties[i]}=${values[i]}"
  fi
done
if [[ $user_change -eq 1 ]]; then
  if [[ $dry_run -eq 1 ]]; then
    echo "would set user-$uid.slice MemoryHigh=$dev_high MemoryMax=$dev_max"
  else
    systemctl set-property "user-$uid.slice" "MemoryHigh=$dev_high" "MemoryMax=$dev_max"
  fi
fi
if ((${#changes[@]} == 0)); then echo 'memory guards already match'; fi
if [[ $dry_run -eq 0 ]]; then "$0" check; fi
