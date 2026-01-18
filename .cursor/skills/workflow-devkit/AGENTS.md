# Workflow DevKit Best Practices

**Version 1.0.0**  
Vercel Engineering  
January 2026

> **Note:**  
> This document is mainly for agents and LLMs to follow when maintaining,  
> generating, or refactoring workflow code using Vercel's Workflow DevKit.  
> Humans may also find it useful, but guidance here is optimized for automation  
> and consistency by AI-assisted workflows.

---

## Abstract

Comprehensive guide for building durable, observable workflows with Vercel's Workflow DevKit. Contains 25+ rules across 8 categories, covering everything from directive usage and determinism requirements to error handling, webhooks, and streaming. Each rule includes detailed explanations, real-world examples comparing incorrect vs. correct implementations, and specific guidance to ensure workflows are reliable, resumable, and maintainable.

---

## Table of Contents

1. [Directives & Structure](#1-directives--structure) — **CRITICAL**
   - 1.1 [Mark Orchestration Functions with "use workflow"](#11-mark-orchestration-functions-with-use-workflow)
   - 1.2 [Mark Side-Effect Functions with "use step"](#12-mark-side-effect-functions-with-use-step)
   - 1.3 [Place Directives Inside Function Body](#13-place-directives-inside-function-body)
   - 1.4 [Workflow and Step Functions Must Be Async](#14-workflow-and-step-functions-must-be-async)
2. [Determinism](#2-determinism) — **CRITICAL**
   - 2.1 [No Direct Side Effects in Workflow Functions](#21-no-direct-side-effects-in-workflow-functions)
   - 2.2 [Avoid Non-Deterministic Operations](#22-avoid-non-deterministic-operations)
   - 2.3 [All I/O Must Happen in Step Functions](#23-all-io-must-happen-in-step-functions)
   - 2.4 [Use Control Flow Safely](#24-use-control-flow-safely)
3. [Serialization](#3-serialization) — **HIGH**
   - 3.1 [Use Only Serializable Types](#31-use-only-serializable-types)
   - 3.2 [Understand Pass-by-Value Semantics](#32-understand-pass-by-value-semantics)
   - 3.3 [Return Modified Data from Steps](#33-return-modified-data-from-steps)
4. [Error Handling & Retries](#4-error-handling--retries) — **HIGH**
   - 4.1 [Understand Default Retry Behavior](#41-understand-default-retry-behavior)
   - 4.2 [Use RetryableError for Custom Delays](#42-use-retryableerror-for-custom-delays)
   - 4.3 [Use FatalError for Permanent Failures](#43-use-fatalerror-for-permanent-failures)
   - 4.4 [Configure maxRetries on Step Functions](#44-configure-maxretries-on-step-functions)
   - 4.5 [Implement Exponential Backoff](#45-implement-exponential-backoff)
5. [Hooks & Webhooks](#5-hooks--webhooks) — **MEDIUM-HIGH**
   - 5.1 [Use createHook for Arbitrary Payload Suspension](#51-use-createhook-for-arbitrary-payload-suspension)
   - 5.2 [Use createWebhook for HTTP-Triggered Resumption](#52-use-createwebhook-for-http-triggered-resumption)
   - 5.3 [Resume Hooks and Webhooks from API Routes](#53-resume-hooks-and-webhooks-from-api-routes)
6. [Streaming](#6-streaming) — **MEDIUM**
   - 6.1 [Only Write to Streams Inside Step Functions](#61-only-write-to-streams-inside-step-functions)
   - 6.2 [Always Release Writer Locks](#62-always-release-writer-locks)
   - 6.3 [Explicitly Close Streams When Done](#63-explicitly-close-streams-when-done)
   - 6.4 [Use Namespaced Streams for Separate Channels](#64-use-namespaced-streams-for-separate-channels)
7. [Workflow Management](#7-workflow-management) — **MEDIUM**
   - 7.1 [Use start() to Trigger Workflows](#71-use-start-to-trigger-workflows)
   - 7.2 [Use the Run Object for Status and Output](#72-use-the-run-object-for-status-and-output)
   - 7.3 [Retrieve Existing Runs with getRun()](#73-retrieve-existing-runs-with-getrun)
   - 7.4 [Use sleep() for Durable Delays](#74-use-sleep-for-durable-delays)
8. [Best Practices](#8-best-practices) — **MEDIUM**
   - 8.1 [Make Step Side Effects Idempotent](#81-make-step-side-effects-idempotent)
   - 8.2 [Use getStepMetadata for Idempotency Keys](#82-use-getstepmetadata-for-idempotency-keys)
   - 8.3 [Implement Compensating Actions for Rollback](#83-implement-compensating-actions-for-rollback)

---

## 1. Directives & Structure

**Impact: CRITICAL**

Directives are the foundation of Workflow DevKit. They mark functions for special handling by the compiler and runtime, enabling durable execution, replay, and observability.

### 1.1 Mark Orchestration Functions with "use workflow"

**Impact: CRITICAL (enables durability and replay)**

The `"use workflow"` directive marks a function as a workflow orchestrator. Workflow functions coordinate steps, handle control flow, and can suspend/resume across server restarts.

**Incorrect: missing directive**

```typescript
// This function won't be transformed - it's just a regular async function
export async function processOrder(orderId: string) {
  const order = await fetchOrder(orderId)
  await chargePayment(order)
  await sendConfirmation(order)
  return { success: true }
}
```

**Correct: with workflow directive**

```typescript
export async function processOrder(orderId: string) {
  "use workflow";
  
  const order = await fetchOrder(orderId)
  await chargePayment(order)
  await sendConfirmation(order)
  return { success: true }
}
```

With the directive, the function:
- Can suspend and resume after server restarts
- Replays deterministically using cached step results
- Has observable execution via the Workflow DevKit dashboard
- Gets a stable `workflowId` for identification

### 1.2 Mark Side-Effect Functions with "use step"

**Impact: CRITICAL (enables retries and result caching)**

The `"use step"` directive marks a function as a step. Steps perform actual work (API calls, database operations, file I/O) with full Node.js access and automatic retry support.

**Incorrect: side effects in workflow**

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

**Correct: side effects in step**

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

### 1.3 Place Directives Inside Function Body

**Impact: CRITICAL (compiler requirement)**

Directives must be placed as the first statement inside the function body, not at the file level or as a comment.

**Incorrect: directive at file level**

```typescript
"use workflow";

export async function myWorkflow() {
  // This won't work - directive is at file level
  await doSomething()
}
```

**Incorrect: directive as comment**

```typescript
export async function myWorkflow() {
  // "use workflow"
  await doSomething()
}
```

**Correct: directive inside function body**

```typescript
export async function myWorkflow() {
  "use workflow";
  
  await doSomething()
}

async function myStep() {
  "use step";
  
  return await fetchData()
}
```

### 1.4 Workflow and Step Functions Must Be Async

**Impact: CRITICAL (runtime requirement)**

Both workflow and step functions must be declared as `async` functions. Synchronous functions cannot be workflows or steps.

**Incorrect: synchronous function**

```typescript
function processData(data: string) {
  "use step";  // Error: step must be async
  return data.toUpperCase()
}
```

**Correct: async function**

```typescript
async function processData(data: string) {
  "use step";
  
  return data.toUpperCase()
}
```

---

## 2. Determinism

**Impact: CRITICAL**

Workflow functions must be deterministic to support replay. When a workflow resumes after suspension, it re-executes from the beginning, using cached step results. Non-deterministic code will cause replay failures.

### 2.1 No Direct Side Effects in Workflow Functions

**Impact: CRITICAL (breaks replay)**

Workflow functions run in a sandboxed environment without direct access to Node.js APIs. All side effects must go through step functions.

**Incorrect: direct side effects**

```typescript
export async function badWorkflow(userId: string) {
  "use workflow";
  
  // BAD: Direct file system access
  const data = fs.readFileSync('config.json')
  
  // BAD: Direct database call
  await db.users.update({ id: userId })
  
  // BAD: Direct HTTP request
  await fetch('/api/notify')
  
  return { done: true }
}
```

**Correct: side effects in steps**

```typescript
async function readConfig() {
  "use step";
  return JSON.parse(fs.readFileSync('config.json', 'utf-8'))
}

async function updateUser(userId: string) {
  "use step";
  await db.users.update({ id: userId })
}

async function sendNotification() {
  "use step";
  await fetch('/api/notify')
}

export async function goodWorkflow(userId: string) {
  "use workflow";
  
  const config = await readConfig()
  await updateUser(userId)
  await sendNotification()
  return { done: true }
}
```

### 2.2 Avoid Non-Deterministic Operations

**Impact: CRITICAL (breaks replay)**

Operations like `Math.random()`, `Date.now()`, and `crypto.randomUUID()` produce different values on each execution, breaking replay. The workflow sandbox provides deterministic versions of these.

**Incorrect: non-deterministic values**

```typescript
export async function badWorkflow() {
  "use workflow";
  
  // BAD: Different value on replay
  const id = crypto.randomUUID()
  
  // BAD: Different value on replay  
  const timestamp = Date.now()
  
  // BAD: Different value on replay
  const random = Math.random()
  
  await processWithId(id)
}
```

**Correct: generate in steps or use sandbox values**

```typescript
async function generateId() {
  "use step";
  return crypto.randomUUID()
}

export async function goodWorkflow() {
  "use workflow";
  
  // Good: ID generated in step, cached for replay
  const id = await generateId()
  
  await processWithId(id)
}
```

The workflow sandbox automatically provides seeded/deterministic versions of `Math.random()` and `Date` for use within workflow context, but it's safer to generate such values in steps when they need to be stable.

### 2.3 All I/O Must Happen in Step Functions

**Impact: CRITICAL (sandbox restriction)**

Workflow functions cannot access network, file system, or external services directly. All I/O operations must be performed in step functions.

**What CAN happen in workflows:**
- Control flow (if/else, loops, try/catch)
- Calling step functions
- Using workflow primitives (sleep, createHook, createWebhook)
- Basic computation on cached/serialized data

**What MUST happen in steps:**
- HTTP requests (fetch, axios)
- Database operations
- File system access
- External API calls
- Sending emails/notifications
- Any other I/O

### 2.4 Use Control Flow Safely

**Impact: HIGH (ensures correct replay)**

Loops, conditionals, and Promise.all() work correctly in workflows as long as they're deterministic and only call step functions for I/O.

**Correct: loops and conditionals**

```typescript
export async function processItems(items: Item[]) {
  "use workflow";
  
  const results = []
  
  for (const item of items) {
    if (item.requiresProcessing) {
      const result = await processItem(item)  // step function
      results.push(result)
    }
  }
  
  return results
}
```

**Correct: parallel step execution**

```typescript
export async function processParallel(ids: string[]) {
  "use workflow";
  
  // All steps run in parallel, results cached individually
  const results = await Promise.all(
    ids.map(id => fetchData(id))  // step function
  )
  
  return results
}
```

**Correct: try/catch for error handling**

```typescript
export async function safeWorkflow(id: string) {
  "use workflow";
  
  try {
    const result = await riskyOperation(id)  // step function
    return { success: true, result }
  } catch (error) {
    await logError(error)  // step function
    return { success: false, error: error.message }
  }
}
```

---

## 3. Serialization

**Impact: HIGH**

All data passed between workflows and steps must be serializable. The Workflow DevKit uses a serialization layer built on `devalue` to support a wide range of types.

### 3.1 Use Only Serializable Types

**Impact: HIGH (runtime requirement)**

Only serializable types can be passed as arguments or return values across workflow/step boundaries.

**Supported types:**

- **Standard JSON types:** string, number, boolean, null, arrays, plain objects
- **Extended types:** undefined, bigint, Date, RegExp
- **Binary types:** ArrayBuffer, Uint8Array, Int8Array, Float32Array, etc.
- **Collection types:** Map, Set
- **Web types:** URL, URLSearchParams, Headers, Request, Response
- **Stream types:** ReadableStream, WritableStream (with special handling)

**Not supported:**

- Functions and closures
- Class instances (without custom serialization)
- Symbols
- WeakMap, WeakSet
- Circular references (unless handled by devalue)

**Incorrect: non-serializable types**

```typescript
async function badStep(callback: () => void) {
  "use step";
  
  // BAD: Functions cannot be serialized
  callback()
}

class MyService {
  async process() { /* ... */ }
}

async function alsoBAd(service: MyService) {
  "use step";
  
  // BAD: Class instances are not serializable
  await service.process()
}
```

**Correct: use serializable data**

```typescript
async function goodStep(config: { url: string; timeout: number }) {
  "use step";
  
  // Good: Plain object with primitive values
  return await fetch(config.url, { timeout: config.timeout })
}

export async function workflow() {
  "use workflow";
  
  // Good: Pass data, not behavior
  const result = await goodStep({
    url: 'https://api.example.com',
    timeout: 5000
  })
}
```

### 3.2 Understand Pass-by-Value Semantics

**Impact: HIGH (prevents bugs)**

Data passed between workflows and steps is serialized and deserialized—it's passed by value, not by reference. Mutations inside a step do not affect the original data in the workflow.

**Incorrect: expecting mutation to propagate**

```typescript
async function updateInPlace(user: { name: string }) {
  "use step";
  
  // This mutation won't be seen by the workflow
  user.name = "Updated"
}

export async function workflow() {
  "use workflow";
  
  const user = { name: "Original" }
  await updateInPlace(user)
  
  // user.name is still "Original" - mutation didn't propagate!
  console.log(user.name)
}
```

**Correct: return the modified value**

```typescript
async function updateUser(user: { name: string }) {
  "use step";
  
  return { ...user, name: "Updated" }
}

export async function workflow() {
  "use workflow";
  
  const user = { name: "Original" }
  const updatedUser = await updateUser(user)
  
  // updatedUser.name is "Updated"
  console.log(updatedUser.name)
}
```

### 3.3 Return Modified Data from Steps

**Impact: HIGH (ensures data consistency)**

Since steps pass data by value, always return any modified data that the workflow needs. Don't rely on parameter mutation.

**Pattern: transform and return**

```typescript
async function enrichUser(user: User) {
  "use step";
  
  const profile = await fetchProfile(user.id)
  const permissions = await fetchPermissions(user.id)
  
  // Return enriched object
  return {
    ...user,
    profile,
    permissions,
    enrichedAt: new Date()
  }
}

export async function onboardUser(userId: string) {
  "use workflow";
  
  let user = await fetchUser(userId)
  user = await enrichUser(user)  // Replace with enriched version
  user = await validateUser(user)  // Replace with validated version
  await saveUser(user)
  
  return user
}
```

---

## 4. Error Handling & Retries

**Impact: HIGH**

Step functions support automatic retries with configurable behavior. Understanding error types and retry configuration is essential for building reliable workflows.

### 4.1 Understand Default Retry Behavior

**Impact: HIGH (affects reliability)**

By default, step functions retry up to 3 times after the initial attempt fails (4 total tries). If all retries fail, the error propagates to the workflow.

**Default behavior:**

```typescript
async function unreliableStep() {
  "use step";
  
  // If this throws, it will be retried up to 3 times
  const response = await fetch('https://flaky-api.example.com')
  if (!response.ok) {
    throw new Error('API failed')
  }
  return response.json()
}
```

### 4.2 Use RetryableError for Custom Delays

**Impact: HIGH (handles rate limits, temporary failures)**

Use `RetryableError` when you want to retry after a specific delay. This is ideal for rate limiting, temporary service unavailability, or known recovery periods.

**Example: handling rate limits**

```typescript
import { RetryableError } from "workflow";

async function callRateLimitedAPI(endpoint: string) {
  "use step";
  
  const response = await fetch(endpoint)
  
  if (response.status === 429) {
    const retryAfter = response.headers.get('Retry-After') || '60'
    throw new RetryableError('Rate limited', {
      retryAfter: `${retryAfter}s`
    })
  }
  
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`)
  }
  
  return response.json()
}
```

**RetryableError delay options:**

```typescript
// String duration
throw new RetryableError('Retry later', { retryAfter: '5m' })
throw new RetryableError('Retry later', { retryAfter: '30s' })
throw new RetryableError('Retry later', { retryAfter: '1h' })

// Milliseconds
throw new RetryableError('Retry later', { retryAfter: 5000 })

// Specific Date
throw new RetryableError('Retry later', { retryAfter: new Date('2024-01-01T12:00:00Z') })
```

### 4.3 Use FatalError for Permanent Failures

**Impact: HIGH (prevents wasted retries)**

Use `FatalError` when retrying would be pointless—the error is permanent and won't resolve with time.

**Example: validation errors**

```typescript
import { FatalError } from "workflow";

async function processPayment(orderId: string, amount: number) {
  "use step";
  
  if (amount <= 0) {
    // Don't retry - this is a permanent validation error
    throw new FatalError('Invalid payment amount')
  }
  
  const order = await db.orders.findUnique({ where: { id: orderId } })
  
  if (!order) {
    // Don't retry - order doesn't exist
    throw new FatalError(`Order not found: ${orderId}`)
  }
  
  if (order.status === 'cancelled') {
    // Don't retry - order was cancelled
    throw new FatalError('Cannot process cancelled order')
  }
  
  return await chargeCard(order.customerId, amount)
}
```

**Use FatalError for:**
- Validation errors
- Resource not found (404)
- Authorization failures (401, 403)
- Invalid input
- Business rule violations

### 4.4 Configure maxRetries on Step Functions

**Impact: MEDIUM (customizes retry behavior)**

Override the default retry count by setting `maxRetries` on the step function.

**Example: configure retries**

```typescript
async function criticalOperation(data: Data) {
  "use step";
  
  // Perform critical operation
  return await externalService.process(data)
}

// Allow more retries for critical operations
criticalOperation.maxRetries = 10

async function quickCheck(id: string) {
  "use step";
  
  return await cache.get(id)
}

// Fewer retries for non-critical operations
quickCheck.maxRetries = 1
```

### 4.5 Implement Exponential Backoff

**Impact: HIGH (improves reliability)**

Use `getStepMetadata()` to implement exponential backoff for services that may need recovery time.

**Example: exponential backoff**

```typescript
import { RetryableError, getStepMetadata } from "workflow";

async function callExternalService(endpoint: string) {
  "use step";
  
  const { attempt } = getStepMetadata()
  
  const response = await fetch(endpoint)
  
  if (!response.ok) {
    if (response.status >= 500) {
      // Server error - retry with exponential backoff
      const delay = Math.min(
        (attempt ** 2) * 1000,  // 1s, 4s, 9s, 16s...
        60000                   // Max 60 seconds
      )
      throw new RetryableError(`Server error: ${response.status}`, {
        retryAfter: delay
      })
    }
    
    if (response.status === 429) {
      // Rate limited - check Retry-After header
      const retryAfter = response.headers.get('Retry-After')
      throw new RetryableError('Rate limited', {
        retryAfter: retryAfter ? `${retryAfter}s` : '60s'
      })
    }
    
    if (response.status === 404) {
      // Not found - don't retry
      throw new FatalError(`Resource not found: ${endpoint}`)
    }
    
    // Other client errors - don't retry
    throw new FatalError(`Client error: ${response.status}`)
  }
  
  return response.json()
}

callExternalService.maxRetries = 5
```

---

## 5. Hooks & Webhooks

**Impact: MEDIUM-HIGH**

Hooks and webhooks allow workflows to suspend and wait for external events. This is essential for human-in-the-loop workflows, payment callbacks, and third-party integrations.

### 5.1 Use createHook for Arbitrary Payload Suspension

**Impact: MEDIUM-HIGH (enables external event handling)**

Use `createHook()` when you want to suspend a workflow until external code sends data via `resumeHook()`.

**Example: approval workflow**

```typescript
import { createHook } from "workflow";

export async function approvalWorkflow(requestId: string) {
  "use workflow";
  
  const request = await fetchRequest(requestId)
  await notifyApprovers(request)
  
  // Create hook and wait for approval
  const hook = createHook<{ approved: boolean; comment: string }>()
  
  // Store token for external systems
  await saveApprovalToken(requestId, hook.token)
  
  // Workflow suspends here until resumeHook is called
  const decision = await hook
  
  if (decision.approved) {
    await processApproval(request)
  } else {
    await processRejection(request, decision.comment)
  }
  
  return decision
}
```

**Hook properties:**
- `token: string` - Unique identifier for resuming
- Implements `AsyncIterable` for multiple events

### 5.2 Use createWebhook for HTTP-Triggered Resumption

**Impact: MEDIUM-HIGH (enables HTTP callbacks)**

Use `createWebhook()` when external systems will resume the workflow via HTTP request (e.g., payment provider callbacks, OAuth flows).

**Example: payment callback**

```typescript
import { createWebhook } from "workflow";

export async function checkoutWorkflow(orderId: string) {
  "use workflow";
  
  const order = await getOrder(orderId)
  
  // Create webhook URL for payment provider callback
  const webhook = createWebhook({
    token: `payment:${orderId}`,
    respondWith: "manual"
  })
  
  // Start payment with callback URL
  await initiatePayment(order, webhook.url)
  
  // Workflow suspends until payment provider calls webhook URL
  const request = await webhook
  
  // Process the callback
  const payload = await request.json()
  
  // Send custom response to payment provider
  await request.respondWith(
    new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  )
  
  if (payload.status === 'completed') {
    await fulfillOrder(order)
  } else {
    await handlePaymentFailure(order, payload)
  }
  
  return { orderId, status: payload.status }
}
```

**Webhook options:**
- `token` - Custom token (defaults to auto-generated)
- `respondWith: "manual"` - Require explicit response from workflow

### 5.3 Resume Hooks and Webhooks from API Routes

**Impact: MEDIUM-HIGH (connects external systems)**

Use `resumeHook()` and `resumeWebhook()` from `workflow/api` in your API routes to resume suspended workflows.

**Example: approval API route**

```typescript
// app/api/approve/[requestId]/route.ts
import { resumeHook } from "workflow/api";
import { NextResponse } from "next/server";

export async function POST(
  request: Request,
  { params }: { params: { requestId: string } }
) {
  const { approved, comment } = await request.json()
  
  // Get the hook token (stored earlier by workflow)
  const token = await getApprovalToken(params.requestId)
  
  // Resume the workflow with the decision
  await resumeHook(token, { approved, comment })
  
  return NextResponse.json({ success: true })
}
```

**Example: webhook handler for payment provider**

```typescript
// app/api/webhooks/payment/route.ts
import { resumeWebhook } from "workflow/api";

export async function POST(request: Request) {
  // Payment provider sends callback
  const response = await resumeWebhook(
    `payment:${request.headers.get('x-order-id')}`,
    request
  )
  
  // Return response from workflow (if respondWith: "manual")
  return response
}
```

---

## 6. Streaming

**Impact: MEDIUM**

Workflow DevKit supports streaming output for real-time progress updates, AI response streaming, and large data processing.

### 6.1 Only Write to Streams Inside Step Functions

**Impact: CRITICAL (determinism requirement)**

Stream operations (read/write) must happen in step functions, not in workflow context. This ensures deterministic replay.

**Incorrect: writing in workflow**

```typescript
import { getWritable } from "workflow";

export async function badWorkflow() {
  "use workflow";
  
  const writable = getWritable()
  const writer = writable.getWriter()
  
  // BAD: Writing in workflow context breaks determinism
  await writer.write('Progress: 50%')
  writer.releaseLock()
}
```

**Correct: writing in step**

```typescript
import { getWritable } from "workflow";

async function writeProgress(message: string) {
  "use step";
  
  const writable = getWritable()
  const writer = writable.getWriter()
  
  await writer.write(message)
  writer.releaseLock()
}

export async function goodWorkflow() {
  "use workflow";
  
  await writeProgress('Starting...')
  await doWork()
  await writeProgress('50% complete')
  await doMoreWork()
  await writeProgress('Done!')
}
```

### 6.2 Always Release Writer Locks

**Impact: HIGH (prevents resource leaks)**

After writing to a stream, always release the writer lock. Unreleased locks can cause step execution to hang.

**Incorrect: lock not released**

```typescript
async function badWrite(data: string) {
  "use step";
  
  const writable = getWritable()
  const writer = writable.getWriter()
  
  await writer.write(data)
  // BAD: Lock not released - step may hang
}
```

**Correct: lock released**

```typescript
async function goodWrite(data: string) {
  "use step";
  
  const writable = getWritable()
  const writer = writable.getWriter()
  
  try {
    await writer.write(data)
  } finally {
    writer.releaseLock()  // Always release
  }
}
```

### 6.3 Explicitly Close Streams When Done

**Impact: MEDIUM (signals completion to clients)**

Close streams explicitly when output is complete. This signals to clients that no more data will arrive.

**Example: close on completion**

```typescript
async function finishStream() {
  "use step";
  
  const writable = getWritable()
  await writable.close()
}

export async function streamingWorkflow() {
  "use workflow";
  
  await writeProgress('Step 1')
  await processStep1()
  
  await writeProgress('Step 2')
  await processStep2()
  
  await writeProgress('Complete')
  await finishStream()  // Signal end of stream
  
  return { success: true }
}
```

### 6.4 Use Namespaced Streams for Separate Channels

**Impact: MEDIUM (organizes output)**

Use namespaced streams to separate different types of output (e.g., logs vs. progress vs. results).

**Example: separate channels**

```typescript
async function writeLog(message: string) {
  "use step";
  
  const writable = getWritable({ namespace: "logs" })
  const writer = writable.getWriter()
  await writer.write({ level: "info", message, timestamp: new Date() })
  writer.releaseLock()
}

async function writeProgress(percent: number) {
  "use step";
  
  const writable = getWritable({ namespace: "progress" })
  const writer = writable.getWriter()
  await writer.write({ percent })
  writer.releaseLock()
}

async function writeResult(data: any) {
  "use step";
  
  const writable = getWritable({ namespace: "results" })
  const writer = writable.getWriter()
  await writer.write(data)
  writer.releaseLock()
}

// Client can consume specific namespaces:
// run.getReadable({ namespace: "logs" })
// run.getReadable({ namespace: "progress" })
```

---

## 7. Workflow Management

**Impact: MEDIUM**

Understanding how to start, monitor, and manage workflow runs is essential for integrating workflows into your application.

### 7.1 Use start() to Trigger Workflows

**Impact: MEDIUM (entry point for workflows)**

Use `start()` from `workflow/api` to trigger workflow execution from API routes or server-side code.

**Example: API route to start workflow**

```typescript
// app/api/orders/process/route.ts
import { start } from "workflow/api";
import { processOrder } from "@/workflows/order";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const { orderId } = await request.json()
  
  // Start workflow and get Run object
  const run = await start(processOrder, [orderId])
  
  return NextResponse.json({
    runId: run.runId,
    message: "Order processing started"
  })
}
```

**start() is non-blocking:** The workflow is enqueued and `start()` returns immediately with a Run object. It does not wait for the workflow to complete.

### 7.2 Use the Run Object for Status and Output

**Impact: MEDIUM (enables monitoring)**

The Run object returned by `start()` provides access to workflow status, output, and streaming data.

**Run object properties:**

```typescript
const run = await start(myWorkflow, [args])

// Run ID for later reference
console.log(run.runId)

// Wait for completion and get return value
const output = await run.returnValue

// Get current status
const status = await run.status  // "pending" | "running" | "completed" | "failed" | "cancelled"

// Access streaming output
const stream = run.readable
// or with options:
const stream = run.getReadable({ namespace: "logs", startIndex: 0 })

// Cancel the workflow
await run.cancel()
```

**Example: polling for status**

```typescript
// app/api/orders/[runId]/status/route.ts
import { getRun } from "workflow/api";
import { NextResponse } from "next/server";

export async function GET(
  request: Request,
  { params }: { params: { runId: string } }
) {
  const run = getRun(params.runId)
  const status = await run.status
  
  const response: any = { status }
  
  if (status === "completed") {
    response.result = await run.returnValue
  }
  
  return NextResponse.json(response)
}
```

### 7.3 Retrieve Existing Runs with getRun()

**Impact: MEDIUM (enables run management)**

Use `getRun()` to retrieve a Run object for an existing workflow run by its ID.

**Example: cancel endpoint**

```typescript
// app/api/orders/[runId]/cancel/route.ts
import { getRun } from "workflow/api";
import { NextResponse } from "next/server";

export async function POST(
  request: Request,
  { params }: { params: { runId: string } }
) {
  const run = getRun(params.runId)
  
  await run.cancel()
  
  return NextResponse.json({
    cancelled: true,
    runId: params.runId
  })
}
```

### 7.4 Use sleep() for Durable Delays

**Impact: MEDIUM (enables timed workflows)**

Use `sleep()` to pause a workflow for a duration without consuming resources. The workflow suspends and resumes automatically.

**Example: delayed notifications**

```typescript
import { sleep } from "workflow";

export async function onboardingWorkflow(userId: string) {
  "use workflow";
  
  const user = await createUser(userId)
  await sendWelcomeEmail(user)
  
  // Wait 1 day
  await sleep("1d")
  await sendDay1Email(user)
  
  // Wait 3 more days
  await sleep("3d")
  await sendDay4Email(user)
  
  // Wait until specific date
  await sleep(new Date('2024-12-25T09:00:00Z'))
  await sendHolidayEmail(user)
  
  return { completed: true }
}
```

**sleep() duration formats:**
- String: `"1s"`, `"5m"`, `"2h"`, `"1d"` (seconds, minutes, hours, days)
- Number: milliseconds
- Date: sleep until specific timestamp

---

## 8. Best Practices

**Impact: MEDIUM**

Following these best practices ensures your workflows are reliable, maintainable, and handle edge cases gracefully.

### 8.1 Make Step Side Effects Idempotent

**Impact: HIGH (prevents duplicate side effects)**

Since steps can retry, side effects must be idempotent—safe to execute multiple times with the same result.

**Incorrect: non-idempotent**

```typescript
async function chargeCustomer(customerId: string, amount: number) {
  "use step";
  
  // BAD: If this step retries, customer gets charged multiple times!
  await stripe.charges.create({
    customer: customerId,
    amount: amount
  })
}
```

**Correct: idempotent with idempotency key**

```typescript
import { getStepMetadata } from "workflow";

async function chargeCustomer(customerId: string, amount: number) {
  "use step";
  
  const { stepId } = getStepMetadata()
  
  // Good: Same stepId = same charge, even on retry
  await stripe.charges.create({
    customer: customerId,
    amount: amount,
    idempotencyKey: stepId
  })
}
```

### 8.2 Use getStepMetadata for Idempotency Keys

**Impact: HIGH (enables safe retries)**

`getStepMetadata()` provides unique identifiers perfect for idempotency keys.

**getStepMetadata() returns:**

```typescript
const {
  stepId,        // Unique identifier for this step execution
  attempt,       // Current attempt number (1-based)
  stepStartedAt  // Timestamp when step began
} = getStepMetadata()
```

**Example: idempotent database insert**

```typescript
import { getStepMetadata } from "workflow";

async function createOrder(items: Item[], userId: string) {
  "use step";
  
  const { stepId } = getStepMetadata()
  
  // Use stepId as unique constraint to prevent duplicates
  const order = await db.orders.upsert({
    where: { idempotencyKey: stepId },
    create: {
      idempotencyKey: stepId,
      userId,
      items,
      status: 'pending'
    },
    update: {}  // No-op if exists
  })
  
  return order
}
```

### 8.3 Implement Compensating Actions for Rollback

**Impact: MEDIUM (handles partial failures)**

For multi-step workflows, implement compensating actions to rollback partial work when later steps fail.

**Example: saga pattern**

```typescript
export async function bookTripWorkflow(tripDetails: TripDetails) {
  "use workflow";
  
  let flightBooking = null
  let hotelBooking = null
  let carBooking = null
  
  try {
    // Step 1: Book flight
    flightBooking = await bookFlight(tripDetails.flight)
    
    // Step 2: Book hotel
    hotelBooking = await bookHotel(tripDetails.hotel)
    
    // Step 3: Book car
    carBooking = await bookCar(tripDetails.car)
    
    return {
      success: true,
      flightBooking,
      hotelBooking,
      carBooking
    }
  } catch (error) {
    // Compensating actions - rollback in reverse order
    if (carBooking) {
      await cancelCarBooking(carBooking.id)
    }
    if (hotelBooking) {
      await cancelHotelBooking(hotelBooking.id)
    }
    if (flightBooking) {
      await cancelFlightBooking(flightBooking.id)
    }
    
    throw error  // Re-throw after cleanup
  }
}

async function cancelFlightBooking(bookingId: string) {
  "use step";
  await flightApi.cancel(bookingId)
}

async function cancelHotelBooking(bookingId: string) {
  "use step";
  await hotelApi.cancel(bookingId)
}

async function cancelCarBooking(bookingId: string) {
  "use step";
  await carApi.cancel(bookingId)
}
```

---

## References

1. [https://useworkflow.dev/docs](https://useworkflow.dev/docs)
2. [https://useworkflow.dev/docs/foundations/workflows-and-steps](https://useworkflow.dev/docs/foundations/workflows-and-steps)
3. [https://useworkflow.dev/docs/foundations/serialization](https://useworkflow.dev/docs/foundations/serialization)
4. [https://useworkflow.dev/docs/foundations/errors-and-retries](https://useworkflow.dev/docs/foundations/errors-and-retries)
5. [https://useworkflow.dev/docs/foundations/hooks](https://useworkflow.dev/docs/foundations/hooks)
6. [https://useworkflow.dev/docs/foundations/streaming](https://useworkflow.dev/docs/foundations/streaming)
7. [https://useworkflow.dev/docs/how-it-works/understanding-directives](https://useworkflow.dev/docs/how-it-works/understanding-directives)
8. [https://useworkflow.dev/docs/how-it-works/code-transform](https://useworkflow.dev/docs/how-it-works/code-transform)
