# syntax=docker/dockerfile:1.7

ARG BASE_IMAGE
FROM ${BASE_IMAGE}
USER root
RUN set -eux; \
    if command -v apt-get >/dev/null; then \
      apt-get update; \
      DEBIAN_FRONTEND=noninteractive apt-get dist-upgrade -y; \
      apt-get clean; \
      rm -rf /var/lib/apt/lists/*; \
    elif command -v apk >/dev/null; then \
      apk upgrade --no-cache; \
    else \
      echo 'unsupported base package manager' >&2; exit 1; \
    fi
