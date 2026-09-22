#!/bin/sh
set -eu

exec /usr/bin/ssh \
  -i /run/secrets/verve_git_deploy_key \
  -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes \
  -o UserKnownHostsFile=/run/secrets/github_known_hosts \
  "$@"
