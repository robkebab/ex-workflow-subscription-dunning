# Step Error Handling Specification

This document specifies error handling patterns for step functions.

## Overview

Step functions support automatic retries with configurable behavior. Proper error handling ensures reliability without wasted retries on permanent failures.

## Error Types

### RetryableError

Use `RetryableError` for transient failures that may resolve with time:
- Rate limiting (429)
- Server errors (5xx)
- Network timeouts
- Temporary service unavailability

```typescript
import { RetryableError } from "workflow";

async function callExternalAPI(endpoint: string) {
  "use step";
  
  const response = await fetch(endpoint);
  
  if (response.status === 429) {
    const retryAfter = response.headers.get('Retry-After') || '60';
    throw new RetryableError('Rate limited', {
      retryAfter: `${retryAfter}s`
    });
  }
  
  if (response.status >= 500) {
    throw new RetryableError(`Server error: ${response.status}`, {
      retryAfter: 5000  // 5 seconds
    });
  }
  
  return response.json();
}
```

### FatalError

Use `FatalError` for permanent failures that won't resolve with retries:
- Validation errors
- Resource not found (404)
- Authorization failures (401, 403)
- Invalid input
- Business rule violations

```typescript
import { FatalError } from "workflow";

async function getInvoice(invoiceId: string) {
  "use step";
  
  const response = await fetch(`/api/invoices/${invoiceId}`);
  
  if (response.status === 404) {
    throw new FatalError(`Invoice not found: ${invoiceId}`);
  }
  
  if (response.status === 403) {
    throw new FatalError('Not authorized to access this invoice');
  }
  
  return response.json();
}
```

## Retry Configuration

### maxRetries Property

Configure retry count per step function:

```typescript
async function checkInvoiceStatus(invoiceId: string) {
  "use step";
  // ... implementation
}

// Allow more retries for critical operations
checkInvoiceStatus.maxRetries = 5;

async function sendNotification(message: string) {
  "use step";
  // ... implementation
}

// Fewer retries for non-critical operations
sendNotification.maxRetries = 2;
```

### Recommended maxRetries Values

| Operation Type | Recommended maxRetries |
|---------------|------------------------|
| Payment/billing operations | 5-10 |
| Email sending | 3 |
| Status checks | 5 |
| Access restriction | 3 |
| Final actions (cancel/pause) | 5 |

## Exponential Backoff

Use `getStepMetadata()` to implement exponential backoff:

```typescript
import { RetryableError, getStepMetadata } from "workflow";

async function callExternalService(endpoint: string) {
  "use step";
  
  const { attempt } = getStepMetadata();
  
  const response = await fetch(endpoint);
  
  if (!response.ok) {
    if (response.status >= 500) {
      // Exponential backoff: 1s, 4s, 9s, 16s, 25s... (capped at 60s)
      const delay = Math.min((attempt ** 2) * 1000, 60000);
      throw new RetryableError(`Server error: ${response.status}`, {
        retryAfter: delay
      });
    }
    
    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      throw new RetryableError('Rate limited', {
        retryAfter: retryAfter ? `${retryAfter}s` : '60s'
      });
    }
    
    // Client errors - don't retry
    throw new FatalError(`Client error: ${response.status}`);
  }
  
  return response.json();
}

callExternalService.maxRetries = 5;
```

## Application Step Functions

### check-invoice-status.ts

```typescript
import { FatalError, RetryableError, getStepMetadata } from 'workflow';

export async function checkInvoiceStatus(invoiceId: string): Promise<InvoiceState> {
  "use step";
  
  const { attempt } = getStepMetadata();
  
  try {
    const invoice = await mockStripe.getInvoice(invoiceId);
    return invoice;
  } catch (error) {
    if (error instanceof InvoiceNotFoundError) {
      throw new FatalError(`Invoice not found: ${invoiceId}`);
    }
    
    if (error instanceof RateLimitError) {
      throw new RetryableError('Rate limited', {
        retryAfter: error.retryAfterMs,
      });
    }
    
    // Exponential backoff for transient errors
    const delay = Math.min((attempt ** 2) * 1000, 60000);
    throw new RetryableError(`Transient error: ${error}`, {
      retryAfter: delay,
    });
  }
}

checkInvoiceStatus.maxRetries = 5;
```

### send-dunning-email.ts

```typescript
export async function sendDunningEmail(options: SendDunningEmailOptions): Promise<SendDunningEmailResult> {
  "use step";
  
  const { stepId, attempt } = getStepMetadata();
  
  try {
    const result = await mockEmailService.sendEmail({
      // ... options
      idempotencyKey: stepId,
    });
    return result;
  } catch (error) {
    if (error instanceof EmailTransientError) {
      const delay = Math.min((attempt ** 2) * 1000, 30000);
      throw new RetryableError('Email service unavailable', {
        retryAfter: delay,
      });
    }
    
    throw new FatalError(`Failed to send email: ${error}`);
  }
}

sendDunningEmail.maxRetries = 3;
```

## Verification Checklist

- [ ] All step functions have `maxRetries` configured
- [ ] `FatalError` used for permanent failures (404, 401, 403, validation)
- [ ] `RetryableError` used for transient failures (429, 5xx, network)
- [ ] Exponential backoff implemented using `getStepMetadata().attempt`
- [ ] Rate limit headers respected (`Retry-After`)
