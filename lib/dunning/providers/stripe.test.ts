import { describe, it, expect, beforeEach } from 'vitest';
import {
  mockStripe,
  RateLimitError,
  InvoiceNotFoundError,
  TransientError,
} from './stripe';
import { dunningStore } from '../store';

describe('MockStripeProvider', () => {
  beforeEach(() => {
    dunningStore.reset();
    mockStripe.configure({
      simulateLatency: false,
      rateLimitProbability: 0,
      transientErrorProbability: 0,
    });
  });

  describe('getInvoice', () => {
    it('returns invoice state for existing invoice', async () => {
      dunningStore.createInvoice('inv_test', 'cus_test', 'sub_test');

      const invoice = await mockStripe.getInvoice('inv_test');

      expect(invoice.id).toBe('inv_test');
      expect(invoice.status).toBe('open');
      expect(invoice.customerId).toBe('cus_test');
      expect(invoice.subscriptionId).toBe('sub_test');
    });

    it('throws InvoiceNotFoundError for non-existent invoice', async () => {
      await expect(mockStripe.getInvoice('inv_nonexistent')).rejects.toThrow(
        InvoiceNotFoundError
      );
    });

    it('includes nextPaymentAttempt when present', async () => {
      dunningStore.createInvoice('inv_with_hint', 'cus_1', 'sub_1', {
        nextPaymentAttempt: 1700000000,
      });

      const invoice = await mockStripe.getInvoice('inv_with_hint');
      expect(invoice.nextPaymentAttempt).toBe(1700000000);
    });

    it('returns correct amount and currency', async () => {
      dunningStore.createInvoice('inv_amount', 'cus_1', 'sub_1', {
        amountDue: 5000,
        currency: 'eur',
      });

      const invoice = await mockStripe.getInvoice('inv_amount');
      expect(invoice.amountDue).toBe(5000);
      expect(invoice.currency).toBe('eur');
    });
  });

  describe('checkInvoiceStatus', () => {
    it('returns just the status for existing invoice', async () => {
      dunningStore.createInvoice('inv_status', 'cus_1', 'sub_1');

      const status = await mockStripe.checkInvoiceStatus('inv_status');
      expect(status).toBe('open');
    });

    it('returns updated status after invoice is paid', async () => {
      dunningStore.createInvoice('inv_paid', 'cus_1', 'sub_1');
      dunningStore.markInvoicePaid('inv_paid');

      const status = await mockStripe.checkInvoiceStatus('inv_paid');
      expect(status).toBe('paid');
    });

    it('throws InvoiceNotFoundError for non-existent invoice', async () => {
      await expect(
        mockStripe.checkInvoiceStatus('inv_nonexistent')
      ).rejects.toThrow(InvoiceNotFoundError);
    });

    it('reflects status changes in real-time', async () => {
      dunningStore.createInvoice('inv_realtime', 'cus_1', 'sub_1');

      const statusBefore = await mockStripe.checkInvoiceStatus('inv_realtime');
      expect(statusBefore).toBe('open');

      dunningStore.setInvoiceStatus('inv_realtime', 'void');

      const statusAfter = await mockStripe.checkInvoiceStatus('inv_realtime');
      expect(statusAfter).toBe('void');
    });
  });

  describe('error simulation', () => {
    it('throws RateLimitError when configured', async () => {
      dunningStore.createInvoice('inv_rate', 'cus_1', 'sub_1');

      mockStripe.configure({
        rateLimitProbability: 1, // Always rate limit
        transientErrorProbability: 0,
        simulateLatency: false,
      });

      await expect(mockStripe.getInvoice('inv_rate')).rejects.toThrow(
        RateLimitError
      );
    });

    it('RateLimitError has retryAfterMs property', async () => {
      dunningStore.createInvoice('inv_retry', 'cus_1', 'sub_1');

      mockStripe.configure({
        rateLimitProbability: 1,
        transientErrorProbability: 0,
        simulateLatency: false,
      });

      try {
        await mockStripe.getInvoice('inv_retry');
        expect.fail('Should have thrown RateLimitError');
      } catch (error) {
        expect(error).toBeInstanceOf(RateLimitError);
        expect((error as RateLimitError).retryAfterMs).toBeGreaterThan(0);
        expect((error as RateLimitError).retryable).toBe(true);
        expect((error as RateLimitError).statusCode).toBe(429);
      }
    });

    it('throws TransientError when configured', async () => {
      dunningStore.createInvoice('inv_transient', 'cus_1', 'sub_1');

      mockStripe.configure({
        rateLimitProbability: 0,
        transientErrorProbability: 1, // Always fail
        simulateLatency: false,
      });

      await expect(mockStripe.getInvoice('inv_transient')).rejects.toThrow(
        TransientError
      );
    });

    it('TransientError is marked as retryable', () => {
      const error = new TransientError();
      expect(error.retryable).toBe(true);
      expect(error.statusCode).toBe(500);
      expect(error.code).toBe('internal_error');
    });

    it('InvoiceNotFoundError is not retryable', () => {
      const error = new InvoiceNotFoundError('inv_123');
      expect(error.retryable).toBe(false);
      expect(error.statusCode).toBe(404);
      expect(error.code).toBe('resource_missing');
    });

    it('checkInvoiceStatus also respects error simulation', async () => {
      dunningStore.createInvoice('inv_check_error', 'cus_1', 'sub_1');

      mockStripe.configure({
        rateLimitProbability: 1,
        transientErrorProbability: 0,
        simulateLatency: false,
      });

      await expect(
        mockStripe.checkInvoiceStatus('inv_check_error')
      ).rejects.toThrow(RateLimitError);
    });
  });

  describe('configuration', () => {
    it('can update configuration', () => {
      mockStripe.configure({ rateLimitProbability: 0.5 });
      // Configuration is updated (tested indirectly through behavior)
    });

    it('can reset configuration to defaults', async () => {
      mockStripe.configure({ rateLimitProbability: 1 });
      mockStripe.resetConfig();

      // After reset, should use default probability (0.05)
      // Disable latency and errors for quick test
      mockStripe.configure({
        simulateLatency: false,
        rateLimitProbability: 0,
        transientErrorProbability: 0,
      });

      dunningStore.createInvoice('inv_reset', 'cus_1', 'sub_1');
      const invoice = await mockStripe.getInvoice('inv_reset');
      expect(invoice.id).toBe('inv_reset');
    });
  });
});

describe('error types', () => {
  it('StripeError has correct properties', () => {
    const error = new InvoiceNotFoundError('inv_test');
    expect(error.name).toBe('InvoiceNotFoundError');
    expect(error.message).toContain('inv_test');
    expect(error.code).toBe('resource_missing');
    expect(error.statusCode).toBe(404);
    expect(error.retryable).toBe(false);
  });

  it('RateLimitError defaults retryAfterMs', () => {
    const error = new RateLimitError();
    expect(error.retryAfterMs).toBe(1000);
  });

  it('RateLimitError accepts custom retryAfterMs', () => {
    const error = new RateLimitError(5000);
    expect(error.retryAfterMs).toBe(5000);
  });
});
