FROM golang:1.27.1-alpine@sha256:4cb7ac979db5fcc41cae44b2227ba5ab8a51e8807f40d9ba4dee20a0ad960b5b AS pdfcpu_builder
ADD --checksum=sha256:69924a7363ea19b4f3d4799ebf78bcabfec75a735c9569983a6e2834b5e8c6b3 https://github.com/pdfcpu/pdfcpu/archive/refs/tags/v0.15.0.tar.gz /tmp/pdfcpu.tar.gz
RUN mkdir /src && tar -xzf /tmp/pdfcpu.tar.gz -C /src --strip-components=1
WORKDIR /src
# Same pdfcpu source release; security-only dependency updates are pinned by go.sum.
COPY go.mod go.sum ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /pdfcpu ./cmd/pdfcpu

FROM gotenberg/gotenberg@sha256:f29984bd1e226bf1b93ba90af06000afa8b315853e99d27b9aaa41b93f15c769
USER root
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get upgrade -y --no-install-recommends && rm -rf /var/lib/apt/lists/*
COPY --from=pdfcpu_builder /pdfcpu /usr/bin/pdfcpu
USER gotenberg
