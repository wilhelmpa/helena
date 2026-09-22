#!/usr/bin/env bash
set -euo pipefail

readonly nextcloud_user='owner@example.com'
readonly password_file='/home/pw/services/volition-stack/.secrets/nextcloud_patrick_app_password'
readonly dav_root='http://127.0.0.1:8092/remote.php/dav/files/patrick.wilhelm%40volition.one'

die() {
  printf 'error=%s\n' "$1" >&2
  exit 2
}

validate_relative_path() {
  local path=$1
  [[ "$path" =~ ^[A-Za-z0-9._/-]+$ ]] || die 'invalid-path-characters'
  [[ "$path" != /* && "$path" != *'..'* && "$path" != */ && "$path" != *//* ]] || die 'invalid-relative-path'
}

curl_nc() {
  local app_password
  app_password=$(tr -d '\n' < "$password_file")
  curl --silent --show-error \
    --config <(printf 'user = "%s:%s"\n' "$nextcloud_user" "$app_password") \
    -H 'Host: cloud.volition.one' \
    "$@"
}

action=${1:-}
relative_path=${2:-}
validate_relative_path "$relative_path"

case "$action" in
  mkdir)
    current=
    IFS='/' read -r -a parts <<< "$relative_path"
    for part in "${parts[@]}"; do
      current="${current:+$current/}$part"
      status=$(curl_nc -o /dev/null -w '%{http_code}' -X MKCOL "$dav_root/$current")
      [[ "$status" == 201 || "$status" == 405 ]] || die "mkcol-http-$status"
    done
    verify=$(curl_nc -o /dev/null -w '%{http_code}' -X PROPFIND -H 'Depth: 0' "$dav_root/$relative_path")
    [[ "$verify" == 207 ]] || die "propfind-http-$verify"
    printf 'folder=%s status=ready propfind=207\n' "$relative_path"
    ;;
  put)
    expected_sha256=${3:-}
    [[ "$expected_sha256" =~ ^[0-9a-f]{64}$ ]] || die 'invalid-sha256'

    existing_status=$(curl_nc -o /dev/null -w '%{http_code}' -I "$dav_root/$relative_path")
    if [[ "$existing_status" == 200 ]]; then
      actual_sha256=$(curl_nc "$dav_root/$relative_path" | sha256sum | awk '{print $1}')
      [[ "$actual_sha256" == "$expected_sha256" ]] || die 'existing-file-checksum-mismatch'
      printf 'file=%s status=existing checksum=%s\n' "$relative_path" "$actual_sha256"
      exit 0
    fi
    [[ "$existing_status" == 404 ]] || die "head-http-$existing_status"

    put_status=$(curl_nc -o /dev/null -w '%{http_code}' -X PUT --upload-file - "$dav_root/$relative_path")
    [[ "$put_status" == 201 || "$put_status" == 204 ]] || die "put-http-$put_status"
    actual_sha256=$(curl_nc "$dav_root/$relative_path" | sha256sum | awk '{print $1}')
    [[ "$actual_sha256" == "$expected_sha256" ]] || die 'uploaded-file-checksum-mismatch'
    printf 'file=%s status=uploaded http=%s checksum=%s\n' "$relative_path" "$put_status" "$actual_sha256"
    ;;
  *)
    die 'usage: nextcloud-webdav.sh mkdir <relative-path> | put <relative-path> <sha256>'
    ;;
esac
