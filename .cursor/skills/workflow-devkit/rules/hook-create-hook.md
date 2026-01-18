# hook-create-hook

**Impact: MEDIUM-HIGH (enables external event handling)**

Use `createHook()` to suspend a workflow until external code sends data via `resumeHook()`. Ideal for human-in-the-loop workflows and arbitrary event handling.

## Basic Usage

```typescript
import { createHook } from "workflow";

export async function approvalWorkflow(requestId: string) {
  "use workflow";
  
  const request = await fetchRequest(requestId)
  await notifyApprovers(request)
  
  // Create hook
  const hook = createHook<{ approved: boolean; comment: string }>()
  
  // Store token for external use
  await saveApprovalToken(requestId, hook.token)
  
  // Workflow suspends here
  const decision = await hook
  
  if (decision.approved) {
    await processApproval(request)
  } else {
    await processRejection(request, decision.comment)
  }
  
  return decision
}
```

## Hook Properties

```typescript
const hook = createHook<PayloadType>({
  token: 'custom-token',  // Optional custom token
  metadata: { ... }       // Optional metadata
})

// Token for resumption
console.log(hook.token)

// Wait for single payload
const payload = await hook

// For multiple payloads (async iteration)
for await (const payload of hook) {
  // Handle each incoming payload
}
```

## API Route to Resume

```typescript
// app/api/approve/[requestId]/route.ts
import { resumeHook } from "workflow/api";
import { NextResponse } from "next/server";

export async function POST(
  request: Request,
  { params }: { params: { requestId: string } }
) {
  const { approved, comment } = await request.json()
  const token = await getApprovalToken(params.requestId)
  
  // Resume the workflow
  await resumeHook(token, { approved, comment })
  
  return NextResponse.json({ success: true })
}
```

## Difference from createWebhook

| Feature | createHook | createWebhook |
|---------|------------|---------------|
| Payload source | Any serializable data | HTTP Request object |
| Resume method | `resumeHook(token, data)` | HTTP request to URL |
| Use case | Internal systems, programmatic | External webhooks, callbacks |
| URL generated | No | Yes |
