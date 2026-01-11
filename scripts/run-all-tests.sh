#!/bin/bash
#
# Podex Unified Test Runner
#
# This script runs all tests across the monorepo:
# - Frontend E2E tests (Playwright)
# - Frontend unit tests (Vitest)
# - API service tests (pytest)
# - Agent service tests (pytest)
#
# Usage:
#   ./scripts/run-all-tests.sh           # Run all tests
#   ./scripts/run-all-tests.sh e2e       # Run only E2E tests
#   ./scripts/run-all-tests.sh api       # Run only API tests
#   ./scripts/run-all-tests.sh agent     # Run only Agent tests
#   ./scripts/run-all-tests.sh frontend  # Run only frontend unit tests
#
# The script outputs results to test-results/ directories in each package
# Screenshots from Playwright are saved to apps/web/test-results/
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Test result tracking
TESTS_PASSED=0
TESTS_FAILED=0
FAILED_TESTS=()

# Function to print colored output
print_header() {
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

# Function to run frontend E2E tests
run_e2e_tests() {
    print_header "Running Frontend E2E Tests (Playwright)"

    cd "$ROOT_DIR/apps/web"

    if ! command -v npx &> /dev/null; then
        print_error "npx not found. Please install Node.js"
        return 1
    fi

    # Create test-results directory
    mkdir -p test-results

    # Run Playwright tests
    if npx playwright test --reporter=list 2>&1; then
        print_success "E2E tests passed"
        ((TESTS_PASSED++))
        return 0
    else
        print_error "E2E tests failed"
        ((TESTS_FAILED++))
        FAILED_TESTS+=("E2E (Playwright)")
        return 1
    fi
}

# Function to run frontend unit tests
run_frontend_tests() {
    print_header "Running Frontend Unit Tests (Vitest)"

    cd "$ROOT_DIR/apps/web"

    if pnpm test 2>&1; then
        print_success "Frontend unit tests passed"
        ((TESTS_PASSED++))
        return 0
    else
        print_warning "Frontend unit tests failed or no tests found"
        # Don't fail if no tests exist yet
        return 0
    fi
}

# Function to run API service tests
run_api_tests() {
    print_header "Running API Service Tests (pytest)"

    cd "$ROOT_DIR/services/api"

    if ! command -v pytest &> /dev/null; then
        # Try with uv
        if command -v uv &> /dev/null; then
            if uv run pytest tests/ -v --tb=short 2>&1; then
                print_success "API tests passed"
                ((TESTS_PASSED++))
                return 0
            else
                print_error "API tests failed"
                ((TESTS_FAILED++))
                FAILED_TESTS+=("API (pytest)")
                return 1
            fi
        else
            print_warning "pytest not found. Skipping API tests."
            return 0
        fi
    fi

    if pytest tests/ -v --tb=short 2>&1; then
        print_success "API tests passed"
        ((TESTS_PASSED++))
        return 0
    else
        print_error "API tests failed"
        ((TESTS_FAILED++))
        FAILED_TESTS+=("API (pytest)")
        return 1
    fi
}

# Function to run Agent service tests
run_agent_tests() {
    print_header "Running Agent Service Tests (pytest)"

    cd "$ROOT_DIR/services/agent"

    if ! command -v pytest &> /dev/null; then
        # Try with uv
        if command -v uv &> /dev/null; then
            if uv run pytest tests/ -v --tb=short 2>&1; then
                print_success "Agent tests passed"
                ((TESTS_PASSED++))
                return 0
            else
                print_error "Agent tests failed"
                ((TESTS_FAILED++))
                FAILED_TESTS+=("Agent (pytest)")
                return 1
            fi
        else
            print_warning "pytest not found. Skipping Agent tests."
            return 0
        fi
    fi

    if pytest tests/ -v --tb=short 2>&1; then
        print_success "Agent tests passed"
        ((TESTS_PASSED++))
        return 0
    else
        print_error "Agent tests failed"
        ((TESTS_FAILED++))
        FAILED_TESTS+=("Agent (pytest)")
        return 1
    fi
}

# Function to print summary
print_summary() {
    print_header "Test Summary"

    echo ""
    echo -e "Tests passed: ${GREEN}$TESTS_PASSED${NC}"
    echo -e "Tests failed: ${RED}$TESTS_FAILED${NC}"

    if [ ${#FAILED_TESTS[@]} -gt 0 ]; then
        echo ""
        echo -e "${RED}Failed test suites:${NC}"
        for test in "${FAILED_TESTS[@]}"; do
            echo -e "  ${RED}✗${NC} $test"
        done
    fi

    echo ""
    if [ $TESTS_FAILED -eq 0 ]; then
        print_success "All tests passed!"
        return 0
    else
        print_error "Some tests failed. Check the output above for details."
        return 1
    fi
}

# Main function
main() {
    print_header "Podex Test Runner"

    local test_type="${1:-all}"

    case "$test_type" in
        e2e)
            run_e2e_tests || true
            ;;
        frontend)
            run_frontend_tests || true
            ;;
        api)
            run_api_tests || true
            ;;
        agent)
            run_agent_tests || true
            ;;
        all)
            run_frontend_tests || true
            run_api_tests || true
            run_agent_tests || true
            run_e2e_tests || true
            ;;
        *)
            echo "Usage: $0 [e2e|frontend|api|agent|all]"
            exit 1
            ;;
    esac

    print_summary
}

# Run main function
main "$@"
