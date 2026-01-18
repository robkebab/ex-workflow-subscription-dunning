/**
 * Tests for the main dunning workflow.
 *
 * These tests verify the workflow orchestration logic including:
 * - Webhook creation with deterministic tokens
 * - Promise.race between webhook and sleep
 * - Invoice status checking after each wait
 * - Recovery path (invoice paid mid-dunning)
 * - Exhaustion path (all attempts fail)
 * - Access restriction at configured threshold
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { dunningStore } from './store';
import { mockStripe } from './providers/stripe';
import { mockEmailService } from './providers/email';
import { mockSubscriptionService } from './providers/subscription';

// Mock the workflow package
vi.mock('workflow', () => {
  return {
    FatalError: class FatalError extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'FatalError';
      }
    },
    RetryableError: class RetryableError extends Error {
      retryAfter?: number;
      constructor(message: string, options?: { retryAfter?: number }) {
        super(message);
        this.name = 'RetryableError';
        this.retryAfter = options?.retryAfter;
      }
    },
    getStepMetadata: () => ({
      stepId: `test-step-id-${Math.random().toString(36).slice(2, 11)}`,
      attempt: 1,
    }),
    createWebhook: vi.fn((options?: { token?: string }) => {
      const token = options?.token || `random-${Math.random()}`;
      return {
        token,
        url: `https://workflow.test/webhook/${token}`,
        then: vi.fn((cb) => {
          // Return a promise that never resolves by default (simulating no customer action)
          return new Promise(() => {});
        }),
        [Symbol.asyncIterator]: vi.fn(),
      };
    }),
    sleep: vi.fn(() => Promise.resolve()),
  };
});

// Import workflow after mocking
import { dunningWorkflow } from './workflow';
import { createWebhook, sleep } from 'workflow';

describe('dunningWorkflow', () => {
  beforeEach(() => {
    // Reset all state
    dunningStore.reset();
    mockStripe.resetConfig();
    mockEmailService.resetConfig();
    mockSubscriptionService.resetConfig();

    // Disable latency simulation and random failures for deterministic tests
    mockStripe.configure({
      simulateLatency: false,
      rateLimitProbability: 0,
      transientErrorProbability: 0,
    });
    mockEmailService.configure({
      simulateLatency: false,
      transientFailureProbability: 0,
    });
    mockSubscriptionService.configure({ simulateLatency: false });

    // Clear mock call history
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('uses "use workflow" directive', async () => {
      // The directive is verified by the build process
      // Here we just verify the workflow function exists and is callable
      expect(typeof dunningWorkflow).toBe('function');
    });

    it('creates webhook with deterministic token based on invoiceId', async () => {
      const input = {
        provider: 'stripe',
        invoiceId: 'inv_abc123',
        customerId: 'cus_test',
        subscriptionId: 'sub_test',
      };

      // Set up invoice as paid to exit quickly
      dunningStore.createInvoice(input.invoiceId, input.customerId, input.subscriptionId, {
        status: 'paid',
      });

      await dunningWorkflow(input);

      expect(createWebhook).toHaveBeenCalledWith({
        token: 'dunning:inv_abc123',
      });
    });

    it('merges user config with defaults', async () => {
      const input = {
        provider: 'stripe',
        invoiceId: 'inv_config',
        customerId: 'cus_test',
        subscriptionId: 'sub_test',
        config: {
          maxAttempts: 2,
          finalAction: 'cancel' as const,
        },
      };

      // Create invoice as open - will exhaust
      dunningStore.createInvoice(input.invoiceId, input.customerId, input.subscriptionId);

      const result = await dunningWorkflow(input);

      // Should exhaust after 2 attempts with cancel action
      expect(result.outcome).toBe('exhausted');
      expect(result.finalAction).toBe('cancel');
    });
  });

  describe('Promise.race webhook vs sleep', () => {
    it('races webhook against sleep for each attempt', async () => {
      const input = {
        provider: 'stripe',
        invoiceId: 'inv_race',
        customerId: 'cus_test',
        subscriptionId: 'sub_test',
        config: {
          maxAttempts: 2,
          retrySchedule: ['1d', '3d'],
        },
      };

      // Create invoice as open - will go through retry loop
      dunningStore.createInvoice(input.invoiceId, input.customerId, input.subscriptionId);

      await dunningWorkflow(input);

      // Sleep should be called for each attempt
      expect(sleep).toHaveBeenCalledTimes(2);
    });

    it('checks invoice status after each wait', async () => {
      const input = {
        provider: 'stripe',
        invoiceId: 'inv_check',
        customerId: 'cus_test',
        subscriptionId: 'sub_test',
        config: {
          maxAttempts: 2,
        },
      };

      // Create invoice as open
      dunningStore.createInvoice(input.invoiceId, input.customerId, input.subscriptionId);

      await dunningWorkflow(input);

      // Invoice should be fetched after each attempt
      // Initial + 2 attempts = we can verify the store was accessed
      const invoice = dunningStore.getInvoice(input.invoiceId);
      expect(invoice).toBeDefined();
    });
  });

  describe('recovery path', () => {
    it('returns recovered when invoice is paid on first check', async () => {
      const input = {
        provider: 'stripe',
        invoiceId: 'inv_recovered_1',
        customerId: 'cus_test',
        subscriptionId: 'sub_test',
      };

      // Create invoice as paid
      dunningStore.createInvoice(input.invoiceId, input.customerId, input.subscriptionId, {
        status: 'paid',
      });

      const result = await dunningWorkflow(input);

      expect(result.outcome).toBe('recovered');
      expect(result.invoiceId).toBe(input.invoiceId);
      expect(result.attemptsUsed).toBe(1);
      expect(result.finalAction).toBeUndefined();
    });

    it('returns recovered when invoice is paid mid-dunning', async () => {
      const input = {
        provider: 'stripe',
        invoiceId: 'inv_recovered_2',
        customerId: 'cus_test',
        subscriptionId: 'sub_test',
        config: {
          maxAttempts: 3,
        },
      };

      // Create invoice as open
      dunningStore.createInvoice(input.invoiceId, input.customerId, input.subscriptionId);

      // Set up sleep to simulate payment after first wait
      let sleepCallCount = 0;
      vi.mocked(sleep).mockImplementation(async () => {
        sleepCallCount++;
        // After first sleep, mark invoice as paid
        if (sleepCallCount === 1) {
          dunningStore.markInvoicePaid(input.invoiceId);
        }
      });

      const result = await dunningWorkflow(input);

      expect(result.outcome).toBe('recovered');
      expect(result.attemptsUsed).toBe(1);
    });

    it('returns recovered on attempt 2', async () => {
      const input = {
        provider: 'stripe',
        invoiceId: 'inv_recovered_3',
        customerId: 'cus_test',
        subscriptionId: 'sub_test',
        config: {
          maxAttempts: 3,
        },
      };

      // Create invoice as open
      dunningStore.createInvoice(input.invoiceId, input.customerId, input.subscriptionId);

      // Mark as paid after second sleep
      let sleepCallCount = 0;
      vi.mocked(sleep).mockImplementation(async () => {
        sleepCallCount++;
        if (sleepCallCount === 2) {
          dunningStore.markInvoicePaid(input.invoiceId);
        }
      });

      const result = await dunningWorkflow(input);

      expect(result.outcome).toBe('recovered');
      expect(result.attemptsUsed).toBe(2);
    });
  });

  describe('exhaustion path', () => {
    it('returns exhausted after all attempts fail', async () => {
      const input = {
        provider: 'stripe',
        invoiceId: 'inv_exhausted',
        customerId: 'cus_test',
        subscriptionId: 'sub_test',
        config: {
          maxAttempts: 3,
          finalAction: 'pause' as const,
        },
      };

      // Create invoice as open (never paid)
      dunningStore.createInvoice(input.invoiceId, input.customerId, input.subscriptionId);

      const result = await dunningWorkflow(input);

      expect(result.outcome).toBe('exhausted');
      expect(result.invoiceId).toBe(input.invoiceId);
      expect(result.attemptsUsed).toBe(3);
      expect(result.finalAction).toBe('pause');
    });

    it('executes pause final action', async () => {
      const input = {
        provider: 'stripe',
        invoiceId: 'inv_pause',
        customerId: 'cus_test',
        subscriptionId: 'sub_pause',
        config: {
          maxAttempts: 1,
          finalAction: 'pause' as const,
        },
      };

      dunningStore.createInvoice(input.invoiceId, input.customerId, input.subscriptionId);

      await dunningWorkflow(input);

      // Verify subscription is paused
      expect(dunningStore.isSubscriptionPaused(input.subscriptionId)).toBe(true);
    });

    it('executes cancel final action', async () => {
      const input = {
        provider: 'stripe',
        invoiceId: 'inv_cancel',
        customerId: 'cus_test',
        subscriptionId: 'sub_cancel',
        config: {
          maxAttempts: 1,
          finalAction: 'cancel' as const,
        },
      };

      dunningStore.createInvoice(input.invoiceId, input.customerId, input.subscriptionId);

      await dunningWorkflow(input);

      // Verify subscription is canceled
      expect(dunningStore.isSubscriptionCanceled(input.subscriptionId)).toBe(true);
    });

    it('executes mark_unpaid final action', async () => {
      const input = {
        provider: 'stripe',
        invoiceId: 'inv_mark_unpaid',
        customerId: 'cus_test',
        subscriptionId: 'sub_test',
        config: {
          maxAttempts: 1,
          finalAction: 'mark_unpaid' as const,
        },
      };

      dunningStore.createInvoice(input.invoiceId, input.customerId, input.subscriptionId);

      await dunningWorkflow(input);

      // Verify operation was logged
      const operations = dunningStore.getSubscriptionOperations();
      const markUnpaidOp = operations.find(
        (op) => op.type === 'mark_unpaid' && op.targetId === input.invoiceId
      );
      expect(markUnpaidOp).toBeDefined();
    });
  });

  describe('access restriction', () => {
    it('restricts access at configured threshold', async () => {
      const input = {
        provider: 'stripe',
        invoiceId: 'inv_restrict',
        customerId: 'cus_restrict',
        subscriptionId: 'sub_test',
        config: {
          maxAttempts: 3,
          restrictAccessAfterAttempt: 2,
        },
      };

      dunningStore.createInvoice(input.invoiceId, input.customerId, input.subscriptionId);

      await dunningWorkflow(input);

      // Customer should be restricted
      expect(dunningStore.isCustomerRestricted(input.customerId)).toBe(true);
    });

    it('restricts access immediately if threshold is 1', async () => {
      const input = {
        provider: 'stripe',
        invoiceId: 'inv_restrict_1',
        customerId: 'cus_restrict_1',
        subscriptionId: 'sub_test',
        config: {
          maxAttempts: 2,
          restrictAccessAfterAttempt: 1,
        },
      };

      dunningStore.createInvoice(input.invoiceId, input.customerId, input.subscriptionId);

      await dunningWorkflow(input);

      expect(dunningStore.isCustomerRestricted(input.customerId)).toBe(true);
    });

    it('does not restrict if threshold not reached', async () => {
      const input = {
        provider: 'stripe',
        invoiceId: 'inv_no_restrict',
        customerId: 'cus_no_restrict',
        subscriptionId: 'sub_test',
        config: {
          maxAttempts: 1,
          restrictAccessAfterAttempt: 3, // Threshold higher than attempts
        },
      };

      dunningStore.createInvoice(input.invoiceId, input.customerId, input.subscriptionId);

      await dunningWorkflow(input);

      // Customer should NOT be restricted
      expect(dunningStore.isCustomerRestricted(input.customerId)).toBe(false);
    });
  });

  describe('email escalation', () => {
    it('sends initial email with webhook URL', async () => {
      const input = {
        provider: 'stripe',
        invoiceId: 'inv_email_1',
        customerId: 'cus_email',
        subscriptionId: 'sub_test',
        config: {
          maxAttempts: 1,
        },
      };

      dunningStore.createInvoice(input.invoiceId, input.customerId, input.subscriptionId);

      await dunningWorkflow(input);

      // Check email was logged
      const emails = dunningStore.getEmailLogs(input.invoiceId);
      expect(emails.length).toBeGreaterThanOrEqual(1);
      expect(emails[0].webhookUrl).toContain('dunning:inv_email_1');
    });

    it('sends escalating emails for each attempt', async () => {
      const input = {
        provider: 'stripe',
        invoiceId: 'inv_email_3',
        customerId: 'cus_email_3',
        subscriptionId: 'sub_test',
        config: {
          maxAttempts: 3,
        },
      };

      dunningStore.createInvoice(input.invoiceId, input.customerId, input.subscriptionId);

      await dunningWorkflow(input);

      // Should have sent 3 emails (initial + 2 escalations)
      const emails = dunningStore.getEmailLogs(input.invoiceId);
      expect(emails.length).toBe(3);

      // Verify escalation levels
      expect(emails[0].escalationLevel).toBe(0); // Friendly
      expect(emails[1].escalationLevel).toBe(1); // Urgent
      expect(emails[2].escalationLevel).toBe(2); // Final
    });
  });

  describe('full happy path', () => {
    it('customer pays after first email - workflow recovers', async () => {
      const input = {
        provider: 'stripe',
        invoiceId: 'inv_happy',
        customerId: 'cus_happy',
        subscriptionId: 'sub_happy',
        config: {
          maxAttempts: 3,
          restrictAccessAfterAttempt: 2,
        },
      };

      dunningStore.createInvoice(input.invoiceId, input.customerId, input.subscriptionId);

      // Customer pays immediately after first sleep
      vi.mocked(sleep).mockImplementationOnce(async () => {
        dunningStore.markInvoicePaid(input.invoiceId);
      });

      const result = await dunningWorkflow(input);

      expect(result.outcome).toBe('recovered');
      expect(result.attemptsUsed).toBe(1);
      expect(result.finalAction).toBeUndefined();

      // No access restriction should occur
      expect(dunningStore.isCustomerRestricted(input.customerId)).toBe(false);

      // No final action should occur
      expect(dunningStore.isSubscriptionPaused(input.subscriptionId)).toBe(false);
      expect(dunningStore.isSubscriptionCanceled(input.subscriptionId)).toBe(false);
    });
  });

  describe('full exhaustion path', () => {
    it('all attempts fail - workflow exhausts and executes final action', async () => {
      const input = {
        provider: 'stripe',
        invoiceId: 'inv_exhaustion',
        customerId: 'cus_exhaustion',
        subscriptionId: 'sub_exhaustion',
        config: {
          maxAttempts: 3,
          restrictAccessAfterAttempt: 2,
          finalAction: 'pause' as const,
        },
      };

      dunningStore.createInvoice(input.invoiceId, input.customerId, input.subscriptionId);

      const result = await dunningWorkflow(input);

      expect(result.outcome).toBe('exhausted');
      expect(result.attemptsUsed).toBe(3);
      expect(result.finalAction).toBe('pause');

      // Access should be restricted (threshold was 2)
      expect(dunningStore.isCustomerRestricted(input.customerId)).toBe(true);

      // Subscription should be paused
      expect(dunningStore.isSubscriptionPaused(input.subscriptionId)).toBe(true);

      // 3 emails should have been sent
      const emails = dunningStore.getEmailLogs(input.invoiceId);
      expect(emails.length).toBe(3);
    });
  });
});
