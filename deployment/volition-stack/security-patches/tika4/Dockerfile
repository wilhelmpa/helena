FROM apache/tika@sha256:a8b442501f601fb15015de974f9afe13dd242b0f14e49a2b144fadcb214a555b
USER root
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get upgrade -y --no-install-recommends \
    && rm -rf /var/lib/apt/lists/* /usr/bin/pebble
USER 35002:35002
