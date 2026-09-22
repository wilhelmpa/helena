FROM apache/tika@sha256:90b7fa1dc018434075fce9e1d9b88b1e3d0ea6979d0cf86e116c79a8073ae973
USER root
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get upgrade -y --no-install-recommends && rm -rf /var/lib/apt/lists/* \
    && rm -f /usr/bin/pebble /tika-server-standard-3.3.1.jar
# Official 3.x maintenance patch, SHA512 and ASF PGP signature checked before pinning.
ADD --checksum=sha256:cdbe7fde72583dec8528f9c0ed962cacb7f6624f9900b1f733df638410f77540 https://downloads.apache.org/tika/3.3.2/tika-server-standard-3.3.2.jar /tika-server-standard-3.3.2.jar
RUN chmod 0444 /tika-server-standard-3.3.2.jar
ENV TIKA_VERSION=3.3.2
USER 35002:35002
