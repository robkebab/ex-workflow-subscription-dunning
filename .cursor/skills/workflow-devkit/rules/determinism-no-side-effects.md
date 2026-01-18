# determinism-no-side-effects

**Impact: CRITICAL (breaks replay)**

Workflow functions run in a sandboxed environment. All side effects (I/O, external calls) must go through step functions to maintain determinism.

## Incorrect

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

Direct I/O breaks determinism because:
- Results aren't cached for replay
- Operations may execute multiple times on retry
- Sandbox doesn't have access to Node.js APIs

## Correct

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

With side effects in steps:
- Results are cached for deterministic replay
- Automatic retry support
- Full Node.js access where needed
