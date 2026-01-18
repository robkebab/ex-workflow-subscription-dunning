# Workflow API Routes Specification

This document specifies how to properly trigger and manage workflows from API routes.

## Overview

Workflows must be triggered using `start()` from `workflow/api` to enable:
- Durable execution across server restarts
- Observable execution via dashboard
- Proper Run management (status, output, cancellation)

## Critical Requirements

### Use `start()` to Trigger Workflows

#### Incorrect (Current Implementation)

```typescript
// app/api/dunning/start/route.ts
import { dunningWorkflow } from '@/lib/dunning/workflow';

export async function POST(request: NextRequest) {
  // WRONG: Direct function call bypasses workflow runtime
  dunningWorkflow(workflowInput)
    .then((result) => { /* ... */ })
    .catch((error) => { /* ... */ });
  
  // WRONG: Manual runId generation
  const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  
  return NextResponse.json({ runId });
}
```

#### Correct

```typescript
// app/api/dunning/start/route.ts
import { start } from "workflow/api";
import { dunningWorkflow } from '@/lib/dunning/workflow';

export async function POST(request: NextRequest) {
  const { invoiceId, customerId, subscriptionId, config } = await request.json();
  
  const workflowInput: DunningWorkflowInput = {
    provider: 'stripe',
    invoiceId,
    customerId,
    subscriptionId,
    config,
  };
  
  // CORRECT: Use start() to trigger workflow
  const run = await start(dunningWorkflow, [workflowInput]);
  
  return NextResponse.json({
    success: true,
    runId: run.runId,  // Use the runtime-provided runId
    invoiceId,
  });
}
```

### Stripe Webhook Handler

```typescript
// app/api/webhooks/stripe/route.ts
import { start } from "workflow/api";
import { dunningWorkflow } from '@/lib/dunning/workflow';

export async function POST(request: NextRequest) {
  const event = await request.json();
  
  if (event.type !== 'invoice.payment_failed') {
    return NextResponse.json({ received: true, processed: false });
  }
  
  // Idempotency check (optional - workflow can handle this too)
  if (dunningStore.hasProcessedEvent(event.id)) {
    return NextResponse.json({ received: true, processed: false, reason: 'duplicate' });
  }
  dunningStore.markEventProcessed(event.id);
  
  const workflowInput: DunningWorkflowInput = {
    provider: 'stripe',
    invoiceId: event.data.object.id,
    customerId: event.data.object.customer,
    subscriptionId: event.data.object.subscription || '',
  };
  
  // Start workflow via runtime
  const run = await start(dunningWorkflow, [workflowInput]);
  
  return NextResponse.json({
    received: true,
    processed: true,
    runId: run.runId,
  });
}
```

## Run Object Usage

The `start()` function returns a Run object with useful properties:

```typescript
const run = await start(dunningWorkflow, [input]);

// Get the run ID
console.log(run.runId);

// Wait for completion (if needed)
const result = await run.returnValue;

// Check status
const status = await run.status;  // "pending" | "running" | "completed" | "failed" | "cancelled"

// Cancel if needed
await run.cancel();
```

### Status Endpoint

```typescript
// app/api/dunning/[invoiceId]/route.ts
import { getRun } from "workflow/api";

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { invoiceId } = await params;
  
  // Option 1: If you stored the runId
  const runId = await getRunIdForInvoice(invoiceId);
  const run = getRun(runId);
  const status = await run.status;
  
  // Option 2: If workflow is ongoing, you can check returnValue
  if (status === "completed") {
    const result = await run.returnValue;
    return NextResponse.json({ status, result });
  }
  
  return NextResponse.json({ status });
}
```

## When to Await vs Fire-and-Forget

### Fire-and-Forget (Webhook Handlers)

For webhook handlers, start the workflow and return immediately:

```typescript
export async function POST(request: NextRequest) {
  const run = await start(dunningWorkflow, [input]);
  
  // Return immediately - workflow runs in background
  return NextResponse.json({ runId: run.runId });
}
```

### Await Result (Synchronous API)

For APIs that need the result:

```typescript
export async function POST(request: NextRequest) {
  const run = await start(processOrder, [orderId]);
  
  // Wait for completion
  const result = await run.returnValue;
  
  return NextResponse.json({ result });
}
```

## Verification Checklist

- [ ] Import `start` from `"workflow/api"` in API routes
- [ ] Call `start(workflowFunction, [args])` instead of `workflowFunction(args)`
- [ ] Use `run.runId` instead of generating manual IDs
- [ ] Remove manual workflow state tracking (use Run object instead)
- [ ] Use `getRun()` for status checks on existing runs
