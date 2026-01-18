# streaming-release-locks

**Impact: HIGH (prevents resource leaks)**

After writing to a stream, always release the writer lock. Unreleased locks can cause steps to hang and resources to leak.

## Incorrect: Lock Not Released

```typescript
async function badWrite(data: string) {
  "use step";
  
  const writable = getWritable()
  const writer = writable.getWriter()
  
  await writer.write(data)
  // BAD: Lock not released - step may hang
}
```

## Incorrect: Error Leaves Lock Held

```typescript
async function stillBad(data: string) {
  "use step";
  
  const writable = getWritable()
  const writer = writable.getWriter()
  
  await writer.write(data)
  // If write() throws, lock is never released
  writer.releaseLock()
}
```

## Correct: Always Release in Finally

```typescript
async function goodWrite(data: string) {
  "use step";
  
  const writable = getWritable()
  const writer = writable.getWriter()
  
  try {
    await writer.write(data)
  } finally {
    writer.releaseLock()  // Always runs
  }
}
```

## Correct: Multiple Writes

```typescript
async function writeMultiple(messages: string[]) {
  "use step";
  
  const writable = getWritable()
  const writer = writable.getWriter()
  
  try {
    for (const message of messages) {
      await writer.write(message)
    }
  } finally {
    writer.releaseLock()
  }
}
```

## Pattern: Reusable Write Helper

```typescript
async function safeWrite<T>(data: T, namespace?: string) {
  "use step";
  
  const writable = getWritable(namespace ? { namespace } : undefined)
  const writer = writable.getWriter()
  
  try {
    await writer.write(data)
  } finally {
    writer.releaseLock()
  }
}

// Usage in workflow
export async function workflow() {
  "use workflow";
  
  await safeWrite({ progress: 0 }, 'status')
  await doWork()
  await safeWrite({ progress: 100 }, 'status')
}
```
