#!/bin/bash
#
# Podex Agent Integration Test Runner
#
# This script runs comprehensive agent tests against local services with Ollama,
# monitoring Docker logs in real-time to catch any issues.
#
# Usage: ./scripts/test-agent-runner.sh
# Or: make test-agent
#

set -e  # Exit on error

# Colors for output
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Test configuration
TEST_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${TEST_ROOT}/test-logs"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="${LOG_DIR}/test-run-${TIMESTAMP}.log"
DOCKER_LOG_FILE="${LOG_DIR}/docker-logs-${TIMESTAMP}.log"

# Create log directory
mkdir -p "${LOG_DIR}"

# Initialize log file
echo "Podex Agent Integration Test Run - ${TIMESTAMP}" > "${LOG_FILE}"
echo "===============================================" >> "${LOG_FILE}"
echo "" >> "${LOG_FILE}"

# Function to log messages
log() {
    echo -e "${1}" | tee -a "${LOG_FILE}"
}

log_section() {
    echo "" | tee -a "${LOG_FILE}"
    echo -e "${CYAN}========================================${NC}" | tee -a "${LOG_FILE}"
    echo -e "${CYAN}${1}${NC}" | tee -a "${LOG_FILE}"
    echo -e "${CYAN}========================================${NC}" | tee -a "${LOG_FILE}"
}

# Function to check service health
check_service() {
    local service_name=$1
    local url=$2
    local max_retries=30
    local retry_delay=2

    log "${CYAN}Checking ${service_name}...${NC}"

    for i in $(seq 1 $max_retries); do
        if curl -s -o /dev/null -w "%{http_code}" "${url}" | grep -q -E "200|404"; then
            log "${GREEN}✓ ${service_name} is ready${NC}"
            return 0
        fi

        if [ $i -eq $max_retries ]; then
            log "${RED}✗ ${service_name} failed to start after ${max_retries} attempts${NC}"
            return 1
        fi

        sleep $retry_delay
    done
}

# Function to monitor docker logs
start_log_monitoring() {
    log_section "Starting Docker Log Monitoring"

    # Start docker logs in background
    docker-compose logs -f --tail=100 > "${DOCKER_LOG_FILE}" 2>&1 &
    DOCKER_LOG_PID=$!

    log "${GREEN}✓ Docker logs being written to: ${DOCKER_LOG_FILE}${NC}"
    log "${YELLOW}  PID: ${DOCKER_LOG_PID}${NC}"
}

# Function to stop log monitoring
stop_log_monitoring() {
    if [ ! -z "${DOCKER_LOG_PID}" ]; then
        log "${CYAN}Stopping log monitoring...${NC}"
        kill ${DOCKER_LOG_PID} 2>/dev/null || true
        wait ${DOCKER_LOG_PID} 2>/dev/null || true
    fi
}

# Function to check for errors in logs
check_logs_for_errors() {
    log_section "Checking Docker Logs for Errors"

    if [ -f "${DOCKER_LOG_FILE}" ]; then
        # Look for common error patterns
        local error_count=$(grep -i -E "error|exception|failed|fatal" "${DOCKER_LOG_FILE}" | \
                           grep -v -E "errorCode|ErrorBoundary|no error" | \
                           wc -l | tr -d ' ')

        if [ "${error_count}" -gt "0" ]; then
            log "${YELLOW}⚠️  Found ${error_count} potential error(s) in Docker logs${NC}"
            log "${YELLOW}   Check ${DOCKER_LOG_FILE} for details${NC}"

            # Show last 20 errors
            log ""
            log "${CYAN}Last 20 error lines:${NC}"
            grep -i -E "error|exception|failed|fatal" "${DOCKER_LOG_FILE}" | \
                grep -v -E "errorCode|ErrorBoundary|no error" | \
                tail -20 | tee -a "${LOG_FILE}"
        else
            log "${GREEN}✓ No critical errors found in Docker logs${NC}"
        fi
    fi
}

# Cleanup function
cleanup() {
    log_section "Cleanup"
    stop_log_monitoring

    log "${CYAN}Test logs saved to:${NC}"
    log "  Test output: ${LOG_FILE}"
    log "  Docker logs: ${DOCKER_LOG_FILE}"
}

# Trap cleanup on exit
trap cleanup EXIT

# Main test execution
main() {
    cd "${TEST_ROOT}"

    log_section "Podex Agent Integration Test Suite"
    log "${YELLOW}This will run comprehensive agent tests with Ollama${NC}"
    log ""

    # Check services are running
    log_section "Step 1: Service Health Checks"

    check_service "API Service" "http://localhost:3001/health" || exit 1
    check_service "Agent Service" "http://localhost:3002/health" || exit 1
    check_service "Web Frontend" "http://localhost:3000" || exit 1

    # Check Ollama
    log "${CYAN}Checking Ollama...${NC}"
    if curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
        OLLAMA_MODELS=$(curl -s http://localhost:11434/api/tags | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('models',[])))" 2>/dev/null || echo "0")
        if [ "${OLLAMA_MODELS}" -gt "0" ]; then
            log "${GREEN}✓ Ollama is ready with ${OLLAMA_MODELS} model(s)${NC}"
        else
            log "${RED}✗ Ollama has no models installed${NC}"
            exit 1
        fi
    else
        log "${RED}✗ Ollama is not running${NC}"
        exit 1
    fi

    # Start log monitoring
    start_log_monitoring

    # Install test dependencies with uv
    log_section "Step 2: Installing Test Dependencies"

    log "${CYAN}Installing test dependencies with uv...${NC}"
    if cd "${TEST_ROOT}" && uv sync 2>&1 | tee -a "${LOG_FILE}"; then
        log "${GREEN}✓ Test dependencies installed${NC}"
    else
        log "${YELLOW}⚠️  uv sync had issues, continuing...${NC}"
    fi

    # Run pytest tests
    log_section "Step 3: Running Python API Tests"

    log "${CYAN}Running pytest with -v (verbose) and -s (no capture)...${NC}"
    log ""

    if cd "${TEST_ROOT}" && uv run pytest tests/ -v -s --tb=short -m "local_only" 2>&1 | tee -a "${LOG_FILE}"; then
        PYTEST_EXIT_CODE=0
        log ""
        log "${GREEN}✓ Python API tests passed${NC}"
    else
        PYTEST_EXIT_CODE=$?
        log ""
        log "${RED}✗ Python API tests failed with exit code ${PYTEST_EXIT_CODE}${NC}"
    fi

    # Check logs after pytest
    check_logs_for_errors

    # Run Playwright tests
    log_section "Step 4: Running Playwright UI Tests"

    log "${CYAN}Running Playwright tests...${NC}"
    log ""

    if cd "${TEST_ROOT}/apps/web" && npm run test:e2e 2>&1 | tee -a "${LOG_FILE}"; then
        PLAYWRIGHT_EXIT_CODE=0
        log ""
        log "${GREEN}✓ Playwright UI tests passed${NC}"
    else
        PLAYWRIGHT_EXIT_CODE=$?
        log ""
        log "${RED}✗ Playwright UI tests failed with exit code ${PLAYWRIGHT_EXIT_CODE}${NC}"
    fi

    # Final log check
    check_logs_for_errors

    # Summary
    log_section "Test Summary"

    log "Test Run: ${TIMESTAMP}"
    log ""
    log "Results:"
    if [ ${PYTEST_EXIT_CODE} -eq 0 ]; then
        log "  ${GREEN}✓ Python API Tests: PASSED${NC}"
    else
        log "  ${RED}✗ Python API Tests: FAILED (exit code ${PYTEST_EXIT_CODE})${NC}"
    fi

    if [ ${PLAYWRIGHT_EXIT_CODE} -eq 0 ]; then
        log "  ${GREEN}✓ Playwright UI Tests: PASSED${NC}"
    else
        log "  ${RED}✗ Playwright UI Tests: FAILED (exit code ${PLAYWRIGHT_EXIT_CODE})${NC}"
    fi

    log ""
    log "Log Files:"
    log "  ${LOG_FILE}"
    log "  ${DOCKER_LOG_FILE}"

    # Exit with failure if any tests failed
    if [ ${PYTEST_EXIT_CODE} -ne 0 ] || [ ${PLAYWRIGHT_EXIT_CODE} -ne 0 ]; then
        log ""
        log "${RED}❌ Some tests failed${NC}"
        exit 1
    else
        log ""
        log "${GREEN}✅ All tests passed successfully!${NC}"
        exit 0
    fi
}

# Run main function
main
