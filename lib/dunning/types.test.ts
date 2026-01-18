import { describe, it, expect } from 'vitest';
import {
  type EmailEscalationLevel,
  type InvoiceState,
  type DunningConfig,
  type DunningWorkflowInput,
  type DunningResult,
  DEFAULT_RETRY_SCHEDULE,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_FINAL_ACTION,
  DEFAULT_RESTRICT_ACCESS_AFTER_ATTEMPT,
} from './types';

describe('types.ts', () => {
  describe('default constants', () => {
    it('exports DEFAULT_RETRY_SCHEDULE as ["1d", "3d", "7d"]', () => {
      expect(DEFAULT_RETRY_SCHEDULE).toEqual(['1d', '3d', '7d']);
    });

    it('exports DEFAULT_MAX_ATTEMPTS as 3', () => {
      expect(DEFAULT_MAX_ATTEMPTS).toBe(3);
    });

    it('exports DEFAULT_FINAL_ACTION as "pause"', () => {
      expect(DEFAULT_FINAL_ACTION).toBe('pause');
    });

    it('exports DEFAULT_RESTRICT_ACCESS_AFTER_ATTEMPT as 2', () => {
      expect(DEFAULT_RESTRICT_ACCESS_AFTER_ATTEMPT).toBe(2);
    });
  });

  describe('type usage', () => {
    it('allows creating a valid EmailEscalationLevel', () => {
      const level0: EmailEscalationLevel = 0;
      const level1: EmailEscalationLevel = 1;
      const level2: EmailEscalationLevel = 2;
      expect([level0, level1, level2]).toEqual([0, 1, 2]);
    });

    it('allows creating a valid InvoiceState', () => {
      const invoice: InvoiceState = {
        id: 'inv_123',
        status: 'open',
        amountDue: 9900,
        currency: 'usd',
        customerId: 'cus_123',
        subscriptionId: 'sub_123',
      };
      expect(invoice.id).toBe('inv_123');
      expect(invoice.status).toBe('open');
    });

    it('allows creating an InvoiceState with optional nextPaymentAttempt', () => {
      const invoice: InvoiceState = {
        id: 'inv_123',
        status: 'open',
        amountDue: 9900,
        currency: 'usd',
        customerId: 'cus_123',
        subscriptionId: 'sub_123',
        nextPaymentAttempt: 1700000000,
      };
      expect(invoice.nextPaymentAttempt).toBe(1700000000);
    });

    it('allows creating a valid DunningConfig with all optional fields', () => {
      const config: DunningConfig = {
        retrySchedule: ['2d', '5d'],
        maxAttempts: 2,
        gracePeriod: '14d',
        finalAction: 'cancel',
        restrictAccessAfterAttempt: 1,
      };
      expect(config.retrySchedule).toEqual(['2d', '5d']);
      expect(config.finalAction).toBe('cancel');
    });

    it('allows creating a DunningConfig with no fields (all optional)', () => {
      const config: DunningConfig = {};
      expect(config).toEqual({});
    });

    it('allows creating a valid DunningWorkflowInput', () => {
      const input: DunningWorkflowInput = {
        provider: 'stripe',
        invoiceId: 'inv_123',
        customerId: 'cus_123',
        subscriptionId: 'sub_123',
      };
      expect(input.provider).toBe('stripe');
      expect(input.invoiceId).toBe('inv_123');
    });

    it('allows creating a DunningWorkflowInput with optional config', () => {
      const input: DunningWorkflowInput = {
        provider: 'stripe',
        invoiceId: 'inv_123',
        customerId: 'cus_123',
        subscriptionId: 'sub_123',
        config: {
          maxAttempts: 5,
          finalAction: 'mark_unpaid',
        },
      };
      expect(input.config?.maxAttempts).toBe(5);
    });

    it('allows creating a DunningResult with recovered outcome', () => {
      const result: DunningResult = {
        invoiceId: 'inv_123',
        outcome: 'recovered',
        attemptsUsed: 2,
      };
      expect(result.outcome).toBe('recovered');
      expect(result.finalAction).toBeUndefined();
    });

    it('allows creating a DunningResult with exhausted outcome and finalAction', () => {
      const result: DunningResult = {
        invoiceId: 'inv_123',
        outcome: 'exhausted',
        finalAction: 'pause',
        attemptsUsed: 3,
      };
      expect(result.outcome).toBe('exhausted');
      expect(result.finalAction).toBe('pause');
    });
  });
});
