/**
 * Step function to check invoice payment status.
 *
 * This step fetches the current invoice state from the billing provider (Stripe).
 * It handles transient failures with RetryableError and permanent failures with FatalError.
 * The step is idempotent - calling it multiple times with the same invoice ID is safe.
 */
import { FatalError, RetryableError, getStepMetadata } from 'workflow';
import type { InvoiceState } from '../types';
import {
  mockStripe,
  InvoiceNotFoundError,
  RateLimitError,
  TransientError,
} from '../providers/stripe';

/**
 * Fetches the current state of an invoice from the billing provider.
 *
 * @param invoiceId - The ID of the invoice to check
 * @returns The current invoice state including payment status
 * @throws FatalError if the invoice is not found (404)
 * @throws RetryableError for transient failures (5xx, rate limits, network errors)
 */
export async function checkInvoiceStatus(invoiceId: string): Promise<InvoiceState> {
  "use step";

  const metadata = getStepMetadata();
  console.log(`[checkInvoiceStatus] invoiceId=${invoiceId} stepId=${metadata.stepId} attempt=${metadata.attempt}`);

  try {
    const invoice = await mockStripe.getInvoice(invoiceId);
    console.log(`[checkInvoiceStatus] Invoice ${invoiceId} status: ${invoice.status}`);
    return invoice;
  } catch (error) {
    // Invoice not found - this is a permanent failure
    if (error instanceof InvoiceNotFoundError) {
      console.log(`[checkInvoiceStatus] Invoice ${invoiceId} not found - throwing FatalError`);
      throw new FatalError(`Invoice not found: ${invoiceId}`);
    }

    // Rate limit - retry after the suggested delay
    if (error instanceof RateLimitError) {
      console.log(`[checkInvoiceStatus] Rate limited - retrying after ${error.retryAfterMs}ms`);
      throw new RetryableError(`Rate limited while checking invoice ${invoiceId}`, {
        retryAfter: error.retryAfterMs,
      });
    }

    // Transient server error - retry with exponential backoff
    if (error instanceof TransientError) {
      // Exponential backoff: 1s, 4s, 9s, 16s, 25s... capped at 60s
      const delay = Math.min((metadata.attempt ** 2) * 1000, 60000);
      console.log(`[checkInvoiceStatus] Transient error - retrying after ${delay}ms (attempt ${metadata.attempt})`);
      throw new RetryableError(`Transient error while checking invoice ${invoiceId}`, {
        retryAfter: delay,
      });
    }

    // Unknown error - treat as transient and allow retry with exponential backoff
    const delay = Math.min((metadata.attempt ** 2) * 1000, 60000);
    console.log(`[checkInvoiceStatus] Unknown error: ${error} - treating as retryable (attempt ${metadata.attempt})`);
    throw new RetryableError(`Failed to check invoice ${invoiceId}: ${error}`, {
      retryAfter: delay,
    });
  }
}

// Configure maximum retries for this step function.
// Status checks are critical operations that should have multiple retry attempts
// to handle transient failures like rate limits or temporary service outages.
checkInvoiceStatus.maxRetries = 5;
