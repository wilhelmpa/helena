# syntax=docker/dockerfile:1.7

ARG BASE_IMAGE

# gosu 1.19 is the version shipped by the upstream Postgres images. Rebuild
# the exact upstream source with a Go toolchain that contains the current
# standard-library security fixes, then replace only that helper binary.
FROM docker.io/library/golang:1.26.6-bookworm@sha256:116d58cbd88c1297624acc6e967a060012422bacf9930927e23fb719189c6f36 AS gosu_builder
WORKDIR /src
COPY gosu-1.19-source.tar.gz /tmp/gosu.tar.gz
RUN tar -xzf /tmp/gosu.tar.gz --strip-components=1 -C /src \
    && test "$(grep -E '^const Version = ' version.go | tr -cd '0-9.')" = "1.19" \
    && CGO_ENABLED=0 go build -buildvcs=false -trimpath \
      -ldflags='-s -w -buildid=' -o /out/gosu . \
    && /out/gosu --version

FROM ${BASE_IMAGE}
USER root
COPY --from=gosu_builder /out/gosu /usr/local/bin/gosu
RUN set -eux; \
    chmod 0755 /usr/local/bin/gosu; \
    if command -v apt-get >/dev/null; then \
      apt-get update; \
      DEBIAN_FRONTEND=noninteractive apt-get dist-upgrade -y; \
      apt-get clean; \
      rm -rf /var/lib/apt/lists/*; \
    elif command -v apk >/dev/null; then \
      apk upgrade --no-cache; \
    else \
      echo 'unsupported base package manager' >&2; exit 1; \
    fi; \
    gosu --version; \
    gosu nobody true
