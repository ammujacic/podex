.PHONY: build test check run stop logs clean help

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
	cd infrastructure && uv sync --active --dev --quiet
	@echo "$(CYAN)Building frontend packages...$(NC)"
	pnpm build
	@echo "$(CYAN)Building Docker images...$(NC)"
	docker-compose build
	@echo "$(GREEN)Build complete!$(NC)"

# ============================================
# TEST
# ============================================

## Run all tests with coverage
test:
	@echo "$(CYAN)Running all tests with coverage...$(NC)"
	@echo ""
	@echo "$(CYAN)=== Frontend Tests ===$(NC)"
	pnpm test:coverage
	@echo ""
	@echo "$(CYAN)=== Shared Library Tests ===$(NC)"
	cd services/shared && uv run pytest --cov=src --cov-report=term-missing
	@echo ""
	@echo "$(CYAN)=== API Service Tests ===$(NC)"
	cd services/api && uv run pytest --cov=src --cov-report=term-missing
	@echo ""
	@echo "$(CYAN)=== Agent Service Tests ===$(NC)"
	cd services/agent && uv run pytest --cov=src --cov-report=term-missing
	@echo ""
	@echo "$(CYAN)=== Compute Service Tests ===$(NC)"
	cd services/compute && uv run pytest --cov=src --cov-report=term-missing
	@echo ""
	@echo "$(CYAN)=== Infrastructure Tests ===$(NC)"
	cd infrastructure && uv run pytest tests/ -v --tb=short
	@echo ""
	@echo "$(GREEN)All tests complete!$(NC)"

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

## Run infrastructure tests only
test-infra:
	@echo "$(CYAN)Running infrastructure tests...$(NC)"
	cd infrastructure && uv run pytest tests/ -v --tb=short
	@echo "$(GREEN)Infrastructure tests complete!$(NC)"

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
	@# Detect host IP for mobile access
	@HOST_IP=$$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $$1}' || echo "localhost"); \
	echo "$(CYAN)Detected host IP: $$HOST_IP$(NC)"; \
	NEXT_PUBLIC_API_URL=http://$$HOST_IP:3001 \
	NEXT_PUBLIC_WS_URL=ws://$$HOST_IP:3001 \
	CORS_ORIGINS='["http://localhost:3000","http://'$$HOST_IP':3000"]' \
	LLM_PROVIDER=ollama docker-compose up -d
	@echo ""
	@HOST_IP=$$(ipconfig getifaddr en0 2>/dev/null || echo "localhost"); \
	echo "$(GREEN)Services started!$(NC)"; \
	echo "  Web:    http://localhost:3000 (or http://$$HOST_IP:3000 from mobile)"; \
	echo "  API:    http://localhost:3001 (or http://$$HOST_IP:3001 from mobile)"; \
	echo "  Ollama: http://localhost:11434"
	@echo ""
	@echo "$(CYAN)To view logs: make logs$(NC)"
	@echo "$(CYAN)To stop: make stop$(NC)"

## Stop running services
stop:
	@echo "$(CYAN)Stopping services...$(NC)"
	docker-compose down
	@echo "$(GREEN)Services stopped$(NC)"

## Watch logs from all services
logs:
	docker-compose logs -f

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
	@echo "$(GREEN)make build$(NC)        Install all dependencies and build Docker images"
	@echo "$(GREEN)make test$(NC)         Run all tests with coverage (frontend + all Python services + infrastructure)"
	@echo "$(GREEN)make test-infra$(NC)   Run infrastructure tests only"
	@echo "$(GREEN)make test-agent$(NC)   Run comprehensive agent integration tests (local only, requires Ollama)"
	@echo "$(GREEN)make check$(NC)        Run pre-commit hooks (installs hooks if needed)"
	@echo "$(GREEN)make run$(NC)          Start local development (requires Ollama with a model)"
	@echo "$(GREEN)make stop$(NC)         Stop running services"
	@echo "$(GREEN)make logs$(NC)         Watch logs from all services"
	@echo "$(GREEN)make clean$(NC)        Stop all services, remove volumes, kill workspaces"
	@echo "$(GREEN)make help$(NC)         Show this help message"
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
