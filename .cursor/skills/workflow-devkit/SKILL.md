---
name: workflow-devkit
description: Comprehensive guide for building durable workflows with Vercel's Workflow DevKit. This skill should be used when writing, reviewing, or refactoring workflow code. Triggers on tasks involving "use workflow", "use step" directives, durable execution, retries, webhooks, or long-running background tasks.
license: MIT
metadata:
  author: vercel
  version: "1.0.0"
---

# Workflow DevKit Best Practices

Comprehensive guide for building durable, observable workflows with Vercel's Workflow DevKit. Contains 25+ rules across 8 categories, prioritized by impact to guide automated code generation and refactoring.

## When to Apply

Reference these guidelines when:
- Writing new workflow or step functions
- Implementing retry logic and error handling
- Working with webhooks and external events
- Managing streaming output from workflows
- Debugging workflow replay issues
- Integrating workflows with Next.js applications

## Rule Categories by Priority

| Priority | Category | Impact | Prefix |
|----------|----------|--------|--------|
| 1 | Directives & Structure | CRITICAL | `directive-` |
| 2 | Determinism | CRITICAL | `determinism-` |
| 3 | Serialization | HIGH | `serialization-` |
| 4 | Error Handling & Retries | HIGH | `error-` |
| 5 | Hooks & Webhooks | MEDIUM-HIGH | `hook-` |
| 6 | Streaming | MEDIUM | `streaming-` |
| 7 | Workflow Management | MEDIUM | `management-` |
| 8 | Best Practices | MEDIUM | `practice-` |

## Quick Reference

### 1. Directives & Structure (CRITICAL)

- `directive-use-workflow` - Mark orchestration functions with "use workflow"
- `directive-use-step` - Mark side-effect functions with "use step"
- `directive-placement` - Place directives inside function body, not file top
- `directive-async-required` - Workflow and step functions must be async

### 2. Determinism (CRITICAL)

- `determinism-no-side-effects` - No direct side effects in workflow functions
- `determinism-no-random` - Avoid Math.random() outside sandbox-provided values
- `determinism-no-date` - Avoid Date outside sandbox-provided values
- `determinism-steps-for-io` - All I/O must happen in step functions

### 3. Serialization (HIGH)

- `serialization-supported-types` - Use only serializable types across boundaries
- `serialization-pass-by-value` - Data is copied, not referenced, between boundaries
- `serialization-return-mutations` - Return modified data from steps, don't mutate params

### 4. Error Handling & Retries (HIGH)

- `error-default-retries` - Understand default 3 retry behavior
- `error-retryable-error` - Use RetryableError for custom retry delays
- `error-fatal-error` - Use FatalError to skip retries on permanent failures
- `error-max-retries` - Configure maxRetries on step functions
- `error-exponential-backoff` - Implement exponential backoff with getStepMetadata

### 5. Hooks & Webhooks (MEDIUM-HIGH)

- `hook-create-hook` - Use createHook for arbitrary payload suspension
- `hook-create-webhook` - Use createWebhook for HTTP-triggered resumption
- `hook-resume-external` - Resume hooks/webhooks from API routes

### 6. Streaming (MEDIUM)

- `streaming-write-in-steps` - Only write to streams inside step functions
- `streaming-release-locks` - Always release writer locks after writing
- `streaming-close-streams` - Explicitly close streams when done
- `streaming-namespaces` - Use namespaced streams for separate channels

### 7. Workflow Management (MEDIUM)

- `management-start` - Use start() to trigger workflows from API routes
- `management-run-object` - Use Run object for status, output, cancellation
- `management-get-run` - Retrieve existing runs with getRun()

### 8. Best Practices (MEDIUM)

- `practice-idempotency` - Make step side effects idempotent
- `practice-step-metadata` - Use getStepMetadata for idempotency keys
- `practice-compensating-actions` - Implement rollback patterns for failures

## How to Use

Read individual rule files for detailed explanations and code examples:

```
rules/directive-use-workflow.md
rules/determinism-no-side-effects.md
rules/_sections.md
```

Each rule file contains:
- Brief explanation of why it matters
- Incorrect code example with explanation
- Correct code example with explanation
- Additional context and references

## Full Compiled Document

For the complete guide with all rules expanded: `AGENTS.md`
