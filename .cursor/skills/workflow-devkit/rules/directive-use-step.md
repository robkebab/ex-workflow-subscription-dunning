# directive-use-step

**Impact: CRITICAL (enables retries and result caching)**

Mark side-effect functions with the `"use step"` directive to enable automatic retries, result caching, and full Node.js access.

## Incorrect

```typescript
export async function processPayment(orderId: string) {
  "use workflow";
  
  // BAD: Direct API call in workflow context
  const response = await fetch(`/api/charge/${orderId}`, {
    method: 'POST'
  })
  return response.json()
}
```

Direct I/O in workflow context breaks determinism and doesn't support retries.

## Correct

```typescript
async function chargeOrder(orderId: string) {
  "use step";
  
  const response = await fetch(`/api/charge/${orderId}`, {
    method: 'POST'
  })
  return response.json()
}

export async function processPayment(orderId: string) {
  "use workflow";
  
  const result = await chargeOrder(orderId)
  return result
}
```

Step functions:
- Have full Node.js runtime access
- Can use any npm packages
- Support automatic retries (default: 3 retries)
- Have results cached for workflow replay
- Can be reused across multiple workflows

## Key Points

- Directive must be the first statement inside the function body
- Function must be `async`
- Use steps for all I/O: HTTP requests, database, file system, etc.
