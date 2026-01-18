# serialization-supported-types

**Impact: HIGH (runtime requirement)**

Only serializable types can be passed across workflow/step boundaries. The system uses `devalue`-based serialization.

## Supported Types

### Standard JSON Types
- `string`
- `number`
- `boolean`
- `null`
- Arrays of serializable values
- Plain objects with string keys

### Extended Types
- `undefined`
- `bigint`
- `Date`
- `RegExp`

### Binary Types
- `ArrayBuffer`
- `Uint8Array`, `Int8Array`
- `Uint16Array`, `Int16Array`
- `Uint32Array`, `Int32Array`
- `Float32Array`, `Float64Array`
- `BigInt64Array`, `BigUint64Array`

### Collection Types
- `Map<Serializable, Serializable>`
- `Set<Serializable>`

### Web Types
- `URL`
- `URLSearchParams`
- `Headers`
- `Request`
- `Response`
- `ReadableStream<Serializable>`
- `WritableStream<Serializable>`

## NOT Supported

- Functions and closures
- Class instances (without custom serialization)
- Symbols
- WeakMap, WeakSet

## Incorrect: Non-Serializable Types

```typescript
async function badStep(callback: () => void) {
  "use step";
  // Functions cannot be serialized
  callback()
}

class MyService {
  async process() { /* ... */ }
}

async function alsoBad(service: MyService) {
  "use step";
  // Class instances are not serializable
  await service.process()
}
```

## Correct: Use Serializable Data

```typescript
async function goodStep(config: { url: string; timeout: number }) {
  "use step";
  // Plain objects with primitives work fine
  return await fetch(config.url, { timeout: config.timeout })
}

export async function workflow() {
  "use workflow";
  
  // Pass data, not behavior
  const result = await goodStep({
    url: 'https://api.example.com',
    timeout: 5000
  })
}
```
