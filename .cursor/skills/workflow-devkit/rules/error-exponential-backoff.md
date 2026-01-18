# error-exponential-backoff

**Impact: HIGH (improves reliability)**

Use `getStepMetadata()` to implement exponential backoff for services that may need recovery time.

## Basic Pattern

```typescript
import { RetryableError, getStepMetadata } from "workflow";

async function callExternalService(endpoint: string) {
  "use step";
  
  const { attempt } = getStepMetadata()
  
  const response = await fetch(endpoint)
  
  if (response.status >= 500) {
    // Exponential backoff: 1s, 4s, 9s, 16s, 25s...
    const delay = Math.min(
      (attempt ** 2) * 1000,
      60000  // Max 60 seconds
    )
    throw new RetryableError(`Server error: ${response.status}`, {
      retryAfter: delay
    })
  }
  
  return response.json()
}

callExternalService.maxRetries = 5
```

## Full Example: Comprehensive Error Handling

```typescript
import { RetryableError, FatalError, getStepMetadata } from "workflow";

async function callExternalService(endpoint: string) {
  "use step";
  
  const { attempt } = getStepMetadata()
  
  const response = await fetch(endpoint)
  
  if (!response.ok) {
    if (response.status >= 500) {
      // Server error - exponential backoff
      const delay = Math.min(
        (attempt ** 2) * 1000,
        60000
      )
      throw new RetryableError(`Server error: ${response.status}`, {
        retryAfter: delay
      })
    }
    
    if (response.status === 429) {
      // Rate limited - use Retry-After header if available
      const retryAfter = response.headers.get('Retry-After')
      throw new RetryableError('Rate limited', {
        retryAfter: retryAfter ? `${retryAfter}s` : '60s'
      })
    }
    
    if (response.status === 404) {
      throw new FatalError(`Resource not found: ${endpoint}`)
    }
    
    // Other client errors - don't retry
    throw new FatalError(`Client error: ${response.status}`)
  }
  
  return response.json()
}

callExternalService.maxRetries = 5
```

## getStepMetadata() Returns

```typescript
const {
  stepId,        // Unique identifier for this step execution
  attempt,       // Current attempt number (1-based)
  stepStartedAt  // Timestamp when step began
} = getStepMetadata()
```
