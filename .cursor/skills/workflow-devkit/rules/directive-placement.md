# directive-placement

**Impact: CRITICAL (compiler requirement)**

Place directives as the first statement inside the function body, not at file level or as comments.

## Incorrect: Directive at File Level

```typescript
"use workflow";

export async function myWorkflow() {
  // This won't work - directive is at file level
  await doSomething()
}
```

## Incorrect: Directive as Comment

```typescript
export async function myWorkflow() {
  // "use workflow"
  await doSomething()
}
```

## Incorrect: Directive After Code

```typescript
export async function myWorkflow() {
  const x = 1
  "use workflow";  // Too late - must be first statement
  await doSomething()
}
```

## Correct

```typescript
export async function myWorkflow() {
  "use workflow";
  
  await doSomething()
}

async function myStep() {
  "use step";
  
  return await fetchData()
}
```

The directive must be a string literal as the first statement in the function body.
