# Podex Agent Integration Tests

Comprehensive integration tests for the Podex agent platform, testing all agent types, modes, and UI integration with real Ollama models running locally.

## Running Tests

### Quick Start

```bash
# Run all agent integration tests
make test-agent
```

This will:

1. Check if services are running (start them if not)
2. Verify Ollama is available with models
3. Run Python API tests
4. Run Playwright UI tests
5. Monitor Docker logs for errors
6. Generate detailed test reports

### Prerequisites

- Local services running with Ollama
- At least one Ollama model installed (e.g., `qwen2.5-coder:14b`)
- Python 3.12+ with pytest
- Node.js with Playwright

### Manual Test Execution

#### Python API Tests Only

```bash
# Run all local-only tests
pytest tests/ -v -m "local_only"

# Run specific test file
pytest tests/test_agent_capabilities.py -v

# Run specific test class
pytest tests/test_agent_capabilities.py::TestAgentTypes -v

# Run with verbose output
pytest tests/ -v -s -m "local_only"
```

#### Playwright UI Tests Only

```bash
cd apps/web
npm run test:e2e

# Run in headed mode (see browser)
npm run test:e2e:headed

# Run with UI mode (interactive)
npm run test:e2e:ui
```

## Test Organization

### Directory Structure

```
tests/
├── __init__.py              # Package initialization
├── conftest.py              # Pytest fixtures and configuration
├── test_agent_capabilities.py   # Agent type and mode tests
├── test_integration_scenarios.py # Complex workflow tests
└── README.md                # This file

apps/web/e2e/
└── agent-ui.spec.ts         # Playwright UI tests
```

### Test Markers

Tests use pytest markers for categorization:

- `@pytest.mark.local_only` - Requires local services with Ollama (skipped in CI)
- `@pytest.mark.integration` - Integration test
- `@pytest.mark.slow` - Slow-running test
- `@pytest.mark.agent` - Agent-related functionality

## Test Fixtures

Common fixtures defined in `conftest.py`:

- `api_client` - Authenticated HTTP client for API calls
- `test_session` - Auto-created and cleaned-up test session
- `auth_token` - Authentication token for API requests
- `ollama_model` - Configured Ollama model name
- `test_timeout` - Timeout for agent operations
- `wait_for_services` - Ensures all services are ready

## Environment Variables

Configure tests with environment variables:

- `API_BASE_URL` - API service URL (default: http://localhost:3001)
- `AGENT_BASE_URL` - Agent service URL (default: http://localhost:3002)
- `WEB_BASE_URL` - Web frontend URL (default: http://localhost:3000)
- `TEST_USER_EMAIL` - Test user email (default: admin@podex.dev)
- `TEST_USER_PASSWORD` - Test user password (default: AdminPassword123!)
- `OLLAMA_MODEL` - Ollama model to use (default: qwen2.5-coder:14b)
- `TEST_TIMEOUT` - Timeout in seconds (default: 120)
- `SKIP_AGENT_TESTS` - Set to "true" to skip tests (for CI)

## CI/CD Integration

These tests are **NOT** run in CI because they require:

- Local Ollama with models
- Significant compute resources
- Extended execution time (10-30 minutes)

Tests are automatically skipped in CI when:

- `CI=true` environment variable is set
- `SKIP_AGENT_TESTS=true` is set

To prevent accidental CI runs, tests are marked with `@pytest.mark.local_only`.

## Test Output

### Logs

Test runs generate detailed logs in `test-logs/`:

- `test-run-TIMESTAMP.log` - Complete test output
- `docker-logs-TIMESTAMP.log` - Docker service logs during test run

### Reports

- **Pytest**: Terminal output with pass/fail status
- **Playwright**: HTML report in `apps/web/playwright-report/`
- **Playwright Screenshots**: `apps/web/test-results/`

## Writing New Tests

### Python API Test Example

```python
import pytest

@pytest.mark.local_only
@pytest.mark.integration
class TestMyFeature:
    def test_something(self, api_client, test_session, ollama_model):
        # Create agent
        response = api_client.post(
            f"/api/sessions/{test_session}/agents",
            json={
                "name": "Test Agent",
                "role": "chat",
                "model": f"ollama/{ollama_model}"
            }
        )
        assert response.status_code == 200

        # Test functionality
        agent_id = response.json()["id"]
        # ... more test code
```

### Playwright UI Test Example

```typescript
import { test, expect } from '@playwright/test';

test.describe('My Feature', () => {
  test.skip(
    process.env.SKIP_AGENT_TESTS === 'true' || process.env.CI === 'true',
    'Skipping local-only tests'
  );

  test('should do something', async ({ page }) => {
    await page.goto('/');
    // ... test code
  });
});
```

## Troubleshooting

### Services Not Starting

```bash
# Check if services are running
docker-compose ps

# Restart services
make stop
make run
```

### Ollama Issues

```bash
# Check Ollama status
curl http://localhost:11434/api/tags

# List installed models
ollama list

# Pull a model
ollama pull qwen2.5-coder:14b
```

### Tests Timing Out

- Increase `TEST_TIMEOUT` environment variable
- Check Docker logs for errors: `docker-compose logs -f`
- Verify Ollama has sufficient resources

### Playwright Failures

```bash
# Update browsers
cd apps/web
npx playwright install

# Run with debug mode
npm run test:e2e:debug

# Check screenshots
open apps/web/test-results/
```

## Performance

Expected test execution times (with local Ollama):

- Python API Tests: 10-15 minutes
- Playwright UI Tests: 5-10 minutes
- **Total: ~15-25 minutes**

Times vary based on:

- Hardware (CPU, GPU for Ollama)
- Ollama model size
- Number of tests run

## Best Practices

1. **Always run locally first** before committing test changes
2. **Check Docker logs** if tests fail unexpectedly
3. **Use appropriate timeouts** for Ollama operations (60-120s)
4. **Clean up resources** in test fixtures
5. **Mark tests appropriately** with pytest markers
6. **Write descriptive test names** that explain what's being tested
7. **Add console logging** to track test progress

## Contributing

When adding new tests:

1. Add appropriate markers (`@pytest.mark.local_only`, etc.)
2. Use existing fixtures for consistency
3. Clean up resources in fixtures or teardown
4. Update this README if adding new test categories
5. Test locally before submitting PR

## Support

For issues or questions:

- Check logs in `test-logs/`
- Review Docker logs: `make logs`
- Create an issue with test output and logs
