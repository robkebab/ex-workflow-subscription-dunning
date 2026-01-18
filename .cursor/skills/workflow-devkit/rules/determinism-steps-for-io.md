# determinism-steps-for-io

**Impact: CRITICAL (sandbox restriction)**

All I/O operations must happen in step functions, never directly in workflow functions.

## What CAN Happen in Workflows

- Control flow (if/else, loops, try/catch)
- Calling step functions
- Using workflow primitives (sleep, createHook, createWebhook)
- Basic computation on cached/serialized data
- Awaiting Promises from step functions

## What MUST Happen in Steps

- HTTP requests (fetch, axios, etc.)
- Database operations (queries, mutations)
- File system access (read, write, delete)
- External API calls
- Sending emails/notifications
- Generating random values (UUIDs, etc.)
- Any other I/O or side effects

## Incorrect

```typescript
export async function processOrder(orderId: string) {
  "use workflow";
  
  // BAD: All of these should be in steps
  const order = await db.orders.findUnique({ where: { id: orderId } })
  const receipt = await generatePDF(order)
  await sendEmail(order.customerEmail, receipt)
  await fs.writeFile(`receipts/${orderId}.pdf`, receipt)
}
```

## Correct

```typescript
async function getOrder(orderId: string) {
  "use step";
  return await db.orders.findUnique({ where: { id: orderId } })
}

async function generateReceipt(order: Order) {
  "use step";
  return await generatePDF(order)
}

async function emailReceipt(email: string, receipt: Buffer) {
  "use step";
  await sendEmail(email, receipt)
}

async function saveReceipt(orderId: string, receipt: Buffer) {
  "use step";
  await fs.writeFile(`receipts/${orderId}.pdf`, receipt)
}

export async function processOrder(orderId: string) {
  "use workflow";
  
  const order = await getOrder(orderId)
  const receipt = await generateReceipt(order)
  await emailReceipt(order.customerEmail, receipt)
  await saveReceipt(orderId, receipt)
}
```
