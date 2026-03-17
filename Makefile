.PHONY: all build run dev clean frontend-install frontend-dev frontend-build backend-build backend-run test-integration docker-build docker-run help

all: build

frontend-install:
	cd frontend && npm install

frontend-dev:
	cd frontend && npm run dev

frontend-build:
	cd frontend && npm run build

backend-build:
	cargo build --release

# requires frontend to be built first
backend-run:
	cargo run

build: frontend-build backend-build

run: frontend-build backend-run


test-integration:
	cargo test --test integration_test --features integration-test -- --nocapture

clean:
	cargo clean
	rm -rf frontend/build
	rm -rf frontend/node_modules

docker-build:
	docker build -t maker-dashboard .

docker-run:
	docker run -p 3000:3000 maker-dashboard

help:
	@echo "Maker Dashboard - Available commands:"
	@echo ""
	@echo "  make                    - Build everything (frontend + backend)"
	@echo "  make build              - Build everything (frontend + backend)"
	@echo "  make run                - Build and run the application"
	@echo ""
	@echo "Frontend:"
	@echo "  make frontend-install   - Install frontend dependencies"
	@echo "  make frontend-dev       - Run frontend dev server (hot reload)"
	@echo "  make frontend-build     - Build frontend for production"
	@echo ""
	@echo "Backend:"
	@echo "  make backend-build      - Build Rust backend"
	@echo "  make backend-run        - Run Rust backend"
	@echo ""
	@echo "Docker:"
	@echo "  make docker-build       - Build Docker image"
	@echo "  make docker-run         - Run Docker container"
	@echo ""
	@echo "Testing:"
	@echo "  make test-integration   - Run the integration test (requires bitcoind)"
	@echo ""
	@echo "Utilities:"
	@echo "  make clean              - Clean all build artifacts"
	@echo "  make help               - Show this help message"
