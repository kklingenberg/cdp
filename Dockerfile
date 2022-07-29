# Download jq static binary
FROM alpine:3.16.0 AS downloader

RUN wget https://github.com/stedolan/jq/releases/download/jq-1.6/jq-linux64 -O /bin/jq && \
    chmod +x /bin/jq


# Build stream-jsonnet, a jq look-alike static binary
FROM golang:1.18-alpine AS golangbuilder

WORKDIR /src
COPY stream-jsonnet .
RUN go build


# Build CDP itself
FROM rust:1.62.1-slim-bullseye AS rustbuilder

COPY --from=downloader /bin/jq /bin/jq
COPY --from=golangbuilder /src/stream-jsonnet /bin/stream-jsonnet

WORKDIR /usr/src/app

RUN cargo init --bin
COPY cdp/Cargo.toml cdp/Cargo.lock ./
RUN cargo build --release

COPY cdp .
RUN cargo test && cargo build --release


# Integrate CDP with jq and stream-jsonnet into a lean base image
FROM gcr.io/distroless/cc-debian11

COPY --from=downloader /bin/jq /usr/bin/jq
COPY --from=golangbuilder /src/stream-jsonnet /usr/bin/stream-jsonnet
COPY --from=rustbuilder /usr/src/app/target/release/cdp /usr/bin/cdp
ENTRYPOINT ["/usr/bin/cdp"]
