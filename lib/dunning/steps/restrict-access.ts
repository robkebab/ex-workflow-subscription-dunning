/**
 * Step function to restrict customer access after repeated payment failures.
 *
 * This step marks a customer as access-restricted via the subscription service.
 * It uses the stepId as an idempotency key to ensure safe retries.
 * This is typically triggered after a configurable number of failed payment attempts.
 */
"use step";

import { FatalError, RetryableError, getStepMetadata } from 'workflow';
import {
  mockSubscriptionService,
  type OperationResult,
} from '../providers/subscription';

/**
 * Options for restricting customer access.
 */
export interface RestrictAccessOptions {
  /** Customer ID to restrict */
  customerId: string;
  /** Invoice ID that triggered the restriction (for logging) */
  invoiceId: string;
  /** Subscription ID associated with the customer (for logging) */
  subscriptionId?: string;
}

/**
 * Result of the access restriction operation.
 */
export interface RestrictAccessResult {
  /** Whether the restriction was executed (false if already restricted or deduplicated) */
  executed: boolean;
  /** Customer ID that was restricted */
  customerId: string;
  /** Reason if not executed */
  reason?: 'already_executed' | 'already_in_state';
}

/**
 * Restricts customer access due to payment failures.
 *
 * This operation is idempotent - it's safe to call multiple times.
 * The stepId from workflow metadata is used as the idempotency key
 * to prevent duplicate operations on retries.
 *
 * @param options - Options including customerId and invoiceId for logging
 * @returns Result indicating whether the restriction was executed or was a no-op
 * @throws RetryableError for transient failures (not currently thrown by mock)
 * @throws FatalError for permanent failures (not currently thrown by mock)
 */
export async function restrictCustomerAccess(
  options: RestrictAccessOptions
): Promise<RestrictAccessResult> {
  const metadata = getStepMetadata();

  console.log(
    `[restrictCustomerAccess] customerId=${options.customerId} ` +
    `invoiceId=${options.invoiceId} ` +
    `subscriptionId=${options.subscriptionId ?? 'N/A'} ` +
    `stepId=${metadata.stepId} ` +
    `attempt=${metadata.attempt}`
  );

  try {
    // Use stepId as idempotency key for safe retries
    const result: OperationResult = await mockSubscriptionService.restrictAccess(
      options.customerId,
      metadata.stepId
    );

    console.log(
      `[restrictCustomerAccess] Result: executed=${result.executed} ` +
      `reason=${result.reason ?? 'N/A'}`
    );

    return {
      executed: result.executed,
      customerId: options.customerId,
      reason: result.reason,
    };
  } catch (error) {
    // The mock subscription service doesn't throw errors currently,
    // but we handle them defensively for future-proofing
    console.log(`[restrictCustomerAccess] Unexpected error: ${error}`);

    // For now, treat unexpected errors as fatal since we don't know
    // if they're safe to retry. In production, this would need
    // more nuanced error handling based on error types.
    throw new FatalError(`Failed to restrict access for customer ${options.customerId}: ${error}`);
  }
}
