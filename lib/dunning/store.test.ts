import { describe, it, expect, beforeEach } from 'vitest';
import { DunningStore } from './store';
import type { InvoiceState } from './types';

describe('DunningStore', () => {
  let store: DunningStore;

  beforeEach(() => {
    store = new DunningStore();
  });

  describe('invoice operations', () => {
    const testInvoice: InvoiceState = {
      id: 'inv_123',
      status: 'open',
      amountDue: 9900,
      currency: 'usd',
      customerId: 'cus_123',
      subscriptionId: 'sub_123',
    };

    it('returns undefined for non-existent invoice', () => {
      expect(store.getInvoice('inv_nonexistent')).toBeUndefined();
    });

    it('sets and gets an invoice', () => {
      store.setInvoice(testInvoice);
      const retrieved = store.getInvoice('inv_123');
      expect(retrieved).toEqual(testInvoice);
    });

    it('updates invoice status', () => {
      store.setInvoice(testInvoice);
      const updated = store.setInvoiceStatus('inv_123', 'paid');
      expect(updated).toBe(true);
      expect(store.getInvoice('inv_123')?.status).toBe('paid');
    });

    it('returns false when updating non-existent invoice status', () => {
      const updated = store.setInvoiceStatus('inv_nonexistent', 'paid');
      expect(updated).toBe(false);
    });

    it('marks invoice as paid', () => {
      store.setInvoice(testInvoice);
      const marked = store.markInvoicePaid('inv_123');
      expect(marked).toBe(true);
      expect(store.getInvoice('inv_123')?.status).toBe('paid');
    });

    it('creates a default invoice', () => {
      const invoice = store.createInvoice('inv_new', 'cus_new', 'sub_new');
      expect(invoice.id).toBe('inv_new');
      expect(invoice.status).toBe('open');
      expect(invoice.amountDue).toBe(9900);
      expect(store.getInvoice('inv_new')).toEqual(invoice);
    });

    it('creates invoice with custom options', () => {
      const invoice = store.createInvoice('inv_custom', 'cus_1', 'sub_1', {
        amountDue: 5000,
        currency: 'eur',
        status: 'open',
      });
      expect(invoice.amountDue).toBe(5000);
      expect(invoice.currency).toBe('eur');
    });
  });

  describe('workflow run operations', () => {
    it('sets and gets a workflow run', () => {
      const run = {
        runId: 'run_123',
        invoiceId: 'inv_123',
        customerId: 'cus_123',
        subscriptionId: 'sub_123',
        currentAttempt: 1,
        state: 'running' as const,
        startedAt: Date.now(),
      };
      store.setWorkflowRun(run);
      expect(store.getWorkflowRun('run_123')).toEqual(run);
    });

    it('gets workflow run by invoice ID', () => {
      const run1 = {
        runId: 'run_1',
        invoiceId: 'inv_123',
        customerId: 'cus_123',
        subscriptionId: 'sub_123',
        currentAttempt: 1,
        state: 'completed' as const,
        startedAt: Date.now() - 1000,
      };
      const run2 = {
        runId: 'run_2',
        invoiceId: 'inv_123',
        customerId: 'cus_123',
        subscriptionId: 'sub_123',
        currentAttempt: 2,
        state: 'running' as const,
        startedAt: Date.now(),
      };
      store.setWorkflowRun(run1);
      store.setWorkflowRun(run2);

      const found = store.getWorkflowRunByInvoice('inv_123');
      expect(found?.runId).toBe('run_2'); // Most recent
    });

    it('updates workflow run', () => {
      const run = {
        runId: 'run_update',
        invoiceId: 'inv_123',
        customerId: 'cus_123',
        subscriptionId: 'sub_123',
        currentAttempt: 1,
        state: 'running' as const,
        startedAt: Date.now(),
      };
      store.setWorkflowRun(run);

      const updated = store.updateWorkflowRun('run_update', {
        state: 'completed',
        outcome: 'recovered',
      });
      expect(updated?.state).toBe('completed');
      expect(updated?.outcome).toBe('recovered');
    });
  });

  describe('email logging', () => {
    const emailData = {
      to: 'user@example.com',
      customerId: 'cus_123',
      invoiceId: 'inv_123',
      escalationLevel: 0,
      webhookUrl: 'https://example.com/webhook',
      idempotencyKey: 'email_key_1',
    };

    it('logs an email', () => {
      const logged = store.logEmail(emailData);
      expect(logged).not.toBeNull();
      expect(logged?.to).toBe('user@example.com');
      expect(logged?.id).toBeDefined();
      expect(logged?.sentAt).toBeDefined();
    });

    it('prevents duplicate emails by idempotency key', () => {
      const first = store.logEmail(emailData);
      const second = store.logEmail(emailData);
      expect(first).not.toBeNull();
      expect(second).toBeNull();
    });

    it('checks if email was sent', () => {
      expect(store.wasEmailSent('email_key_1')).toBe(false);
      store.logEmail(emailData);
      expect(store.wasEmailSent('email_key_1')).toBe(true);
    });

    it('gets all email logs', () => {
      store.logEmail(emailData);
      store.logEmail({ ...emailData, idempotencyKey: 'email_key_2' });
      const logs = store.getEmailLogs();
      expect(logs).toHaveLength(2);
    });

    it('filters email logs by invoice ID', () => {
      store.logEmail(emailData);
      store.logEmail({
        ...emailData,
        invoiceId: 'inv_456',
        idempotencyKey: 'email_key_2',
      });
      const logs = store.getEmailLogs('inv_123');
      expect(logs).toHaveLength(1);
      expect(logs[0].invoiceId).toBe('inv_123');
    });
  });

  describe('subscription operations', () => {
    it('logs subscription operation', () => {
      const logged = store.logSubscriptionOperation({
        type: 'pause',
        targetId: 'sub_123',
        idempotencyKey: 'op_key_1',
      });
      expect(logged).not.toBeNull();
      expect(logged?.type).toBe('pause');
    });

    it('prevents duplicate operations by idempotency key', () => {
      const first = store.logSubscriptionOperation({
        type: 'pause',
        targetId: 'sub_123',
        idempotencyKey: 'op_key_1',
      });
      const second = store.logSubscriptionOperation({
        type: 'pause',
        targetId: 'sub_123',
        idempotencyKey: 'op_key_1',
      });
      expect(first).not.toBeNull();
      expect(second).toBeNull();
    });

    it('tracks restricted customers', () => {
      expect(store.isCustomerRestricted('cus_123')).toBe(false);
      store.logSubscriptionOperation({
        type: 'restrict_access',
        targetId: 'cus_123',
        idempotencyKey: 'restrict_1',
      });
      expect(store.isCustomerRestricted('cus_123')).toBe(true);
    });

    it('tracks paused subscriptions', () => {
      expect(store.isSubscriptionPaused('sub_123')).toBe(false);
      store.logSubscriptionOperation({
        type: 'pause',
        targetId: 'sub_123',
        idempotencyKey: 'pause_1',
      });
      expect(store.isSubscriptionPaused('sub_123')).toBe(true);
    });

    it('tracks canceled subscriptions', () => {
      expect(store.isSubscriptionCanceled('sub_123')).toBe(false);
      store.logSubscriptionOperation({
        type: 'cancel',
        targetId: 'sub_123',
        idempotencyKey: 'cancel_1',
      });
      expect(store.isSubscriptionCanceled('sub_123')).toBe(true);
    });
  });

  describe('event processing', () => {
    it('marks event as processed', () => {
      expect(store.hasProcessedEvent('evt_123')).toBe(false);
      const marked = store.markEventProcessed('evt_123');
      expect(marked).toBe(true);
      expect(store.hasProcessedEvent('evt_123')).toBe(true);
    });

    it('returns false for duplicate event processing', () => {
      store.markEventProcessed('evt_123');
      const second = store.markEventProcessed('evt_123');
      expect(second).toBe(false);
    });
  });

  describe('state management', () => {
    it('returns full state', () => {
      store.createInvoice('inv_1', 'cus_1', 'sub_1');
      const state = store.getState();
      expect(state.invoices.has('inv_1')).toBe(true);
    });

    it('returns serializable state', () => {
      store.createInvoice('inv_1', 'cus_1', 'sub_1');
      store.markEventProcessed('evt_1');
      const state = store.getSerializableState();
      expect(state.invoices).toHaveProperty('inv_1');
      expect(state.processedEventIds).toContain('evt_1');
    });

    it('resets all state', () => {
      store.createInvoice('inv_1', 'cus_1', 'sub_1');
      store.markEventProcessed('evt_1');
      store.logEmail({
        to: 'test@test.com',
        customerId: 'cus_1',
        invoiceId: 'inv_1',
        escalationLevel: 0,
        webhookUrl: 'http://test',
        idempotencyKey: 'key_1',
      });

      store.reset();

      expect(store.getInvoice('inv_1')).toBeUndefined();
      expect(store.hasProcessedEvent('evt_1')).toBe(false);
      expect(store.getEmailLogs()).toHaveLength(0);
    });
  });
});
