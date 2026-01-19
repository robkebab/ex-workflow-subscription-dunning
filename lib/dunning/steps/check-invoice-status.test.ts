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

// Track attempt number for exponential backoff tests
let mockAttempt = 1;

// Mock getStepMetadata since we're testing outside of workflow runtime
vi.mock('workflow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('workflow')>();
  return {
    ...actual,
    getStepMetadata: () => ({
      stepId: 'test-step-id',
      stepStartedAt: new Date(),
      attempt: mockAttempt,
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
    // Reset attempt to 1 before each test
    mockAttempt = 1;
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

  describe('exponential backoff', () => {
    it('uses exponential backoff for transient errors based on attempt number', async () => {
      const invoiceId = 'inv_backoff';
      dunningStore.setInvoice({
        id: invoiceId,
        status: 'open',
        amountDue: 5000,
        currency: 'usd',
        customerId: 'cus_test',
        subscriptionId: 'sub_test',
      });

      mockStripe.configure({
        rateLimitProbability: 0,
        transientErrorProbability: 1,
        simulateLatency: false,
      });

      // Test attempt 1: delay should be 1^2 * 1000 = 1000ms
      mockAttempt = 1;
      try {
        await checkInvoiceStatus(invoiceId);
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
      try {
        await checkInvoiceStatus(invoiceId);
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
      try {
        await checkInvoiceStatus(invoiceId);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(RetryableError.is(error)).toBe(true);
        const retryableError = error as RetryableError;
        const delayMs = retryableError.retryAfter!.getTime() - Date.now();
        expect(delayMs).toBeGreaterThanOrEqual(8900);
        expect(delayMs).toBeLessThanOrEqual(9100);
      }
    });

    it('caps exponential backoff at 60 seconds', async () => {
      const invoiceId = 'inv_backoff_cap';
      dunningStore.setInvoice({
        id: invoiceId,
        status: 'open',
        amountDue: 5000,
        currency: 'usd',
        customerId: 'cus_test',
        subscriptionId: 'sub_test',
      });

      mockStripe.configure({
        rateLimitProbability: 0,
        transientErrorProbability: 1,
        simulateLatency: false,
      });

      // Test attempt 10: 10^2 * 1000 = 100000ms, but should be capped at 60000ms
      mockAttempt = 10;
      try {
        await checkInvoiceStatus(invoiceId);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(RetryableError.is(error)).toBe(true);
        const retryableError = error as RetryableError;
        const delayMs = retryableError.retryAfter!.getTime() - Date.now();
        // Should be capped at 60000ms
        expect(delayMs).toBeGreaterThanOrEqual(59900);
        expect(delayMs).toBeLessThanOrEqual(60100);
      }
    });
  });
});
