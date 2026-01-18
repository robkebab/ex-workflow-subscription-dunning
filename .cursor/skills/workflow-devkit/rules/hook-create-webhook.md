# hook-create-webhook

**Impact: MEDIUM-HIGH (enables HTTP callbacks)**

Use `createWebhook()` to suspend a workflow until an external HTTP request arrives. Ideal for payment callbacks, OAuth flows, and third-party integrations.

## Basic Usage

```typescript
import { createWebhook } from "workflow";

export async function paymentWorkflow(orderId: string) {
  "use workflow";
  
  const order = await getOrder(orderId)
  
  // Create webhook URL
  const webhook = createWebhook({
    token: `payment:${orderId}`,
    respondWith: "manual"
  })
  
  // Pass URL to payment provider
  await initiatePayment(order, webhook.url)
  
  // Workflow suspends here
  const request = await webhook
  
  // Process callback
  const payload = await request.json()
  
  // Send response to payment provider
  await request.respondWith(
    new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  )
  
  return { orderId, status: payload.status }
}
```

## Webhook Options

```typescript
const webhook = createWebhook({
  // Custom token for deterministic URLs
  token: `webhook:${uniqueId}`,
  
  // "manual" requires explicit respondWith() call
  // Without this, default 202 Accepted is sent
  respondWith: "manual"
})
```

## Webhook Properties

```typescript
const webhook = createWebhook()

// URL to share with external systems
console.log(webhook.url)

// Token identifier
console.log(webhook.token)

// Wait for request
const request = await webhook

// For multiple requests
for await (const req of webhook) {
  // Handle each incoming request
}
```

## Responding to Webhooks

```typescript
// With respondWith: "manual"
const request = await webhook
const body = await request.json()

// Must send response explicitly
await request.respondWith(
  new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })
)
```

## API Route to Forward Webhooks

```typescript
// app/api/webhooks/payment/route.ts
import { resumeWebhook } from "workflow/api";

export async function POST(request: Request) {
  const orderId = request.headers.get('x-order-id')
  
  // Resume workflow with incoming request
  const response = await resumeWebhook(
    `payment:${orderId}`,
    request
  )
  
  return response
}
```
