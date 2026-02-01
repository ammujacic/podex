.PHONY: build build-workspace-images build-workspace-images-all push-workspace-images load-workspace-images-dind test check run stop logs clean help sync-venvs cli-dev cli-build cli-test

# Colors for output
CYAN := \033[0;36m
GREEN := \033[0;32m
YELLOW := \033[0;33m
RED := \033[0;31m
NC := \033[0m # No Color

# Default target
.DEFAULT_GOAL := help

# ============================================
# BUILD
# ============================================

## Install dependencies and build Docker images
build:
	@echo "$(CYAN)Installing dependencies...$(NC)"
	pnpm install
	@echo "$(CYAN)Installing Python packages...$(NC)"
	cd services/shared && uv sync --active --dev --quiet
	cd services/api && uv sync --active --dev --quiet
	cd services/agent && uv sync --active --dev --quiet
	cd services/compute && uv sync --active --dev --quiet
	@echo "$(CYAN)Building workspace images for arm64 and amd64...$(NC)"
	@# Build workspace images for both architectures
	@$(MAKE) build-workspace-images
	@echo "$(CYAN)Building frontend packages...$(NC)"
	pnpm build
	@echo "$(CYAN)Building Docker images...$(NC)"
	docker-compose build
	@echo "$(GREEN)Build complete!$(NC)"

## Build workspace image for current platform (local dev)
## For cross-platform builds, use: make build-workspace-images-all
build-workspace-images:
	@echo "$(CYAN)Building workspace image for current platform...$(NC)"
	@ARCH=$$(uname -m); \
	if [ "$$ARCH" = "arm64" ] || [ "$$ARCH" = "aarch64" ]; then \
		echo "$(CYAN)Detected ARM64 - building arm64 image...$(NC)"; \
		docker build -t podex/workspace:latest-arm64 ./docker/workspace; \
		docker tag podex/workspace:latest-arm64 podex/workspace:latest; \
		echo "$(GREEN)Built: podex/workspace:latest-arm64$(NC)"; \
	else \
		echo "$(CYAN)Detected x86_64 - building amd64 image...$(NC)"; \
		docker build -t podex/workspace:latest-amd64 ./docker/workspace; \
		docker tag podex/workspace:latest-amd64 podex/workspace:latest; \
		echo "$(GREEN)Built: podex/workspace:latest-amd64$(NC)"; \
	fi

## Build workspace images for BOTH arm64 and amd64 (requires more disk space)
build-workspace-images-all:
	@echo "$(CYAN)Setting up docker buildx...$(NC)"
	@docker buildx inspect podex-builder > /dev/null 2>&1 || docker buildx create --name podex-builder --use
	@docker buildx use podex-builder
	@echo "$(CYAN)Building workspace image for arm64...$(NC)"
	docker buildx build --platform linux/arm64 -t podex/workspace:latest-arm64 --load ./docker/workspace
	@echo "$(CYAN)Building workspace image for amd64...$(NC)"
	docker buildx build --platform linux/amd64 -t podex/workspace:latest-amd64 --load ./docker/workspace
	@echo "$(CYAN)Tagging latest image for current platform...$(NC)"
	@ARCH=$$(uname -m); \
	if [ "$$ARCH" = "arm64" ] || [ "$$ARCH" = "aarch64" ]; then \
		docker tag podex/workspace:latest-arm64 podex/workspace:latest; \
	else \
		docker tag podex/workspace:latest-amd64 podex/workspace:latest; \
	fi
	@echo "$(GREEN)Workspace images built: podex/workspace:latest-arm64, podex/workspace:latest-amd64$(NC)"

## Build and push workspace images to a container registry (production)
## Usage: REGISTRY=ghcr.io/yourorg make push-workspace-images
## Optional: VERSION=1.0.0 (defaults to git commit hash)
push-workspace-images:
	@if [ -z "$(REGISTRY)" ]; then \
		echo "$(RED)Error: REGISTRY is required$(NC)"; \
		echo "Usage: REGISTRY=ghcr.io/yourorg make push-workspace-images"; \
		echo "       REGISTRY=yourname make push-workspace-images  (for Docker Hub)"; \
		exit 1; \
	fi
	@echo "$(CYAN)Setting up docker buildx for multi-arch push...$(NC)"
	@docker buildx inspect podex-builder > /dev/null 2>&1 || docker buildx create --name podex-builder --use
	@docker buildx use podex-builder
	@# Determine version tag
	@VERSION=$${VERSION:-$$(git rev-parse --short HEAD)}; \
	echo "$(CYAN)Building and pushing multi-arch images to $(REGISTRY)/workspace...$(NC)"; \
	echo "$(CYAN)Version: $$VERSION$(NC)"; \
	echo ""; \
	echo "$(CYAN)Building and pushing linux/arm64 + linux/amd64...$(NC)"; \
	docker buildx build \
		--platform linux/arm64,linux/amd64 \
		-t $(REGISTRY)/workspace:$$VERSION \
		-t $(REGISTRY)/workspace:latest \
		-t $(REGISTRY)/workspace:latest-arm64 \
		-t $(REGISTRY)/workspace:latest-amd64 \
		--push \
		./docker/workspace; \
	echo ""; \
	echo "$(GREEN)Images pushed to registry:$(NC)"; \
	echo "  $(REGISTRY)/workspace:$$VERSION"; \
	echo "  $(REGISTRY)/workspace:latest"; \
	echo "  $(REGISTRY)/workspace:latest-arm64"; \
	echo "  $(REGISTRY)/workspace:latest-amd64"

## Load workspace images into Docker-in-Docker containers (ws-local-1, ws-local-2)
## Run this after build-workspace-images to make images available for workspace creation
load-workspace-images-dind:
	@echo "$(CYAN)Loading workspace images into DinD containers...$(NC)"
	@ARCH=$$(uname -m); \
	if [ "$$ARCH" = "arm64" ] || [ "$$ARCH" = "aarch64" ]; then \
		IMG="podex/workspace:latest-arm64"; \
	else \
		IMG="podex/workspace:latest-amd64"; \
	fi; \
	echo "$(CYAN)Loading $$IMG into ws-local-1 (this may take a moment)...$(NC)"; \
	docker save $$IMG | docker exec -i ws-local-1 docker -H tcp://localhost:2375 load; \
	echo "$(CYAN)Loading $$IMG into ws-local-2...$(NC)"; \
	docker save $$IMG | docker exec -i ws-local-2 docker -H tcp://localhost:2375 load; \
	echo "$(GREEN)Workspace images loaded into DinD containers!$(NC)"; \
	echo ""; \
	echo "Images in ws-local-1:"; \
	docker exec ws-local-1 docker -H tcp://localhost:2375 images; \
	echo ""; \
	echo "Images in ws-local-2:"; \
	docker exec ws-local-2 docker -H tcp://localhost:2375 images

# ============================================
# TEST
# ============================================

## Clean up test infrastructure (containers, volumes, networks)
test-clean:
	@echo "$(CYAN)Cleaning up test infrastructure...$(NC)"
	@# Stop and remove all test containers
	@docker-compose -f docker-compose.test.yml down -v --remove-orphans 2>/dev/null || true
	@# Remove any dangling test containers
	@docker ps -a --filter "name=podex" --filter "name=test" -q | xargs -r docker rm -f 2>/dev/null || true
	@# Clean up test networks
	@docker network ls --filter "name=podex-test" -q | xargs -r docker network rm 2>/dev/null || true
	@# Clean up workspace containers from previous compute tests
	@docker ps -a --filter "label=podex.test=true" -q | xargs -r docker rm -f 2>/dev/null || true
	@docker ps -a --filter "ancestor=podex/workspace" -q | xargs -r docker rm -f 2>/dev/null || true
	@echo "$(GREEN)Test infrastructure cleaned!$(NC)"

## Run API unit tests (fast, uses mocks)
test-api-unit:
	@echo "$(CYAN)Running API unit tests...$(NC)"
	cd services/api && uv run pytest tests/unit/ -v --cov=src --cov-report=term-missing -m unit || true
	@echo "$(GREEN)API unit tests complete!$(NC)"

## Run API integration tests (uses docker-compose.test.yml)
test-api-integration:
	@echo "$(CYAN)Starting test infrastructure...$(NC)"
	docker-compose -f docker-compose.test.yml up -d postgres-test redis-test mailhog stripe-mock
	@echo "$(CYAN)Waiting for services to be ready...$(NC)"
	@until docker-compose -f docker-compose.test.yml exec -T postgres-test pg_isready -U test > /dev/null 2>&1; do sleep 1; done
	@echo "$(GREEN)Test infrastructure ready$(NC)"
	@echo "$(CYAN)Running API integration tests (using pytest-xdist for test isolation)...$(NC)"
	cd services/api && DATABASE_URL=postgresql+asyncpg://test:test@localhost:5433/podex_test \
		REDIS_URL=redis://localhost:6380 \
		SMTP_HOST=localhost SMTP_PORT=1025 SMTP_USE_TLS=false \
		STRIPE_API_BASE=http://localhost:12111 \
		ENVIRONMENT=test \
		uv run pytest tests/integration/ -n auto -v --cov=src --cov-report=term-missing --cov-report=html -m integration || true
	@echo "$(CYAN)Stopping test infrastructure...$(NC)"
	docker-compose -f docker-compose.test.yml down
	@echo "$(GREEN)API integration tests complete!$(NC)"

## Run all API tests (unit + integration)
test-api: test-api-unit test-api-integration
	@echo "$(GREEN)All API tests complete!$(NC)"

## Run all tests with coverage (including integration tests)
test:
	@echo "$(CYAN)Running all tests with coverage (including integration tests)...$(NC)"
	@echo ""
	@# Clean up any leftover test infrastructure
	@echo "$(CYAN)=== Cleaning up previous test infrastructure ===$(NC)"
	@$(MAKE) test-clean
	@echo ""
	@echo "$(CYAN)=== Frontend Package Tests ===$(NC)"
	$(MAKE) test-packages
	@echo ""
	@echo "$(CYAN)=== Frontend App Tests ===$(NC)"
	pnpm test:coverage
	@echo ""
	@echo "$(CYAN)=== Starting Test Infrastructure ===$(NC)"
	@docker-compose -f docker-compose.test.yml up -d postgres-test redis-test
	@echo "$(CYAN)Waiting for test services to be healthy...$(NC)"
	@until docker-compose -f docker-compose.test.yml exec -T postgres-test pg_isready -U test > /dev/null 2>&1; do \
		echo "  Waiting for postgres..."; \
		sleep 2; \
	done
	@until docker-compose -f docker-compose.test.yml exec -T redis-test redis-cli ping > /dev/null 2>&1; do \
		echo "  Waiting for redis..."; \
		sleep 1; \
	done
	@echo "$(GREEN)Test infrastructure ready and healthy$(NC)"
	@echo ""
	@# Run tests with proper cleanup on failure
	@TEST_FAILED=0; \
	echo "$(CYAN)=== Shared Library Tests (with integration) ===$(NC)"; \
	cd services/shared && \
		REDIS_URL=redis://localhost:6380 \
		RUN_INTEGRATION_TESTS=true \
		uv run pytest --cov=src --cov-report=term-missing --cov-report=html -v || TEST_FAILED=1; \
	if [ $$TEST_FAILED -eq 0 ]; then \
		echo "$(GREEN)Shared library tests passed ✓$(NC)"; \
	else \
		echo "$(RED)Shared library tests failed$(NC)"; \
	fi; \
	echo ""; \
	echo "$(CYAN)=== API Service Tests ===$(NC)"; \
	$(MAKE) test-api || TEST_FAILED=1; \
	echo ""; \
	echo "$(CYAN)=== Agent Service Tests ===$(NC)"; \
	cd services/agent && \
		DATABASE_URL=postgresql+asyncpg://test:test@localhost:5433/podex_test \
		REDIS_URL=redis://localhost:6380 \
		ENVIRONMENT=test \
		API_URL=http://localhost:3001 \
		INTERNAL_SERVICE_TOKEN=test-internal-service-token \
		uv run pytest --cov=src --cov-report=term-missing --cov-report=html -v || TEST_FAILED=1; \
	if [ $$TEST_FAILED -eq 0 ]; then \
		echo "$(GREEN)Agent service tests passed ✓$(NC)"; \
	fi; \
	echo ""; \
	echo "$(CYAN)=== Compute Service Tests ===$(NC)"; \
	echo "$(YELLOW)Running compute tests with docker-compose...$(NC)"; \
	docker-compose -f docker-compose.test.yml up --build test-compute --abort-on-container-exit || TEST_FAILED=1; \
	docker-compose -f docker-compose.test.yml down test-compute; \
	echo "$(GREEN)Compute service tests passed ✓$(NC)"; \
	echo ""; \
	echo "$(CYAN)=== Local Pod Service Tests ===$(NC)"; \
	cd services/local-pod && uv run pytest --cov=src --cov-report=term-missing --cov-report=html -v || TEST_FAILED=1; \
	echo "$(GREEN)Local-pod service tests passed ✓$(NC)"; \
	echo ""; \
	echo "$(CYAN)Cleaning up test infrastructure...$(NC)"; \
	$(MAKE) test-clean; \
	echo ""; \
	if [ $$TEST_FAILED -eq 0 ]; then \
		echo "$(GREEN)✓ All tests complete!$(NC)"; \
	else \
		echo "$(RED)✗ Some tests failed - see output above$(NC)"; \
		exit 1; \
	fi

## Start test infrastructure (postgres-test, redis-test)
test-infra-up:
	@echo "$(CYAN)Starting test infrastructure...$(NC)"
	docker-compose -f docker-compose.test.yml up -d postgres-test redis-test
	@echo "$(CYAN)Waiting for services to be ready...$(NC)"
	@sleep 3
	@echo "$(GREEN)Test infrastructure ready!$(NC)"
	@echo "  Redis:    localhost:6380"
	@echo "  Postgres: localhost:5433"

## Stop test infrastructure
test-infra-down:
	@echo "$(CYAN)Stopping test infrastructure...$(NC)"
	docker-compose -f docker-compose.test.yml down
	@echo "$(GREEN)Test infrastructure stopped$(NC)"

## Run shared library tests with integration tests (requires Docker)
test-shared-integration:
	@echo "$(CYAN)Running shared library tests with integration tests...$(NC)"
	@# Check if test infrastructure is running
	@if ! docker ps | grep -q redis-test; then \
		echo "$(YELLOW)Test infrastructure not running, starting it...$(NC)"; \
		$(MAKE) test-infra-up; \
	fi
	@echo ""
	cd services/shared && \
		REDIS_URL=redis://localhost:6380 \
		RUN_INTEGRATION_TESTS=true \
		uv run pytest --cov=src --cov-report=term-missing --cov-report=html -v
	@echo ""
	@echo "$(GREEN)Shared library integration tests complete!$(NC)"
	@echo "$(CYAN)Coverage report: services/shared/htmlcov/index.html$(NC)"

## Run compute service tests with docker-compose
test-compute:
	@echo "$(CYAN)Running Compute Service Tests$(NC)"
	@echo ""
	@# Clean up any leftover test infrastructure
	@echo "$(CYAN)=== Cleaning up previous test infrastructure ===$(NC)"
	@$(MAKE) test-clean
	@echo ""
	@# Start test infrastructure
	@echo "$(CYAN)=== Starting Test Infrastructure (Redis) ===$(NC)"
	@docker-compose -f docker-compose.test.yml up -d redis-test
	@echo "$(CYAN)Waiting for Redis to be healthy...$(NC)"
	@until docker-compose -f docker-compose.test.yml exec -T redis-test redis-cli ping > /dev/null 2>&1; do \
		echo "  Waiting for redis..."; \
		sleep 1; \
	done
	@echo "$(GREEN)Redis is ready$(NC)"
	@echo ""
	@# Run tests
	@echo "$(CYAN)=== Running Compute Tests ===$(NC)"
	@TEST_FAILED=0; \
	docker-compose -f docker-compose.test.yml up --build test-compute --abort-on-container-exit || TEST_FAILED=1; \
	echo ""; \
	echo "$(CYAN)=== Cleaning up test infrastructure ===$(NC)"; \
	$(MAKE) test-clean; \
	echo ""; \
	if [ $$TEST_FAILED -eq 0 ]; then \
		echo "$(GREEN)✓ Compute tests passed with 90%+ coverage!$(NC)"; \
	else \
		echo "$(RED)✗ Compute tests failed$(NC)"; \
		exit 1; \
	fi

## Run compute tests locally (fast iteration, requires local Redis on port 6379)
test-compute-local:
	@echo "$(CYAN)Running compute tests locally (fast iteration)...$(NC)"
	@echo "$(YELLOW)Note: Requires local Redis on port 6379$(NC)"
	@echo "$(YELLOW)Tip: Start Redis with 'docker run -d -p 6379:6379 redis:7-alpine'$(NC)"
	@echo ""
	@# Clean up workspace containers from previous runs
	@docker ps -a --filter "label=podex.test=true" -q | xargs -r docker rm -f 2>/dev/null || true
	@docker ps -a --filter "ancestor=podex/workspace" -q | xargs -r docker rm -f 2>/dev/null || true
	@echo "$(CYAN)Running tests...$(NC)"
	@cd services/compute && \
		COMPUTE_REDIS_URL=redis://localhost:6379 \
		uv run pytest tests/ -v --cov=src --cov-report=term-missing --cov-report=html
	@echo ""
	@echo "$(GREEN)✓ Coverage report: services/compute/htmlcov/index.html$(NC)"

## Run comprehensive agent integration tests (local only, requires running services)
test-agent:
	@echo "$(CYAN)Starting Podex Agent Integration Test Suite$(NC)"
	@echo "$(YELLOW)⚠️  This test runs against local services with Ollama$(NC)"
	@echo ""
	@# Check if SKIP_AGENT_TESTS is set (for CI)
	@if [ "$$SKIP_AGENT_TESTS" = "true" ]; then \
		echo "$(YELLOW)Skipping agent tests (SKIP_AGENT_TESTS=true)$(NC)"; \
		exit 0; \
	fi
	@# Check if services are running, if not start them
	@if ! curl -s http://localhost:3001/health > /dev/null 2>&1; then \
		echo "$(YELLOW)Services not running, starting them...$(NC)"; \
		$(MAKE) run; \
		echo "$(CYAN)Waiting for services to be ready (30s)...$(NC)"; \
		sleep 30; \
	else \
		echo "$(GREEN)Services already running$(NC)"; \
	fi
	@# Run the test runner script
	@echo ""
	@echo "$(CYAN)Running agent integration tests...$(NC)"
	@chmod +x scripts/test-agent-runner.sh
	@./scripts/test-agent-runner.sh
	@echo ""
	@echo "$(GREEN)Agent integration tests complete!$(NC)"

## Run all package tests with coverage
test-packages:
	@echo "$(CYAN)Running all package tests with coverage...$(NC)"
	@echo ""
	@echo "$(CYAN)=== @podex/shared Package Tests ===$(NC)"
	cd packages/shared && pnpm test:coverage
	@echo ""
	@echo "$(CYAN)=== @podex/api-client Package Tests ===$(NC)"
	cd packages/api-client && pnpm test:coverage
	@echo ""
	@echo "$(CYAN)=== @podex/state Package Tests ===$(NC)"
	cd packages/state && pnpm test:coverage
	@echo ""
	@echo "$(CYAN)=== @podex/ui Package Tests ===$(NC)"
	cd packages/ui && pnpm test:coverage
	@echo ""
	@echo "$(GREEN)All package tests complete!$(NC)"

## Run @podex/shared package tests
test-shared:
	@echo "$(CYAN)Running @podex/shared tests with coverage...$(NC)"
	cd packages/shared && pnpm test:coverage

## Run @podex/api-client package tests
test-api-client:
	@echo "$(CYAN)Running @podex/api-client tests with coverage...$(NC)"
	cd packages/api-client && pnpm test:coverage

## Run @podex/state package tests
test-state:
	@echo "$(CYAN)Running @podex/state tests with coverage...$(NC)"
	cd packages/state && pnpm test:coverage

## Run @podex/ui package tests
test-ui:
	@echo "$(CYAN)Running @podex/ui tests with coverage...$(NC)"
	cd packages/ui && pnpm test:coverage

# ============================================
# CLI
# ============================================

## Run CLI in development mode (with tsx watch)
cli-dev:
	@echo "$(CYAN)Starting CLI in development mode...$(NC)"
	cd apps/cli && pnpm dev

## Build the CLI for production
cli-build:
	@echo "$(CYAN)Building CLI for production...$(NC)"
	cd apps/cli && pnpm build
	@echo "$(GREEN)CLI built! Binary at: apps/cli/dist/cli.js$(NC)"

## Run CLI tests with coverage
cli-test:
	@echo "$(CYAN)Running CLI tests with coverage...$(NC)"
	cd apps/cli && pnpm test:coverage
	@echo "$(GREEN)CLI tests complete!$(NC)"

## Run CLI E2E tests
cli-test-e2e:
	@echo "$(CYAN)Running CLI E2E tests...$(NC)"
	cd apps/cli && pnpm test:e2e
	@echo "$(GREEN)CLI E2E tests complete!$(NC)"

## Run all CLI tests (unit + E2E)
cli-test-all:
	@echo "$(CYAN)Running all CLI tests...$(NC)"
	$(MAKE) cli-test
	$(MAKE) cli-test-e2e
	@echo "$(GREEN)All CLI tests complete!$(NC)"

# ============================================
# VSCODE EXTENSION
# ============================================

## Lint the VSCode extension
vscode-lint:
	@echo "$(CYAN)Linting VSCode extension...$(NC)"
	cd apps/vscode && pnpm lint
	@echo "$(GREEN)VSCode extension lint complete!$(NC)"

## Build the VSCode extension
vscode-build:
	@echo "$(CYAN)Building VSCode extension...$(NC)"
	cd apps/vscode && pnpm build
	@echo "$(GREEN)VSCode extension built!$(NC)"

## Run VSCode extension tests
vscode-test:
	@echo "$(CYAN)Running VSCode extension tests...$(NC)"
	cd apps/vscode && pnpm test
	@echo "$(GREEN)VSCode extension tests complete!$(NC)"

## Run VSCode extension type check
vscode-typecheck:
	@echo "$(CYAN)Running VSCode extension type check...$(NC)"
	cd apps/vscode && pnpm typecheck
	@echo "$(GREEN)VSCode extension type check complete!$(NC)"

## Package the VSCode extension (.vsix)
vscode-package:
	@echo "$(CYAN)Packaging VSCode extension...$(NC)"
	cd apps/vscode && pnpm package
	@echo "$(GREEN)VSCode extension packaged! See apps/vscode/*.vsix$(NC)"

## Run VSCode extension in dev mode (watch)
vscode-dev:
	@echo "$(CYAN)Starting VSCode extension in development mode...$(NC)"
	cd apps/vscode && pnpm dev

# ============================================
# SYNC
# ============================================

## Sync all Python service venvs to match CI exactly (run this before pre-commit)
sync-venvs:
	@echo "$(CYAN)Syncing Python venvs to match CI...$(NC)"
	@echo "$(CYAN)  services/shared$(NC)"
	@cd services/shared && uv sync --extra dev --quiet
	@echo "$(CYAN)  services/api$(NC)"
	@cd services/api && uv sync --extra dev --quiet
	@echo "$(CYAN)  services/agent$(NC)"
	@cd services/agent && uv sync --extra dev --quiet
	@echo "$(CYAN)  services/compute$(NC)"
	@cd services/compute && uv sync --extra dev --quiet
	@echo "$(CYAN)  services/local-pod$(NC)"
	@cd services/local-pod && uv sync --extra dev --quiet
	@echo "$(GREEN)All venvs synced! Pre-commit will now match CI.$(NC)"

# ============================================
# CHECK
# ============================================

## Run pre-commit hooks (installs if not already installed)
check:
	@echo "$(CYAN)Checking if pre-commit is installed...$(NC)"
	@which pre-commit > /dev/null 2>&1 || (echo "$(YELLOW)Installing pre-commit...$(NC)" && pip install pre-commit)
	@echo "$(CYAN)Installing pre-commit hooks if not already installed...$(NC)"
	@pre-commit install 2>/dev/null || true
	@echo "$(CYAN)Running pre-commit hooks on all files...$(NC)"
	pre-commit run --all-files
	@echo "$(GREEN)All checks passed!$(NC)"

# ============================================
# RUN
# ============================================

## Start local development (requires Ollama with a model)
run:
	@echo "$(CYAN)Checking dependencies...$(NC)"
	@# Check if pnpm dependencies are installed
	@if [ ! -d "node_modules" ]; then \
		echo "$(RED)Error: Node modules not installed. Run 'make build' first.$(NC)"; \
		exit 1; \
	fi
	@# Check if Python venvs exist
	@if [ ! -d "services/api/.venv" ]; then \
		echo "$(RED)Error: Python dependencies not installed. Run 'make build' first.$(NC)"; \
		exit 1; \
	fi
	@# Check if Docker is running
	@docker info > /dev/null 2>&1 || (echo "$(RED)Error: Docker is not running. Please start Docker.$(NC)" && exit 1)
	@# Check if Ollama is installed
	@echo "$(CYAN)Checking Ollama...$(NC)"
	@if ! which ollama > /dev/null 2>&1; then \
		echo "$(YELLOW)Ollama is not installed.$(NC)"; \
		printf "Would you like to install it via Homebrew? [y/N] "; \
		read answer; \
		if [ "$$answer" = "y" ] || [ "$$answer" = "Y" ]; then \
			echo "$(CYAN)Installing Ollama...$(NC)"; \
			brew install ollama; \
		else \
			echo "$(RED)Ollama is required. Install manually: https://ollama.ai/download$(NC)"; \
			exit 1; \
		fi; \
	fi
	@# Check if Ollama is running
	@if ! curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then \
		echo "$(YELLOW)Ollama is not running.$(NC)"; \
		printf "Would you like to start it? [y/N] "; \
		read answer; \
		if [ "$$answer" = "y" ] || [ "$$answer" = "Y" ]; then \
			echo "$(CYAN)Starting Ollama in background...$(NC)"; \
			ollama serve > /dev/null 2>&1 & \
			sleep 3; \
			if ! curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then \
				echo "$(RED)Failed to start Ollama. Try running 'ollama serve' manually.$(NC)"; \
				exit 1; \
			fi; \
		else \
			echo "$(RED)Please start Ollama: ollama serve$(NC)"; \
			exit 1; \
		fi; \
	fi
	@# Check if Ollama has at least one model
	@MODELS=$$(curl -s http://localhost:11434/api/tags | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('models',[])))" 2>/dev/null); \
	if [ "$$MODELS" = "0" ] || [ -z "$$MODELS" ]; then \
		echo "$(YELLOW)No models installed in Ollama.$(NC)"; \
		printf "Would you like to install qwen2.5-coder:14b (recommended for coding)? [y/N] "; \
		read answer; \
		if [ "$$answer" = "y" ] || [ "$$answer" = "Y" ]; then \
			echo "$(CYAN)Pulling qwen2.5-coder:14b (this may take a few minutes)...$(NC)"; \
			ollama pull qwen2.5-coder:14b; \
		else \
			echo "$(RED)At least one model is required. Install manually:$(NC)"; \
			echo "  ollama pull qwen2.5-coder:14b"; \
			exit 1; \
		fi; \
	fi
	@echo "$(GREEN)Ollama is running with models available$(NC)"
	@echo ""
	@echo "$(CYAN)Starting development environment...$(NC)"
	@echo "$(CYAN)This includes workspace servers (ws-local-1, ws-local-2)$(NC)"
	@# Detect host IP for mobile access
	@HOST_IP=$$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $$1}' || echo "localhost"); \
	echo "$(CYAN)Detected host IP: $$HOST_IP$(NC)"; \
	NEXT_PUBLIC_API_URL=http://$$HOST_IP:3001 \
	NEXT_PUBLIC_WS_URL=ws://$$HOST_IP:3001 \
	CORS_ORIGINS='["http://localhost:3000","http://'$$HOST_IP':3000"]' \
	docker-compose up -d
	@echo ""
	@echo "$(CYAN)Waiting for workspace servers to be ready...$(NC)"
	@# Wait for both DinD containers to be healthy (up to 60 seconds)
	@for i in 1 2 3 4 5 6 7 8 9 10 11 12; do \
		WS1_READY=$$(docker exec ws-local-1 docker -H tcp://localhost:2375 info > /dev/null 2>&1 && echo "yes" || echo "no"); \
		WS2_READY=$$(docker exec ws-local-2 docker -H tcp://localhost:2375 info > /dev/null 2>&1 && echo "yes" || echo "no"); \
		if [ "$$WS1_READY" = "yes" ] && [ "$$WS2_READY" = "yes" ]; then \
			echo "  Both workspace servers ready"; \
			break; \
		fi; \
		echo "  Waiting for workspace servers (ws-local-1: $$WS1_READY, ws-local-2: $$WS2_READY)..."; \
		sleep 5; \
	done
	@# Small delay to ensure Docker daemons are fully stable
	@sleep 2
	@# Check if workspace images are loaded in DinD, load if missing
	@ARCH=$$(uname -m); \
	if [ "$$ARCH" = "arm64" ] || [ "$$ARCH" = "aarch64" ]; then \
		IMG="podex/workspace:latest-arm64"; \
	else \
		IMG="podex/workspace:latest-amd64"; \
	fi; \
	if ! docker exec ws-local-1 docker -H tcp://localhost:2375 images -q $$IMG 2>/dev/null | grep -q .; then \
		echo "$(YELLOW)Workspace image not found in DinD containers, loading...$(NC)"; \
		$(MAKE) load-workspace-images-dind; \
	else \
		echo "$(GREEN)Workspace images already loaded in DinD containers$(NC)"; \
	fi
	@echo ""
	@HOST_IP=$$(ipconfig getifaddr en0 2>/dev/null || echo "localhost"); \
	echo "$(GREEN)Services started!$(NC)"; \
	echo "  Web:               http://localhost:3000 (or http://$$HOST_IP:3000 from mobile)"; \
	echo "  API:               http://localhost:3001 (or http://$$HOST_IP:3001 from mobile)"; \
	echo "  Compute:           http://localhost:3003"; \
	echo "  Workspace Servers: ws-local-1, ws-local-2 (internal Docker-in-Docker)"; \
	echo "  Ollama:            http://localhost:11434"; \
	echo "  Sentry Spotlight:  http://localhost:8969 (local Sentry debugging UI)"
	@echo ""
	@echo "$(CYAN)To view logs: make logs$(NC)"
	@echo "$(CYAN)To stop: make stop$(NC)"

## Stop running services
stop:
	@echo "$(CYAN)Stopping services...$(NC)"
	docker-compose down
	@echo "$(GREEN)Services stopped$(NC)"

## Watch logs from all services (including workspace containers)
logs:
	@echo "$(CYAN)Streaming logs from all services and workspace containers...$(NC)"
	@echo "$(YELLOW)Press Ctrl+C to stop$(NC)"
	@# Use a subshell to run both log streams
	@(docker-compose logs -f &) ; \
	for container in $$(docker ps --filter "name=podex-workspace-" --format "{{.Names}}" 2>/dev/null); do \
		(docker logs -f "$$container" 2>&1 | sed "s/^/$$container | /" &); \
	done; \
	wait

## Watch logs from docker-compose services only (no workspace containers)
logs-compose:
	docker-compose logs -f

## Watch logs from workspace containers only
logs-workspaces:
	@echo "$(CYAN)Streaming logs from workspace containers...$(NC)"
	@for container in $$(docker ps --filter "name=podex-workspace-" --format "{{.Names}}" 2>/dev/null); do \
		echo "$(GREEN)Following logs for $$container$(NC)"; \
		(docker logs -f "$$container" 2>&1 | sed "s/^/$$container | /" &); \
	done; \
	wait

# ============================================
# CLEAN
# ============================================

## Stop all services, remove volumes, and kill all workspace containers
clean:
	@echo "$(YELLOW)Stopping all services and cleaning up...$(NC)"
	@# Stop docker-compose services and remove volumes
	@echo "$(CYAN)Stopping docker-compose services...$(NC)"
	-docker-compose down -v 2>/dev/null || true
	@# Find and kill all podex/workspace containers
	@echo "$(CYAN)Finding and stopping workspace containers...$(NC)"
	@WORKSPACES=$$(docker ps -q --filter "ancestor=podex/workspace" 2>/dev/null); \
	if [ -n "$$WORKSPACES" ]; then \
		echo "$(CYAN)Stopping $$(echo $$WORKSPACES | wc -w | tr -d ' ') workspace container(s)...$(NC)"; \
		docker stop $$WORKSPACES 2>/dev/null || true; \
		docker rm $$WORKSPACES 2>/dev/null || true; \
	fi
	@# Find and kill any containers with "podex" or "workspace" in the name
	@PODEX_CONTAINERS=$$(docker ps -aq --filter "name=podex" 2>/dev/null); \
	if [ -n "$$PODEX_CONTAINERS" ]; then \
		echo "$(CYAN)Stopping $$(echo $$PODEX_CONTAINERS | wc -w | tr -d ' ') podex container(s)...$(NC)"; \
		docker stop $$PODEX_CONTAINERS 2>/dev/null || true; \
		docker rm $$PODEX_CONTAINERS 2>/dev/null || true; \
	fi
	@# Clean up any dangling workspace volumes
	@echo "$(CYAN)Cleaning up volumes...$(NC)"
	-docker volume ls -q --filter "name=podex" 2>/dev/null | xargs -r docker volume rm 2>/dev/null || true
	@# Remove build artifacts
	@echo "$(CYAN)Removing build artifacts...$(NC)"
	rm -rf .turbo apps/*/.next
	rm -rf services/*/.mypy_cache services/*/.ruff_cache services/*/.pytest_cache
	@echo "$(GREEN)Clean complete!$(NC)"

# ============================================
# HELP
# ============================================

## Show help
help:
	@echo ""
	@echo "$(CYAN)Podex Development Commands$(NC)"
	@echo ""
	@echo "$(YELLOW)Build & Development:$(NC)"
	@echo "  $(GREEN)make build$(NC)             Install all dependencies and build Docker images"
	@echo "  $(GREEN)make build-workspace-images$(NC)  Build workspace images locally (arm64 + amd64)"
	@echo "  $(GREEN)make run$(NC)               Start local development (requires Ollama with a model)"
	@echo "  $(GREEN)make stop$(NC)              Stop running services"
	@echo "  $(GREEN)make logs$(NC)              Watch logs from all services"
	@echo "  $(GREEN)make clean$(NC)             Stop all services, remove volumes, kill workspaces"
	@echo ""
	@echo "$(YELLOW)Production:$(NC)"
	@echo "  $(GREEN)REGISTRY=ghcr.io/org make push-workspace-images$(NC)  Build & push multi-arch images"
	@echo ""
	@echo "$(YELLOW)Testing:$(NC)"
	@echo "  $(GREEN)make test$(NC)              Run all tests with coverage + cleanup (recommended)"
	@echo "  $(GREEN)make test-clean$(NC)        Clean up test infrastructure (containers, volumes, networks)"
	@echo "  $(GREEN)make test-compute$(NC)      Run compute service tests with docker-compose"
	@echo "  $(GREEN)make test-compute-local$(NC) Run compute tests locally (requires Redis on port 6379)"
	@echo "  $(GREEN)make test-packages$(NC)     Run all frontend package tests with coverage"
	@echo "  $(GREEN)make test-agent$(NC)        Run comprehensive agent integration tests (local only)"
	@echo ""
	@echo "$(YELLOW)CLI:$(NC)"
	@echo "  $(GREEN)make cli-dev$(NC)           Run CLI in development mode (with tsx watch)"
	@echo "  $(GREEN)make cli-build$(NC)         Build the CLI for production"
	@echo "  $(GREEN)make cli-test$(NC)          Run CLI tests with coverage"
	@echo "  $(GREEN)make cli-test-e2e$(NC)      Run CLI E2E tests"
	@echo "  $(GREEN)make cli-test-all$(NC)      Run all CLI tests (unit + E2E)"
	@echo ""
	@echo "$(YELLOW)Code Quality:$(NC)"
	@echo "  $(GREEN)make sync-venvs$(NC)        Sync all Python venvs to match CI exactly"
	@echo "  $(GREEN)make check$(NC)             Run pre-commit hooks (installs hooks if needed)"
	@echo ""
	@echo "$(YELLOW)Help:$(NC)"
	@echo "  $(GREEN)make help$(NC)              Show this help message"
	@echo ""
	@echo "$(YELLOW)Prerequisites:$(NC)"
	@echo "  - Docker and Docker Compose"
	@echo "  - Node.js 20+ and pnpm"
	@echo "  - Python 3.11+ and uv"
	@echo "  - Ollama with at least one model installed"
	@echo ""
	@echo "$(CYAN)Agent Integration Tests:$(NC)"
	@echo "  The 'test-agent' target runs comprehensive tests against real Ollama models"
	@echo "  - Tests all agent types, modes, and UI integration"
	@echo "  - Monitors Docker logs for errors"
	@echo "  - Takes 15-25 minutes to complete"
	@echo "  - Generates detailed reports in test-logs/"
	@echo "  - Automatically skipped in CI (local only)"
	@echo ""
