/**
 * Mock email service for sending dunning notifications.
 *
 * Simulates email delivery with idempotency support and configurable
 * transient failures for testing retry behavior.
 */

import type { EmailEscalationLevel } from '../types';
import { dunningStore } from '../store';

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

export interface EmailServiceConfig {
  /** Probability of transient failure (0-1, default: 0.05) */
  transientFailureProbability?: number;
  /** Simulated send latency in ms (default: 100) */
  sendLatency?: number;
  /** Enable/disable latency simulation (default: true) */
  simulateLatency?: boolean;
}

const defaultConfig: Required<EmailServiceConfig> = {
  transientFailureProbability: 0.05,
  sendLatency: 100,
  simulateLatency: true,
};

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface SendEmailOptions {
  /** Recipient email address */
  to: string;
  /** Customer ID */
  customerId: string;
  /** Invoice ID */
  invoiceId: string;
  /** Escalation level (0=friendly, 1=urgent, 2=final) */
  escalationLevel: EmailEscalationLevel;
  /** Webhook URL for "fix payment" link */
  webhookUrl: string;
  /** Idempotency key to prevent duplicate sends */
  idempotencyKey: string;
  /** Amount due (for email content) */
  amountDue?: number;
  /** Currency code */
  currency?: string;
}

export interface SendEmailResult {
  /** Whether email was sent (false if deduplicated) */
  sent: boolean;
  /** Email ID if sent */
  emailId?: string;
  /** Reason if not sent */
  reason?: 'duplicate' | 'error';
}

// -----------------------------------------------------------------------------
// Error Types
// -----------------------------------------------------------------------------

export class EmailError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean
  ) {
    super(message);
    this.name = 'EmailError';
  }
}

export class EmailTransientError extends EmailError {
  constructor() {
    super('Email service temporarily unavailable', 'transient_error', true);
    this.name = 'EmailTransientError';
  }
}

// -----------------------------------------------------------------------------
// Email Templates
// -----------------------------------------------------------------------------

const EMAIL_SUBJECTS: Record<EmailEscalationLevel, string> = {
  0: 'Payment reminder: Your subscription payment failed',
  1: 'Urgent: Action required on your subscription',
  2: 'Final notice: Your subscription will be affected',
};

const EMAIL_CONTENT_TEMPLATES: Record<EmailEscalationLevel, string> = {
  0: `Hi there,

We noticed that your recent payment didn't go through. This happens sometimes - no worries!

Please update your payment method to keep your subscription active.

[Fix Payment]({webhookUrl})

If you have any questions, we're here to help.

Thanks,
The Team`,

  1: `Hi there,

This is an urgent notice about your subscription. We've been unable to process your payment.

Your access may be limited if payment is not received soon.

Please update your payment method now:
[Fix Payment]({webhookUrl})

Best regards,
The Team`,

  2: `Hi there,

This is your final notice. Your subscription payment remains unpaid.

Without payment, your subscription will be paused and access will be restricted.

Take action now to avoid interruption:
[Fix Payment]({webhookUrl})

If you've already made a payment, please disregard this notice.

The Team`,
};

// -----------------------------------------------------------------------------
// Service Implementation
// -----------------------------------------------------------------------------

/**
 * Mock email service for testing dunning notifications.
 */
class MockEmailService {
  private config: Required<EmailServiceConfig>;

  constructor(config: EmailServiceConfig = {}) {
    this.config = { ...defaultConfig, ...config };
  }

  /**
   * Update service configuration.
   */
  configure(config: EmailServiceConfig): void {
    this.config = { ...this.config, ...config };
    this.log('configure', config as Record<string, unknown>);
  }

  /**
   * Reset configuration to defaults.
   */
  resetConfig(): void {
    this.config = { ...defaultConfig };
    this.log('resetConfig', {});
  }

  /**
   * Send a dunning email.
   * Returns immediately if email with same idempotency key was already sent.
   */
  async sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
    this.log('sendEmail', {
      to: options.to,
      invoiceId: options.invoiceId,
      escalationLevel: options.escalationLevel,
      idempotencyKey: options.idempotencyKey,
    });

    // Check for duplicate first (before simulating failures)
    if (dunningStore.wasEmailSent(options.idempotencyKey)) {
      this.log('sendEmail:duplicate', { idempotencyKey: options.idempotencyKey });
      return { sent: false, reason: 'duplicate' };
    }

    // Simulate latency
    if (this.config.simulateLatency) {
      await new Promise((resolve) =>
        setTimeout(resolve, this.config.sendLatency)
      );
    }

    // Maybe throw transient error
    if (Math.random() < this.config.transientFailureProbability) {
      this.log('sendEmail:transientError', {});
      throw new EmailTransientError();
    }

    // Log the email
    const logged = dunningStore.logEmail({
      to: options.to,
      customerId: options.customerId,
      invoiceId: options.invoiceId,
      escalationLevel: options.escalationLevel,
      webhookUrl: options.webhookUrl,
      idempotencyKey: options.idempotencyKey,
    });

    // Handle race condition where another request logged it first
    if (!logged) {
      return { sent: false, reason: 'duplicate' };
    }

    this.log('sendEmail:sent', {
      emailId: logged.id,
      subject: EMAIL_SUBJECTS[options.escalationLevel],
    });

    return { sent: true, emailId: logged.id };
  }

  /**
   * Get email subject for an escalation level.
   */
  getSubject(escalationLevel: EmailEscalationLevel): string {
    return EMAIL_SUBJECTS[escalationLevel];
  }

  /**
   * Get email content for an escalation level with webhook URL substituted.
   */
  getContent(
    escalationLevel: EmailEscalationLevel,
    webhookUrl: string
  ): string {
    return EMAIL_CONTENT_TEMPLATES[escalationLevel].replace(
      '{webhookUrl}',
      webhookUrl
    );
  }

  private log(method: string, data: Record<string, unknown>): void {
    console.log(`[MockEmail.${method}]`, JSON.stringify(data));
  }
}

// Export singleton instance
export const mockEmailService = new MockEmailService();

// Export class for testing
export { MockEmailService };
