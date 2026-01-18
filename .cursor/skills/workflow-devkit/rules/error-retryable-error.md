# error-retryable-error

**Impact: HIGH (handles rate limits, temporary failures)**

Use `RetryableError` when you want to retry after a specific delay. Ideal for rate limiting, temporary unavailability, or known recovery periods.

## Basic Usage

```typescript
import { RetryableError } from "workflow";

async function callAPI(endpoint: string) {
  "use step";
  
  const response = await fetch(endpoint)
  
  if (response.status === 429) {
    // Rate limited - retry after specified delay
    throw new RetryableError('Rate limited', {
      retryAfter: '60s'
    })
  }
  
  return response.json()
}
```

## Delay Options

```typescript
// String duration
throw new RetryableError('Retry later', { retryAfter: '5s' })   // 5 seconds
throw new RetryableError('Retry later', { retryAfter: '5m' })   // 5 minutes
throw new RetryableError('Retry later', { retryAfter: '1h' })   // 1 hour
throw new RetryableError('Retry later', { retryAfter: '1d' })   // 1 day

// Milliseconds
throw new RetryableError('Retry later', { retryAfter: 5000 })

// Specific Date
throw new RetryableError('Retry later', { 
  retryAfter: new Date('2024-01-01T12:00:00Z') 
})
```

## Full Example: API with Rate Limit Handling

```typescript
import { RetryableError, FatalError } from "workflow";

async function callExternalAPI(endpoint: string) {
  "use step";
  
  const response = await fetch(endpoint)
  
  if (response.status === 429) {
    const retryAfter = response.headers.get('Retry-After')
    throw new RetryableError('Rate limited', {
      retryAfter: retryAfter ? `${retryAfter}s` : '60s'
    })
  }
  
  if (response.status >= 500) {
    // Server error - retry with default delay
    throw new RetryableError(`Server error: ${response.status}`)
  }
  
  if (response.status === 404) {
    // Not found - don't retry
    throw new FatalError('Resource not found')
  }
  
  return response.json()
}
```

If `retryAfter` is omitted, defaults to 1 second.
