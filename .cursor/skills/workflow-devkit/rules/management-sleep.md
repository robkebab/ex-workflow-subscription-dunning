# management-sleep

**Impact: MEDIUM (enables timed workflows)**

Use `sleep()` to pause a workflow for a duration without consuming resources. The workflow suspends and resumes automatically.

## Basic Usage

```typescript
import { sleep } from "workflow";

export async function delayedNotification(userId: string) {
  "use workflow";
  
  await sendWelcomeEmail(userId)
  
  // Wait 1 hour
  await sleep("1h")
  
  await sendFollowUpEmail(userId)
}
```

## Duration Formats

```typescript
// String durations
await sleep("1s")   // 1 second
await sleep("30s")  // 30 seconds
await sleep("5m")   // 5 minutes
await sleep("2h")   // 2 hours
await sleep("1d")   // 1 day

// Milliseconds
await sleep(5000)   // 5 seconds

// Until specific time
await sleep(new Date('2024-12-25T09:00:00Z'))
```

## Example: Onboarding Sequence

```typescript
export async function onboardingWorkflow(userId: string) {
  "use workflow";
  
  const user = await createUser(userId)
  await sendWelcomeEmail(user)
  
  // Day 1 follow-up
  await sleep("1d")
  await sendDay1Email(user)
  
  // Day 3 follow-up
  await sleep("2d")  // 2 more days
  await sendDay3Email(user)
  
  // Week 1 check-in
  await sleep("4d")  // 4 more days (total 7)
  await sendWeeklyEmail(user)
  
  return { completed: true }
}
```

## Example: Scheduled Task

```typescript
export async function scheduledReport() {
  "use workflow";
  
  // Run every day at 9 AM
  while (true) {
    await generateDailyReport()
    await sendReportEmail()
    
    // Sleep until tomorrow 9 AM
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(9, 0, 0, 0)
    
    await sleep(tomorrow)
  }
}
```

## Key Points

- `sleep()` is durable: survives server restarts
- No resources consumed during sleep
- Works with loops for recurring tasks
- Exact timing depends on when workflow resumes
