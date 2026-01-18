# streaming-write-in-steps

**Impact: CRITICAL (determinism requirement)**

Stream operations must happen in step functions, not workflow context. This ensures deterministic replay.

## Incorrect: Writing in Workflow

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

## Correct: Writing in Step

```typescript
import { getWritable } from "workflow";

async function writeProgress(message: string) {
  "use step";
  
  const writable = getWritable()
  const writer = writable.getWriter()
  
  try {
    await writer.write(message)
  } finally {
    writer.releaseLock()
  }
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

## Pattern: Progress Updates

```typescript
async function updateProgress(percent: number, message: string) {
  "use step";
  
  const writable = getWritable()
  const writer = writable.getWriter()
  
  try {
    await writer.write({ percent, message, timestamp: new Date() })
  } finally {
    writer.releaseLock()
  }
}

export async function processingWorkflow(items: Item[]) {
  "use workflow";
  
  await updateProgress(0, 'Starting')
  
  for (let i = 0; i < items.length; i++) {
    await processItem(items[i])
    await updateProgress(
      Math.round((i + 1) / items.length * 100),
      `Processed ${i + 1} of ${items.length}`
    )
  }
  
  await updateProgress(100, 'Complete')
}
```

## Client Consumption

```typescript
const run = await start(processingWorkflow, [items])

// Read streamed progress
for await (const update of run.readable) {
  console.log(`${update.percent}%: ${update.message}`)
}
```
