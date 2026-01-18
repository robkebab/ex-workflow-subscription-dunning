# serialization-pass-by-value

**Impact: HIGH (prevents bugs)**

Data passed between workflows and steps is serialized and deserialized—passed by value, not reference. Mutations inside a step don't affect the workflow's copy.

## Incorrect: Expecting Mutation to Propagate

```typescript
async function updateInPlace(user: { name: string }) {
  "use step";
  
  // This mutation won't be seen by the workflow!
  user.name = "Updated"
}

export async function workflow() {
  "use workflow";
  
  const user = { name: "Original" }
  await updateInPlace(user)
  
  // user.name is still "Original" - mutation didn't propagate
  console.log(user.name)  // "Original"
}
```

## Correct: Return Modified Value

```typescript
async function updateUser(user: { name: string }) {
  "use step";
  
  // Return the modified value
  return { ...user, name: "Updated" }
}

export async function workflow() {
  "use workflow";
  
  const user = { name: "Original" }
  const updatedUser = await updateUser(user)
  
  console.log(updatedUser.name)  // "Updated"
}
```

## Pattern: Transform and Return

```typescript
async function enrichUser(user: User) {
  "use step";
  
  const profile = await fetchProfile(user.id)
  const permissions = await fetchPermissions(user.id)
  
  // Return enriched object
  return {
    ...user,
    profile,
    permissions,
    enrichedAt: new Date()
  }
}

export async function onboardUser(userId: string) {
  "use workflow";
  
  let user = await fetchUser(userId)
  user = await enrichUser(user)       // Replace with enriched version
  user = await validateUser(user)     // Replace with validated version
  await saveUser(user)
  
  return user
}
```

## Key Point

Always return any modified data that the workflow needs. Don't rely on parameter mutation.
