/**
 * Tests for checkInvoiceStatus step function.
 *
 * These tests verify:
 * 1. Success path - returns invoice state when invoice exists
 * 2. FatalError on 404 - throws FatalError when invoice not found
 * 3. RetryableError on transient failures - allows retry for 5xx, rate limits
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FatalError, RetryableError } from 'workflow';
import { checkInvoiceStatus } from './check-invoice-status';
import { dunningStore } from '../store';
import { mockStripe, MockStripeProvider } from '../providers/stripe';

// Mock getStepMetadata since we're testing outside of workflow runtime
vi.mock('workflow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('workflow')>();
  return {
    ...actual,
    getStepMetadata: () => ({
      stepId: 'test-step-id',
      stepStartedAt: new Date(),
      attempt: 1,
    }),
  };
});

describe('checkInvoiceStatus step', () => {
  beforeEach(() => {
    // Reset store and stripe config before each test
    dunningStore.reset();
    mockStripe.resetConfig();
    // Disable random failures for predictable tests
    mockStripe.configure({
      rateLimitProbability: 0,
      transientErrorProbability: 0,
      simulateLatency: false,
    });
  });

  describe('success path', () => {
    it('returns invoice state when invoice exists', async () => {
      // Setup: create an invoice in the store
      const invoiceId = 'inv_test_success';
      dunningStore.setInvoice({
        id: invoiceId,
        status: 'open',
        amountDue: 9900,
        currency: 'usd',
        customerId: 'cus_test',
        subscriptionId: 'sub_test',
      });

      // Execute
      const result = await checkInvoiceStatus(invoiceId);

      // Verify
      expect(result).toEqual({
        id: invoiceId,
        status: 'open',
        amountDue: 9900,
        currency: 'usd',
        customerId: 'cus_test',
        subscriptionId: 'sub_test',
      });
    });

    it('returns paid status when invoice is paid', async () => {
      // Setup: create a paid invoice
      const invoiceId = 'inv_test_paid';
      dunningStore.setInvoice({
        id: invoiceId,
        status: 'paid',
        amountDue: 0,
        currency: 'usd',
        customerId: 'cus_test',
        subscriptionId: 'sub_test',
      });

      // Execute
      const result = await checkInvoiceStatus(invoiceId);

      // Verify
      expect(result.status).toBe('paid');
    });
  });

  describe('FatalError on 404', () => {
    it('throws FatalError when invoice does not exist', async () => {
      // Setup: no invoice in store
      const invoiceId = 'inv_nonexistent';

      // Execute & Verify
      await expect(checkInvoiceStatus(invoiceId)).rejects.toThrow(FatalError);
      await expect(checkInvoiceStatus(invoiceId)).rejects.toThrow(
        `Invoice not found: ${invoiceId}`
      );
    });

    it('FatalError has correct properties', async () => {
      const invoiceId = 'inv_missing';

      try {
        await checkInvoiceStatus(invoiceId);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(FatalError.is(error)).toBe(true);
        expect((error as FatalError).fatal).toBe(true);
      }
    });
  });

  describe('RetryableError on transient failures', () => {
    it('throws RetryableError on rate limit (429)', async () => {
      // Setup: invoice exists but rate limit will trigger
      const invoiceId = 'inv_rate_limited';
      dunningStore.setInvoice({
        id: invoiceId,
        status: 'open',
        amountDue: 5000,
        currency: 'usd',
        customerId: 'cus_test',
        subscriptionId: 'sub_test',
      });

      // Configure 100% rate limit probability
      mockStripe.configure({
        rateLimitProbability: 1,
        transientErrorProbability: 0,
        simulateLatency: false,
      });

      // Execute & Verify
      await expect(checkInvoiceStatus(invoiceId)).rejects.toThrow(RetryableError);
      await expect(checkInvoiceStatus(invoiceId)).rejects.toThrow(/Rate limited/);
    });

    it('RetryableError from rate limit has retryAfter', async () => {
      const invoiceId = 'inv_rate_limited_2';
      dunningStore.setInvoice({
        id: invoiceId,
        status: 'open',
        amountDue: 5000,
        currency: 'usd',
        customerId: 'cus_test',
        subscriptionId: 'sub_test',
      });

      mockStripe.configure({
        rateLimitProbability: 1,
        transientErrorProbability: 0,
        simulateLatency: false,
      });

      try {
        await checkInvoiceStatus(invoiceId);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(RetryableError.is(error)).toBe(true);
        expect((error as RetryableError).retryAfter).toBeInstanceOf(Date);
      }
    });

    it('throws RetryableError on transient 5xx error', async () => {
      // Setup: invoice exists but transient error will trigger
      const invoiceId = 'inv_transient_error';
      dunningStore.setInvoice({
        id: invoiceId,
        status: 'open',
        amountDue: 5000,
        currency: 'usd',
        customerId: 'cus_test',
        subscriptionId: 'sub_test',
      });

      // Configure 100% transient error probability
      mockStripe.configure({
        rateLimitProbability: 0,
        transientErrorProbability: 1,
        simulateLatency: false,
      });

      // Execute & Verify
      await expect(checkInvoiceStatus(invoiceId)).rejects.toThrow(RetryableError);
      await expect(checkInvoiceStatus(invoiceId)).rejects.toThrow(/Transient error/);
    });

    it('recovers after transient failure is cleared', async () => {
      const invoiceId = 'inv_recovery';
      dunningStore.setInvoice({
        id: invoiceId,
        status: 'open',
        amountDue: 5000,
        currency: 'usd',
        customerId: 'cus_test',
        subscriptionId: 'sub_test',
      });

      // First call - transient error
      mockStripe.configure({
        rateLimitProbability: 0,
        transientErrorProbability: 1,
        simulateLatency: false,
      });

      await expect(checkInvoiceStatus(invoiceId)).rejects.toThrow(RetryableError);

      // Second call - success (simulates retry)
      mockStripe.configure({
        rateLimitProbability: 0,
        transientErrorProbability: 0,
        simulateLatency: false,
      });

      const result = await checkInvoiceStatus(invoiceId);
      expect(result.status).toBe('open');
    });
  });

  describe('edge cases', () => {
    it('handles invoice with nextPaymentAttempt field', async () => {
      const invoiceId = 'inv_with_next_attempt';
      const nextAttempt = Date.now() + 86400000; // tomorrow
      dunningStore.setInvoice({
        id: invoiceId,
        status: 'open',
        amountDue: 9900,
        currency: 'usd',
        customerId: 'cus_test',
        subscriptionId: 'sub_test',
        nextPaymentAttempt: nextAttempt,
      });

      const result = await checkInvoiceStatus(invoiceId);
      expect(result.nextPaymentAttempt).toBe(nextAttempt);
    });
  });
});
