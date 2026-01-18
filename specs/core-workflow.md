# Core Workflow

Implement the main subscription dunning workflow orchestration using Workflow DevKit.

## Job to Be Done

Orchestrate the dunning process: send notifications, wait for customer action or timeout, escalate, and execute final action if payment not recovered.

## Workflow Behavior

### Initialization
- Merge input config with defaults
- Create webhook with deterministic token: `dunning:${invoiceId}`
- Send initial dunning email with webhook URL

### Retry Loop
- For each attempt up to `maxAttempts`:
  - `Promise.race([webhook, sleep(delay)])` - race customer action vs timeout
  - After race resolves, check invoice status
  - If paid: return `{ outcome: 'recovered' }`
  - If not paid and more attempts remain: send escalating email
  - If at `restrictAccessAfterAttempt`: restrict customer access

### Exhaustion
- When all attempts exhausted without recovery:
  - Execute final action (pause subscription)
  - Return `{ outcome: 'exhausted', finalAction }`

## Workflow DevKit Patterns

- `"use workflow"` directive at function start
- `createWebhook({ token })` for deterministic webhook URLs
- `sleep(delay)` for durable delays (multi-day without consuming resources)
- `Promise.race()` for racing customer action vs timeout
- Webhook URL included in email as customer "fix payment" link

## Key Behaviors

- Webhook token is deterministic per invoice (idempotent across restarts)
- Each delay uses durable sleep (survives process restarts)
- Email escalation increases urgency with each attempt
- Access restriction triggers at configured threshold
- Final action only executes after all attempts exhausted

## Acceptance Criteria

- [ ] Workflow uses `"use workflow"` directive
- [ ] Webhook created with deterministic token
- [ ] Promise.race correctly races webhook vs sleep
- [ ] Invoice status checked after each wait
- [ ] Returns `recovered` when invoice paid mid-dunning
- [ ] Returns `exhausted` with final action after all attempts
- [ ] Access restriction triggers at correct attempt
- [ ] Test demonstrates full happy path (recovery)
- [ ] Test demonstrates exhaustion path
