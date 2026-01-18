/**
 * Core types and configuration for the subscription dunning workflow.
 *
 * This module provides type-safe interfaces and sensible defaults for the dunning
 * process, which handles failed subscription payments through escalating reminders
 * and eventual subscription management actions.
 */

// -----------------------------------------------------------------------------
// Email Escalation Levels
// -----------------------------------------------------------------------------

/**
 * Email escalation levels determine the tone and urgency of dunning emails.
 * - Level 0: friendly reminder
 * - Level 1: urgent notice
 * - Level 2: final warning
 */
export type EmailEscalationLevel = 0 | 1 | 2;

// -----------------------------------------------------------------------------
// Invoice State
// -----------------------------------------------------------------------------

/**
 * Represents the current state of an invoice from the billing provider.
 */
export interface InvoiceState {
  /** Unique invoice identifier */
  id: string;
  /** Current payment status */
  status: 'open' | 'paid' | 'void' | 'uncollectible';
  /** Amount due in smallest currency unit (e.g., cents) */
  amountDue: number;
  /** ISO 4217 currency code (e.g., 'usd') */
  currency: string;
  /** Optional timestamp for next automatic payment attempt */
  nextPaymentAttempt?: number;
  /** Customer identifier */
  customerId: string;
  /** Subscription identifier */
  subscriptionId: string;
}

// -----------------------------------------------------------------------------
// Dunning Configuration
// -----------------------------------------------------------------------------

/**
 * Configuration options for the dunning workflow.
 * All fields are optional and will fall back to defaults if not provided.
 */
export interface DunningConfig {
  /**
   * Schedule of delays between retry attempts.
   * Each string represents a duration (e.g., "1d", "3d", "7d").
   * The array length determines the number of retry cycles.
   */
  retrySchedule?: string[];

  /**
   * Maximum number of payment retry attempts before executing final action.
   */
  maxAttempts?: number;

  /**
   * Total grace period before final action.
   * Used to calculate the overall dunning timeline.
   */
  gracePeriod?: string;

  /**
   * Action to take when all retry attempts are exhausted.
   * - 'pause': Pause the subscription (can be resumed after payment)
   * - 'cancel': Cancel the subscription entirely
   * - 'mark_unpaid': Mark invoice as uncollectible but keep subscription
   */
  finalAction?: 'pause' | 'cancel' | 'mark_unpaid';

  /**
   * Attempt number after which to restrict customer access.
   * Access is restricted starting from this attempt (1-indexed).
   * For example, 2 means restrict after the 2nd failed attempt.
   */
  restrictAccessAfterAttempt?: number;
}

// -----------------------------------------------------------------------------
// Workflow Input & Output
// -----------------------------------------------------------------------------

/**
 * Input parameters for starting a dunning workflow.
 */
export interface DunningWorkflowInput {
  /** Billing provider identifier (e.g., 'stripe') */
  provider: string;
  /** Invoice ID from the billing provider */
  invoiceId: string;
  /** Customer ID from the billing provider */
  customerId: string;
  /** Subscription ID from the billing provider */
  subscriptionId: string;
  /** Optional configuration overrides */
  config?: DunningConfig;
}

/**
 * Result returned when a dunning workflow completes.
 */
export interface DunningResult {
  /** The invoice that was processed */
  invoiceId: string;
  /** Outcome of the dunning process */
  outcome: 'recovered' | 'exhausted';
  /** Action taken if outcome is 'exhausted' */
  finalAction?: 'pause' | 'cancel' | 'mark_unpaid';
  /** Number of attempts made before resolution */
  attemptsUsed: number;
}

// -----------------------------------------------------------------------------
// Default Configuration Constants
// -----------------------------------------------------------------------------

/**
 * Default schedule of delays between retry attempts.
 * Provides an escalating cadence: 1 day, then 3 days, then 7 days.
 */
export const DEFAULT_RETRY_SCHEDULE: string[] = ['1d', '3d', '7d'];

/**
 * Default maximum number of payment retry attempts.
 */
export const DEFAULT_MAX_ATTEMPTS: number = 3;

/**
 * Default final action when all retry attempts are exhausted.
 * Pausing allows for easier recovery compared to cancellation.
 */
export const DEFAULT_FINAL_ACTION: 'pause' | 'cancel' | 'mark_unpaid' = 'pause';

/**
 * Default attempt number after which to restrict customer access.
 * Restricting after attempt 2 gives customer two chances before access loss.
 */
export const DEFAULT_RESTRICT_ACCESS_AFTER_ATTEMPT: number = 2;
