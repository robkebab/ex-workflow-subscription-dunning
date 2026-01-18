/**
 * Step function to execute the final action after all dunning attempts are exhausted.
 *
 * This step executes the configured final action (pause, cancel, or mark_unpaid)
 * via the subscription service. It uses the stepId as an idempotency key to
 * ensure safe retries.
 *
 * Final actions:
 * - pause: Pauses the subscription, allowing for easier recovery if customer pays later
 * - cancel: Cancels the subscription entirely
 * - mark_unpaid: Marks the invoice as uncollectible but keeps the subscription active
 */
"use step";

import { FatalError, RetryableError, getStepMetadata } from 'workflow';
import {
  mockSubscriptionService,
  type OperationResult,
} from '../providers/subscription';

/**
 * The type of final action to execute when dunning is exhausted.
 */
export type FinalAction = 'pause' | 'cancel' | 'mark_unpaid';

/**
 * Options for executing the final dunning action.
 */
export interface ExecuteFinalActionOptions {
  /** The action to execute */
  action: FinalAction;
  /** Subscription ID (required for pause/cancel actions) */
  subscriptionId: string;
  /** Invoice ID (required for mark_unpaid, used for logging on others) */
  invoiceId: string;
  /** Customer ID (for logging) */
  customerId: string;
}

/**
 * Result of the final action execution.
 */
export interface ExecuteFinalActionResult {
  /** Whether the action was executed (false if deduplicated or already in state) */
  executed: boolean;
  /** The action that was attempted */
  action: FinalAction;
  /** Target ID that the action was applied to */
  targetId: string;
  /** Reason if not executed */
  reason?: 'already_executed' | 'already_in_state';
}

/**
 * Executes the final action after all dunning attempts are exhausted.
 *
 * This operation is idempotent - it's safe to call multiple times.
 * The stepId from workflow metadata is used as the idempotency key
 * to prevent duplicate operations on retries.
 *
 * @param options - Options including action type, subscriptionId, invoiceId, and customerId
 * @returns Result indicating whether the action was executed or was a no-op
 * @throws RetryableError for transient failures (not currently thrown by mock)
 * @throws FatalError for permanent failures (e.g., invalid action type)
 */
export async function executeFinalAction(
  options: ExecuteFinalActionOptions
): Promise<ExecuteFinalActionResult> {
  const metadata = getStepMetadata();

  console.log(
    `[executeFinalAction] action=${options.action} ` +
    `subscriptionId=${options.subscriptionId} ` +
    `invoiceId=${options.invoiceId} ` +
    `customerId=${options.customerId} ` +
    `stepId=${metadata.stepId} ` +
    `attempt=${metadata.attempt}`
  );

  try {
    let result: OperationResult;
    let targetId: string;

    switch (options.action) {
      case 'pause':
        result = await mockSubscriptionService.pauseSubscription(
          options.subscriptionId,
          metadata.stepId
        );
        targetId = options.subscriptionId;
        break;

      case 'cancel':
        result = await mockSubscriptionService.cancelSubscription(
          options.subscriptionId,
          metadata.stepId
        );
        targetId = options.subscriptionId;
        break;

      case 'mark_unpaid':
        result = await mockSubscriptionService.markUnpaid(
          options.invoiceId,
          metadata.stepId
        );
        targetId = options.invoiceId;
        break;

      default:
        // TypeScript should catch this, but handle defensively
        throw new FatalError(
          `Unknown final action: ${options.action}. Valid actions are: pause, cancel, mark_unpaid`
        );
    }

    console.log(
      `[executeFinalAction] Result: action=${options.action} ` +
      `executed=${result.executed} reason=${result.reason ?? 'N/A'}`
    );

    return {
      executed: result.executed,
      action: options.action,
      targetId,
      reason: result.reason,
    };
  } catch (error) {
    // If it's already a FatalError, re-throw it
    if (error instanceof FatalError) {
      throw error;
    }

    // The mock subscription service doesn't throw errors currently,
    // but we handle them defensively for future-proofing
    console.log(`[executeFinalAction] Unexpected error: ${error}`);

    // For now, treat unexpected errors as fatal since we don't know
    // if they're safe to retry. In production, this would need
    // more nuanced error handling based on error types.
    throw new FatalError(
      `Failed to execute final action ${options.action}: ${error}`
    );
  }
}
