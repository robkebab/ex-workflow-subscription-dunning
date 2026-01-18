# management-run-object

**Impact: MEDIUM (enables monitoring)**

The Run object returned by `start()` provides methods to monitor, control, and get output from a running workflow.

## Run Object Properties and Methods

```typescript
const run = await start(myWorkflow, [args])

// Unique identifier for this run
run.runId  // string

// Wait for completion and get return value (blocks)
const result = await run.returnValue

// Get current status (blocks until status is known)
const status = await run.status
// "pending" | "running" | "completed" | "failed" | "cancelled"

// Access default readable stream
const stream = run.readable

// Access stream with options
const stream = run.getReadable({
  namespace: "logs",
  startIndex: 0  // Resume from specific chunk
})

// Cancel the workflow
await run.cancel()
```

## Example: Wait for Result

```typescript
export async function POST(request: Request) {
  const { orderId } = await request.json()
  
  const run = await start(processOrder, [orderId])
  
  // Wait for workflow to complete
  const result = await run.returnValue
  
  return NextResponse.json({ result })
}
```

## Example: Fire and Poll

```typescript
// Start endpoint
export async function POST(request: Request) {
  const { data } = await request.json()
  
  const run = await start(longRunningProcess, [data])
  
  return NextResponse.json({ runId: run.runId })
}

// Status endpoint
export async function GET(
  request: Request,
  { params }: { params: { runId: string } }
) {
  const run = getRun(params.runId)
  const status = await run.status
  
  if (status === "completed") {
    return NextResponse.json({
      status,
      result: await run.returnValue
    })
  }
  
  return NextResponse.json({ status })
}
```

## Example: Stream Progress

```typescript
// Server-sent events endpoint
export async function GET(
  request: Request,
  { params }: { params: { runId: string } }
) {
  const run = getRun(params.runId)
  const stream = run.getReadable({ namespace: "progress" })
  
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  })
}
```
