# Stage 1: Build frontend
FROM node:22-slim AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Build Rust backend
FROM rust:1.88-slim AS backend-builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends pkg-config curl libssl-dev build-essential cmake && rm -rf /var/lib/apt/lists/*

# Copy manifests and cache dependencies
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs \
    && cargo build --release \
    && rm -rf src

# Copy actual source and build
COPY src ./src
RUN cargo build --release

# Stage 3: Runtime
FROM debian:bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --shell /bin/bash appuser

COPY --from=backend-builder /app/target/release/maker-dashboard ./maker-dashboard
COPY --from=frontend-builder /app/frontend/build/client ./frontend/build/client

RUN chown -R appuser:appuser /app
USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/ || exit 1

CMD ["./maker-dashboard"]
