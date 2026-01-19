/**
 * Tests for sendDunningEmail step function.
 *
 * These tests verify:
 * 1. Success path - sends email with correct escalation level
 * 2. Escalation levels - maps attempt numbers to correct levels
 * 3. Idempotency - uses stepId to prevent duplicate sends
 * 4. RetryableError on transient failures - allows retry for service errors
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FatalError, RetryableError } from 'workflow';
import { sendDunningEmail } from './send-dunning-email';
import { dunningStore } from '../store';
import { mockEmailService } from '../providers/email';

// Track stepId for idempotency tests and attempt for exponential backoff tests
let mockStepId = 'test-step-id';
let mockAttempt = 1;

// Mock getStepMetadata since we're testing outside of workflow runtime
vi.mock('workflow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('workflow')>();
  return {
    ...actual,
    getStepMetadata: () => ({
      stepId: mockStepId,
      stepStartedAt: new Date(),
      attempt: mockAttempt,
    }),
  };
});

describe('sendDunningEmail step', () => {
  beforeEach(() => {
    // Reset store and email service config before each test
    dunningStore.reset();
    mockEmailService.resetConfig();
    // Disable random failures and latency for predictable tests
    mockEmailService.configure({
      transientFailureProbability: 0,
      simulateLatency: false,
    });
    // Reset stepId to default and attempt to 1
    mockStepId = 'test-step-id-' + Math.random().toString(36).slice(2);
    mockAttempt = 1;
  });

  describe('success path', () => {
    it('sends email successfully with correct parameters', async () => {
      const result = await sendDunningEmail({
        to: 'customer@example.com',
        customerId: 'cus_test',
        invoiceId: 'inv_test',
        attemptNumber: 1,
        webhookUrl: 'https://example.com/fix-payment',
      });

      expect(result.sent).toBe(true);
      expect(result.emailId).toBeDefined();
      expect(result.escalationLevel).toBe(0);
    });

    it('logs email in the store', async () => {
      await sendDunningEmail({
        to: 'customer@example.com',
        customerId: 'cus_test',
        invoiceId: 'inv_test_log',
        attemptNumber: 1,
        webhookUrl: 'https://example.com/fix-payment',
      });

      const emails = dunningStore.getEmailLogs();
      expect(emails.length).toBe(1);
      expect(emails[0].to).toBe('customer@example.com');
      expect(emails[0].invoiceId).toBe('inv_test_log');
      expect(emails[0].escalationLevel).toBe(0);
    });
  });

  describe('escalation levels', () => {
    it('uses level 0 (friendly) for attempt 1', async () => {
      const result = await sendDunningEmail({
        to: 'customer@example.com',
        customerId: 'cus_test',
        invoiceId: 'inv_level_0',
        attemptNumber: 1,
        webhookUrl: 'https://example.com/fix-payment',
      });

      expect(result.escalationLevel).toBe(0);
    });

    it('uses level 1 (urgent) for attempt 2', async () => {
      const result = await sendDunningEmail({
        to: 'customer@example.com',
        customerId: 'cus_test',
        invoiceId: 'inv_level_1',
        attemptNumber: 2,
        webhookUrl: 'https://example.com/fix-payment',
      });

      expect(result.escalationLevel).toBe(1);
    });

    it('uses level 2 (final) for attempt 3', async () => {
      const result = await sendDunningEmail({
        to: 'customer@example.com',
        customerId: 'cus_test',
        invoiceId: 'inv_level_2',
        attemptNumber: 3,
        webhookUrl: 'https://example.com/fix-payment',
      });

      expect(result.escalationLevel).toBe(2);
    });

    it('uses level 2 (final) for attempt 4+', async () => {
      const result = await sendDunningEmail({
        to: 'customer@example.com',
        customerId: 'cus_test',
        invoiceId: 'inv_level_2_plus',
        attemptNumber: 5,
        webhookUrl: 'https://example.com/fix-payment',
      });

      expect(result.escalationLevel).toBe(2);
    });
  });

  describe('idempotency', () => {
    it('uses stepId as idempotency key to prevent duplicates', async () => {
      // Use same stepId for both calls
      mockStepId = 'idempotent-step-123';

      // First call - should send
      const result1 = await sendDunningEmail({
        to: 'customer@example.com',
        customerId: 'cus_test',
        invoiceId: 'inv_idempotent',
        attemptNumber: 1,
        webhookUrl: 'https://example.com/fix-payment',
      });

      expect(result1.sent).toBe(true);

      // Second call with same stepId - should be deduplicated
      const result2 = await sendDunningEmail({
        to: 'customer@example.com',
        customerId: 'cus_test',
        invoiceId: 'inv_idempotent',
        attemptNumber: 1,
        webhookUrl: 'https://example.com/fix-payment',
      });

      expect(result2.sent).toBe(false);

      // Verify only one email was logged
      const emails = dunningStore.getEmailLogs();
      const invoiceEmails = emails.filter(e => e.invoiceId === 'inv_idempotent');
      expect(invoiceEmails.length).toBe(1);
    });

    it('different stepIds result in separate emails', async () => {
      // First call
      mockStepId = 'step-id-1';
      await sendDunningEmail({
        to: 'customer@example.com',
        customerId: 'cus_test',
        invoiceId: 'inv_different_steps',
        attemptNumber: 1,
        webhookUrl: 'https://example.com/fix-payment',
      });

      // Second call with different stepId
      mockStepId = 'step-id-2';
      await sendDunningEmail({
        to: 'customer@example.com',
        customerId: 'cus_test',
        invoiceId: 'inv_different_steps',
        attemptNumber: 2,
        webhookUrl: 'https://example.com/fix-payment',
      });

      // Both emails should be logged
      const emails = dunningStore.getEmailLogs();
      const invoiceEmails = emails.filter(e => e.invoiceId === 'inv_different_steps');
      expect(invoiceEmails.length).toBe(2);
    });
  });

  describe('RetryableError on transient failure', () => {
    it('throws RetryableError when email service fails transiently', async () => {
      // Configure 100% transient failure probability
      mockEmailService.configure({
        transientFailureProbability: 1,
        simulateLatency: false,
      });

      await expect(
        sendDunningEmail({
          to: 'customer@example.com',
          customerId: 'cus_test',
          invoiceId: 'inv_transient',
          attemptNumber: 1,
          webhookUrl: 'https://example.com/fix-payment',
        })
      ).rejects.toThrow(RetryableError);
    });

    it('RetryableError has retryAfter set', async () => {
      mockEmailService.configure({
        transientFailureProbability: 1,
        simulateLatency: false,
      });

      try {
        await sendDunningEmail({
          to: 'customer@example.com',
          customerId: 'cus_test',
          invoiceId: 'inv_retry_after',
          attemptNumber: 1,
          webhookUrl: 'https://example.com/fix-payment',
        });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(RetryableError.is(error)).toBe(true);
        expect((error as RetryableError).retryAfter).toBeInstanceOf(Date);
      }
    });

    it('succeeds after transient failure is cleared', async () => {
      // First call - transient error
      mockEmailService.configure({
        transientFailureProbability: 1,
        simulateLatency: false,
      });

      // Use different stepIds to avoid idempotency dedup
      mockStepId = 'recovery-step-1';
      await expect(
        sendDunningEmail({
          to: 'customer@example.com',
          customerId: 'cus_test',
          invoiceId: 'inv_recovery',
          attemptNumber: 1,
          webhookUrl: 'https://example.com/fix-payment',
        })
      ).rejects.toThrow(RetryableError);

      // Second call - success (simulates retry)
      mockEmailService.configure({
        transientFailureProbability: 0,
        simulateLatency: false,
      });

      mockStepId = 'recovery-step-2';
      const result = await sendDunningEmail({
        to: 'customer@example.com',
        customerId: 'cus_test',
        invoiceId: 'inv_recovery',
        attemptNumber: 1,
        webhookUrl: 'https://example.com/fix-payment',
      });

      expect(result.sent).toBe(true);
    });
  });

  describe('webhook URL', () => {
    it('includes webhook URL in email options', async () => {
      const webhookUrl = 'https://example.com/fix-payment/inv_webhook_test';

      await sendDunningEmail({
        to: 'customer@example.com',
        customerId: 'cus_test',
        invoiceId: 'inv_webhook_test',
        attemptNumber: 1,
        webhookUrl,
      });

      const emails = dunningStore.getEmailLogs();
      const email = emails.find(e => e.invoiceId === 'inv_webhook_test');
      expect(email?.webhookUrl).toBe(webhookUrl);
    });
  });

  describe('exponential backoff', () => {
    it('uses exponential backoff for transient errors based on attempt number', async () => {
      mockEmailService.configure({
        transientFailureProbability: 1,
        simulateLatency: false,
      });

      // Test attempt 1: delay should be 1^2 * 1000 = 1000ms
      mockAttempt = 1;
      mockStepId = 'backoff-step-1';
      try {
        await sendDunningEmail({
          to: 'customer@example.com',
          customerId: 'cus_test',
          invoiceId: 'inv_backoff',
          attemptNumber: 1,
          webhookUrl: 'https://example.com/fix-payment',
        });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(RetryableError.is(error)).toBe(true);
        const retryableError = error as RetryableError;
        const delayMs = retryableError.retryAfter!.getTime() - Date.now();
        expect(delayMs).toBeGreaterThanOrEqual(900); // Allow some tolerance
        expect(delayMs).toBeLessThanOrEqual(1100);
      }

      // Test attempt 2: delay should be 2^2 * 1000 = 4000ms
      mockAttempt = 2;
      mockStepId = 'backoff-step-2';
      try {
        await sendDunningEmail({
          to: 'customer@example.com',
          customerId: 'cus_test',
          invoiceId: 'inv_backoff',
          attemptNumber: 1,
          webhookUrl: 'https://example.com/fix-payment',
        });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(RetryableError.is(error)).toBe(true);
        const retryableError = error as RetryableError;
        const delayMs = retryableError.retryAfter!.getTime() - Date.now();
        expect(delayMs).toBeGreaterThanOrEqual(3900);
        expect(delayMs).toBeLessThanOrEqual(4100);
      }

      // Test attempt 3: delay should be 3^2 * 1000 = 9000ms
      mockAttempt = 3;
      mockStepId = 'backoff-step-3';
      try {
        await sendDunningEmail({
          to: 'customer@example.com',
          customerId: 'cus_test',
          invoiceId: 'inv_backoff',
          attemptNumber: 1,
          webhookUrl: 'https://example.com/fix-payment',
        });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(RetryableError.is(error)).toBe(true);
        const retryableError = error as RetryableError;
        const delayMs = retryableError.retryAfter!.getTime() - Date.now();
        expect(delayMs).toBeGreaterThanOrEqual(8900);
        expect(delayMs).toBeLessThanOrEqual(9100);
      }
    });

    it('caps exponential backoff at 30 seconds for email service', async () => {
      mockEmailService.configure({
        transientFailureProbability: 1,
        simulateLatency: false,
      });

      // Test attempt 10: 10^2 * 1000 = 100000ms, but should be capped at 30000ms for email
      mockAttempt = 10;
      mockStepId = 'backoff-cap-step';
      try {
        await sendDunningEmail({
          to: 'customer@example.com',
          customerId: 'cus_test',
          invoiceId: 'inv_backoff_cap',
          attemptNumber: 1,
          webhookUrl: 'https://example.com/fix-payment',
        });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(RetryableError.is(error)).toBe(true);
        const retryableError = error as RetryableError;
        const delayMs = retryableError.retryAfter!.getTime() - Date.now();
        // Should be capped at 30000ms for email service
        expect(delayMs).toBeGreaterThanOrEqual(29900);
        expect(delayMs).toBeLessThanOrEqual(30100);
      }
    });
  });
});
