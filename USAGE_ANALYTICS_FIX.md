# Usage Analytics Issues - Diagnosis and Fixes

## Issues Found and Fixed

### 1. ✅ FIXED: Compute Usage by Tier Query Bug

**Problem**: The "Compute Usage by Tier" section was always empty because the analytics query was trying to read the `tier` from the wrong location.

**Root Cause**:

- Analytics code was reading: `UsageRecord.record_metadata["tier"].astext` (from JSON metadata)
- Billing code was storing: `UsageRecord.tier` (dedicated column)

**Fix Applied**: Changed [analytics.py:518](services/api/src/routes/admin/analytics.py#L518) to use `UsageRecord.tier` directly.

**File**: `services/api/src/routes/admin/analytics.py`

---

### 2. ✅ FIXED: Pod/Session Usage Not Being Tracked

**Problem**: All hardware specs show "Total Usage: 0.0h" - compute usage was not being tracked at all.

**Root Cause**: Service authentication was blocking usage tracking:

1. Compute service has `internal_service_token = None` by default
2. When token is None, usage tracker doesn't send Authorization header
3. Billing API was rejecting ALL requests without Authorization header, even in development mode

**Fix Applied**: Modified `_verify_service_token()` in billing.py to allow requests without authorization in development mode.

**File**: `services/api/src/routes/billing.py` (lines 2119-2139)

**Changes**:

```python
# Before: Rejected all requests without authorization
if not authorization:
    return False

# After: Allow requests without authorization in development
if settings.ENVIRONMENT == "development" and not authorization:
    return True
```

---

### 3. ⚠️ TO INVESTIGATE: Daily Token Usage Chart Empty

**Problem**: Tokens ARE being tracked (confirmed by user) but the Daily Token Usage chart is empty.

**Possible Causes**:

1. Token records exist but are outside the selected date range (30 days)
2. Token records have incorrect `created_at` timestamps
3. Query is working but returning no results

**Diagnostic Script**: Run the diagnostic script to investigate:

```bash
cd /Users/mujacic/podex
python scripts/diagnose-usage-data.py
```

This script will:

- Check total number of usage records
- Show breakdown by usage type
- Display date range of existing records
- Check if records exist in the last 30 days
- Show daily token distribution

**Expected Output if Working**:

- Total records > 0
- Token records exist (tokens_input, tokens_output)
- Records in last 30 days > 0
- Daily distribution shows data

**If Records Are Too Old**:

- Try selecting a longer time range in the UI (90 days or 1 year)
- The time range selector is at the top right of the Usage Analytics page

---

## Testing the Fixes

### 1. Restart Services

After applying the fixes, restart all services:

```bash
# If using Docker Compose
docker-compose restart api compute agent

# OR if running individually
# Restart each service...
```

### 2. Verify Compute Usage Tracking

1. Create a new pod/workspace (use arm-micro tier)
2. Use it for a few minutes
3. Stop/delete the pod
4. Check the Admin > Hardware Specifications page
5. The "Total Usage" should now show hours > 0

### 3. Verify Daily Token Usage Chart

1. Use an agent to generate some token usage
2. Go to Admin > Analytics > Usage
3. Check if the Daily Token Usage chart shows data
4. If still empty, run the diagnostic script (see above)

---

## Environment Configuration (Optional)

For production or if you want proper service authentication in development, set the internal service token:

### Option A: Using .env files

Create/update `.env` files in each service:

**services/api/.env**:

```env
INTERNAL_SERVICE_TOKEN=your-secure-token-here
ENVIRONMENT=development
```

**services/compute/.env**:

```env
COMPUTE_INTERNAL_SERVICE_TOKEN=your-secure-token-here
```

**services/agent/.env**:

```env
INTERNAL_SERVICE_TOKEN=your-secure-token-here
```

### Option B: Using docker-compose.yml

Add environment variables to your docker-compose.yml:

```yaml
services:
  api:
    environment:
      - INTERNAL_SERVICE_TOKEN=your-secure-token-here
      - ENVIRONMENT=development

  compute:
    environment:
      - COMPUTE_INTERNAL_SERVICE_TOKEN=your-secure-token-here

  agent:
    environment:
      - INTERNAL_SERVICE_TOKEN=your-secure-token-here
```

**Note**: With the fix applied, this is **optional** for development mode. The system will work without configuring these tokens.

---

## Verification Checklist

- [x] Compute Usage by Tier query fixed (using correct column)
- [x] Service authentication allows development mode without token
- [ ] Restart all services
- [ ] Create and use a pod to verify compute tracking
- [ ] Check Hardware Specifications page shows usage
- [ ] Run diagnostic script to check token data
- [ ] Verify Daily Token Usage chart displays data

---

## Additional Notes

### Why Was This Happening?

1. **Compute tracking**: The system was designed to require service-to-service authentication for security, but the default configuration didn't have tokens set up, and the code wasn't allowing development mode bypass.

2. **Tier query bug**: Simple typo in the analytics code - wrong field name was used.

3. **Token chart empty**: Likely a data issue (no records in date range) rather than a code bug, but needs investigation.

### Security Considerations

- The fix allows unauthenticated usage tracking **only** in development mode
- In production (when `ENVIRONMENT != "development"`), a valid `INTERNAL_SERVICE_TOKEN` is **required**
- This is a reasonable security tradeoff for local development

### Next Steps if Token Chart Still Empty

If the Daily Token Usage chart is still empty after running the diagnostic:

1. Check if any usage records exist at all
2. Verify the `created_at` timestamps are recent
3. Check if records have correct `usage_type` values
4. Try selecting different date ranges (7 days, 90 days, 1 year)
5. Check browser console for any JavaScript errors
6. Verify the API endpoint `/api/admin/analytics/usage` is returning data

---

## Summary

Two major fixes were applied:

1. **Analytics query bug**: Fixed incorrect column reference for compute tier data
2. **Service authentication**: Enabled usage tracking in development mode without requiring service tokens

After restarting services, pod/session usage should now be tracked and displayed correctly. Token usage tracking should already be working, but may need date range adjustment or further investigation using the diagnostic script.
