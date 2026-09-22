#!/bin/sh
set -eu

redis_secret_source="${VOLITION_REDIS_SECRET_SOURCE:-${REDIS_HOST_PASSWORD_FILE:-}}"
if [ -n "${redis_secret_source}" ] && [ -r "${redis_secret_source}" ]; then
  install -d -m 0750 -o root -g www-data /run/volition-secrets
  install -m 0400 -o www-data -g www-data "${redis_secret_source}" /run/volition-secrets/redis_password
  export REDIS_HOST_PASSWORD_FILE=/run/volition-secrets/redis_password
fi

exec /entrypoint.sh "$@"
