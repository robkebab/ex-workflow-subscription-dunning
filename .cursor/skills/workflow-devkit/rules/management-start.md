# management-start

**Impact: MEDIUM (entry point for workflows)**

Use `start()` from `workflow/api` to trigger workflow execution. This is the primary way to initiate workflows from API routes.

## Basic Usage

```typescript
import { start } from "workflow/api";
import { processOrder } from "@/workflows/order";

// Start workflow
const run = await start(processOrder, [orderId])
```

## API Route Example

```typescript
// app/api/orders/process/route.ts
import { start } from "workflow/api";
import { processOrder } from "@/workflows/order";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const { orderId } = await request.json()
  
  const run = await start(processOrder, [orderId])
  
  return NextResponse.json({
    runId: run.runId,
    message: "Order processing started"
  })
}
```

## Key Points

- `start()` is **non-blocking**: returns immediately after enqueueing
- Returns a `Run` object for monitoring/controlling the workflow
- Does NOT wait for workflow completion

## Run Object

```typescript
const run = await start(myWorkflow, [args])

// Unique identifier
run.runId

// Wait for completion and get result
const result = await run.returnValue

// Get current status
const status = await run.status
// "pending" | "running" | "completed" | "failed" | "cancelled"

// Access streaming output
const stream = run.readable

// Cancel the workflow
await run.cancel()
```

## Multiple Arguments

```typescript
export async function processPayment(orderId: string, amount: number) {
  "use workflow";
  // ...
}

// Pass arguments as array
const run = await start(processPayment, [orderId, 99.99])
```

## Fire-and-Forget Pattern

```typescript
export async function POST(request: Request) {
  const { data } = await request.json()
  
  // Start and don't wait
  await start(backgroundProcess, [data])
  
  return NextResponse.json({ status: "processing" })
}
```
