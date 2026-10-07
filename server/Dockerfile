# syntax=docker/dockerfile:1
# Builds the sync server. Build context: server/.

FROM rust:1-bookworm AS build
WORKDIR /src
COPY . .
# Cache mounts keep downloaded crates and compiled dependencies between builds.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    cargo build --release -p habit-api && cp target/release/habit-api /habit-api

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl sqlite3 tzdata \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --home /data habits \
    && mkdir -p /data && chown habits /data
COPY --from=build /habit-api /usr/local/bin/habit-api
USER habits
ENV BIND=0.0.0.0:8080 \
    DATABASE_URL=sqlite:///data/habits.db \
    RUST_LOG=info
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD curl -fsS http://127.0.0.1:8080/health || exit 1
CMD ["habit-api"]
