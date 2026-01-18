/**
 * Step function to send dunning notification emails.
 *
 * This step sends escalating payment reminder emails based on attempt number.
 * It uses the stepId as an idempotency key to prevent duplicate emails.
 * The webhook URL is included as a "fix payment" link for the customer.
 */

import { FatalError, RetryableError, getStepMetadata } from 'workflow';
import type { EmailEscalationLevel } from '../types';
import {
  mockEmailService,
  EmailTransientError,
  type SendEmailOptions,
} from '../providers/email';

/**
 * Options for sending a dunning email.
 */
export interface SendDunningEmailOptions {
  /** Recipient email address */
  to: string;
  /** Customer ID */
  customerId: string;
  /** Invoice ID */
  invoiceId: string;
  /** Current attempt number (1-indexed) used to determine escalation level */
  attemptNumber: number;
  /** Webhook URL for "fix payment" link */
  webhookUrl: string;
  /** Maximum attempts configured (used to determine escalation) */
  maxAttempts?: number;
}

/**
 * Result of sending a dunning email.
 */
export interface SendDunningEmailResult {
  /** Whether the email was sent (false if deduplicated) */
  sent: boolean;
  /** Email ID if sent */
  emailId?: string;
  /** Escalation level used */
  escalationLevel: EmailEscalationLevel;
}

/**
 * Maps attempt number to escalation level.
 * - Attempt 1: Level 0 (friendly reminder)
 * - Attempt 2: Level 1 (urgent notice)
 * - Attempt 3+: Level 2 (final warning)
 */
function getEscalationLevel(attemptNumber: number, maxAttempts: number): EmailEscalationLevel {
  // Ensure we stay within valid escalation levels (0, 1, 2)
  if (attemptNumber === 1) {
    return 0;
  } else if (attemptNumber === 2) {
    return 1;
  } else {
    return 2;
  }
}

/**
 * Sends a dunning email to remind the customer about failed payment.
 *
 * The email escalation level is determined by the attempt number:
 * - Attempt 1: Friendly reminder
 * - Attempt 2: Urgent notice
 * - Attempt 3+: Final warning
 *
 * @param options - Email sending options including recipient and attempt number
 * @returns Result indicating whether the email was sent or deduplicated
 * @throws RetryableError for transient failures (service temporarily unavailable)
 * @throws FatalError for permanent failures (should not happen in mock implementation)
 */
export async function sendDunningEmail(
  options: SendDunningEmailOptions
): Promise<SendDunningEmailResult> {
  "use step";

  const metadata = getStepMetadata();
  const escalationLevel = getEscalationLevel(options.attemptNumber, options.maxAttempts ?? 3);

  console.log(
    `[sendDunningEmail] invoiceId=${options.invoiceId} ` +
    `attemptNumber=${options.attemptNumber} ` +
    `escalationLevel=${escalationLevel} ` +
    `stepId=${metadata.stepId} ` +
    `attempt=${metadata.attempt}`
  );

  try {
    const emailOptions: SendEmailOptions = {
      to: options.to,
      customerId: options.customerId,
      invoiceId: options.invoiceId,
      escalationLevel,
      webhookUrl: options.webhookUrl,
      idempotencyKey: metadata.stepId, // Use stepId for idempotency
    };

    const result = await mockEmailService.sendEmail(emailOptions);

    console.log(
      `[sendDunningEmail] Email result: sent=${result.sent} ` +
      `emailId=${result.emailId ?? 'N/A'} ` +
      `reason=${result.reason ?? 'N/A'}`
    );

    return {
      sent: result.sent,
      emailId: result.emailId,
      escalationLevel,
    };
  } catch (error) {
    // Transient email service error - safe to retry
    if (error instanceof EmailTransientError) {
      console.log(`[sendDunningEmail] Transient error - retrying after 1000ms`);
      throw new RetryableError(
        `Email service temporarily unavailable for invoice ${options.invoiceId}`,
        { retryAfter: 1000 }
      );
    }

    // Unknown error - treat as fatal since we don't know if it's safe to retry
    // In a real implementation, we might want to be more careful here
    console.log(`[sendDunningEmail] Unknown error: ${error} - throwing FatalError`);
    throw new FatalError(`Failed to send dunning email: ${error}`);
  }
}
