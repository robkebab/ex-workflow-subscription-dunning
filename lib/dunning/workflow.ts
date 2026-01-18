/**
 * Main subscription dunning workflow.
 *
 * This workflow orchestrates the dunning process: sends notifications, waits for
 * customer action or timeout, escalates, and executes final action if payment
 * is not recovered.
 *
 * The workflow uses:
 * - Deterministic webhook tokens for idempotent restart handling
 * - Durable sleeps that survive process restarts
 * - Promise.race to race customer action vs timeout
 * - Step functions for each operation (emails, status checks, actions)
 */

import { createWebhook, sleep } from 'workflow';
import type { DunningWorkflowInput, DunningResult, DunningConfig } from './types';
import {
  DEFAULT_RETRY_SCHEDULE,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_FINAL_ACTION,
  DEFAULT_RESTRICT_ACCESS_AFTER_ATTEMPT,
} from './types';
import { checkInvoiceStatus } from './steps/check-invoice-status';
import { sendDunningEmail } from './steps/send-dunning-email';
import { restrictCustomerAccess } from './steps/restrict-access';
import { executeFinalAction } from './steps/execute-final-action';
import { parseDuration } from './utils/duration';

/**
 * Merges user-provided config with defaults.
 */
function mergeConfig(userConfig?: DunningConfig): Required<Omit<DunningConfig, 'gracePeriod'>> {
  return {
    retrySchedule: userConfig?.retrySchedule ?? DEFAULT_RETRY_SCHEDULE,
    maxAttempts: userConfig?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    finalAction: userConfig?.finalAction ?? DEFAULT_FINAL_ACTION,
    restrictAccessAfterAttempt:
      userConfig?.restrictAccessAfterAttempt ?? DEFAULT_RESTRICT_ACCESS_AFTER_ATTEMPT,
  };
}

/**
 * Main dunning workflow that handles failed subscription payments.
 *
 * The workflow:
 * 1. Creates a deterministic webhook for customer "fix payment" action
 * 2. Sends an initial dunning email with the webhook URL
 * 3. For each retry attempt:
 *    - Races customer webhook action against a durable sleep
 *    - Checks invoice status after the race resolves
 *    - If paid, returns with 'recovered' outcome
 *    - If not paid and at restrict threshold, restricts customer access
 *    - If not paid and more attempts remain, sends escalating email
 * 4. After all attempts exhausted, executes final action and returns 'exhausted'
 *
 * @param input - Workflow input containing invoice, customer, and subscription IDs
 * @returns Dunning result with outcome ('recovered' or 'exhausted') and details
 */
export async function dunningWorkflow(input: DunningWorkflowInput): Promise<DunningResult> {
  "use workflow";

  const { invoiceId, customerId, subscriptionId, config: userConfig } = input;
  const config = mergeConfig(userConfig);

  console.log(
    `[dunningWorkflow] Starting dunning for invoice=${invoiceId} ` +
    `customer=${customerId} subscription=${subscriptionId} ` +
    `maxAttempts=${config.maxAttempts} finalAction=${config.finalAction}`
  );

  // Create deterministic webhook token for this invoice
  // This ensures the same webhook URL across workflow restarts
  const webhookToken = `dunning:${invoiceId}`;
  const webhook = createWebhook({ token: webhookToken });

  console.log(`[dunningWorkflow] Created webhook with token=${webhookToken} url=${webhook.url}`);

  // NOTE: Invoice must exist before workflow starts.
  // In production, the invoice exists in Stripe. For testing, the API route or test
  // setup must create the invoice before triggering the workflow.
  // Direct store access here would violate workflow determinism (breaks replay).

  // Get customer email (in production, this would come from customer data)
  // For mock purposes, we use a deterministic email based on customer ID
  const customerEmail = `${customerId}@example.com`;

  // Send initial dunning email (attempt 1)
  await sendDunningEmail({
    to: customerEmail,
    customerId,
    invoiceId,
    attemptNumber: 1,
    webhookUrl: webhook.url,
    maxAttempts: config.maxAttempts,
  });

  // Track attempts used (starting at 1 since we just sent the first email)
  let attemptsUsed = 1;

  // Retry loop: for each attempt, wait for customer action or timeout
  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    const delay = config.retrySchedule[attempt - 1] || config.retrySchedule[config.retrySchedule.length - 1];

    console.log(
      `[dunningWorkflow] Attempt ${attempt}/${config.maxAttempts}: ` +
      `waiting ${delay} for customer action or timeout`
    );

    // Race: customer fixes payment (webhook) vs timeout (sleep)
    // The webhook resolves when customer clicks the "fix payment" link
    // The sleep resolves after the configured delay
    const delayMs = parseDuration(delay);
    await Promise.race([
      webhook.then(() => {
        console.log(`[dunningWorkflow] Webhook triggered for invoice=${invoiceId}`);
      }),
      sleep(delayMs),
    ]);

    // After race resolves, check current invoice status
    const invoiceState = await checkInvoiceStatus(invoiceId);

    console.log(
      `[dunningWorkflow] After attempt ${attempt}: invoice status=${invoiceState.status}`
    );

    // If invoice is paid, we're done - recovery successful!
    if (invoiceState.status === 'paid') {
      console.log(
        `[dunningWorkflow] Invoice ${invoiceId} recovered after ${attemptsUsed} attempt(s)`
      );
      return {
        invoiceId,
        outcome: 'recovered',
        attemptsUsed,
      };
    }

    // Check if we should restrict access at this attempt
    if (attempt >= config.restrictAccessAfterAttempt) {
      console.log(
        `[dunningWorkflow] Restricting access for customer=${customerId} ` +
        `at attempt ${attempt} (threshold: ${config.restrictAccessAfterAttempt})`
      );
      await restrictCustomerAccess({
        customerId,
        invoiceId,
        subscriptionId,
      });
    }

    // If more attempts remain, send escalating email
    if (attempt < config.maxAttempts) {
      attemptsUsed++;
      console.log(
        `[dunningWorkflow] Sending escalating email for attempt ${attemptsUsed}`
      );
      await sendDunningEmail({
        to: customerEmail,
        customerId,
        invoiceId,
        attemptNumber: attemptsUsed,
        webhookUrl: webhook.url,
        maxAttempts: config.maxAttempts,
      });
    }
  }

  // All attempts exhausted - execute final action
  console.log(
    `[dunningWorkflow] All ${config.maxAttempts} attempts exhausted. ` +
    `Executing final action: ${config.finalAction}`
  );

  await executeFinalAction({
    action: config.finalAction,
    subscriptionId,
    invoiceId,
    customerId,
  });

  console.log(
    `[dunningWorkflow] Dunning exhausted for invoice=${invoiceId} ` +
    `finalAction=${config.finalAction} attemptsUsed=${attemptsUsed}`
  );

  return {
    invoiceId,
    outcome: 'exhausted',
    finalAction: config.finalAction,
    attemptsUsed,
  };
}
