#!/bin/sh
set -eu

redis_secret_source="${VOLITION_REDIS_SECRET_SOURCE:-${REDIS_HOST_PASSWORD_FILE:-}}"
if [ -n "${redis_secret_source}" ] && [ -r "${redis_secret_source}" ]; then
  install -d -m 0750 -o root -g www-data /run/volition-secrets
  install -m 0400 -o www-data -g www-data "${redis_secret_source}" /run/volition-secrets/redis_password
  export REDIS_HOST_PASSWORD_FILE=/run/volition-secrets/redis_password

  if [ -n "${REDIS_HOST:-}" ]; then
    redis_auth=$(php -r 'echo rawurlencode(trim(file_get_contents($argv[1])));' "${REDIS_HOST_PASSWORD_FILE}")
    install -d -m 0750 -o root -g www-data /run/volition-php
    umask 0077
    cat > /run/volition-php/redis-session.ini <<EOF
session.save_handler = redis
session.save_path = "tcp://${REDIS_HOST}:${REDIS_HOST_PORT:-6379}?auth=${redis_auth}"
redis.session.locking_enabled = 1
redis.session.lock_retries = -1
redis.session.lock_wait_time = 10000
EOF
    chown root:www-data /run/volition-php/redis-session.ini
    chmod 0440 /run/volition-php/redis-session.ini
    unset redis_auth
    export PHP_INI_SCAN_DIR="/usr/local/etc/php/conf.d:/run/volition-php"
  fi
fi

exec /entrypoint.sh "$@"
