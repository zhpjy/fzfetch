FROM node:20-bookworm-slim AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

FROM rust:1.86-bookworm AS rust-builder
WORKDIR /app

COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release

FROM debian:bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=rust-builder /app/target/release/fzfetch /usr/local/bin/fzfetch
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

RUN mkdir -p /files /data

ENV FZFETCH_ROOT=/files
ENV FZFETCH_DATA_DIR=/data

EXPOSE 3000

CMD ["fzfetch"]
