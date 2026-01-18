/**
 * Tests for the state dump endpoint.
 *
 * This endpoint allows developers to inspect the full mock store state for
 * debugging and test verification. It returns all invoices, email logs,
 * workflow runs, and subscription operations in a single JSON response.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GET } from '../route';
import { dunningStore } from '@/lib/dunning/store';

describe('GET /api/test/state', () => {
  beforeEach(() => {
    dunningStore.reset();
  });

  describe('empty state', () => {
    it('returns empty state with summary when store is empty', async () => {
      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.invoices).toEqual({});
      expect(data.workflowRuns).toEqual({});
      expect(data.emailLogs).toEqual([]);
      expect(data.subscriptionOperations).toEqual([]);
      expect(data.processedEventIds).toEqual([]);
      expect(data.restrictedCustomers).toEqual([]);
      expect(data.pausedSubscriptions).toEqual([]);
      expect(data.canceledSubscriptions).toEqual([]);

      // Verify summary counts
      expect(data._summary.invoiceCount).toBe(0);
      expect(data._summary.workflowRunCount).toBe(0);
      expect(data._summary.emailLogCount).toBe(0);
      expect(data._summary.subscriptionOperationCount).toBe(0);
    });
  });

  describe('populated state', () => {
    it('returns all invoices in the store', async () => {
      dunningStore.createInvoice('inv_state_001', 'cus_001', 'sub_001', {
        status: 'open',
        amountDue: 9900,
        currency: 'usd',
      });
      dunningStore.createInvoice('inv_state_002', 'cus_002', 'sub_002', {
        status: 'paid',
        amountDue: 4999,
        currency: 'usd',
      });

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data._summary.invoiceCount).toBe(2);
      expect(data.invoices.inv_state_001).toBeDefined();
      expect(data.invoices.inv_state_001.status).toBe('open');
      expect(data.invoices.inv_state_001.customerId).toBe('cus_001');
      expect(data.invoices.inv_state_002.status).toBe('paid');
    });

    it('returns all workflow runs in the store', async () => {
      dunningStore.setWorkflowRun({
        runId: 'run_state_001',
        invoiceId: 'inv_001',
        customerId: 'cus_001',
        subscriptionId: 'sub_001',
        currentAttempt: 2,
        state: 'running',
        startedAt: 1000000,
      });
      dunningStore.setWorkflowRun({
        runId: 'run_state_002',
        invoiceId: 'inv_002',
        customerId: 'cus_002',
        subscriptionId: 'sub_002',
        currentAttempt: 3,
        state: 'completed',
        outcome: 'exhausted',
        finalAction: 'pause',
        startedAt: 900000,
        completedAt: 950000,
      });

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data._summary.workflowRunCount).toBe(2);
      expect(data.workflowRuns.run_state_001.state).toBe('running');
      expect(data.workflowRuns.run_state_001.currentAttempt).toBe(2);
      expect(data.workflowRuns.run_state_002.state).toBe('completed');
      expect(data.workflowRuns.run_state_002.outcome).toBe('exhausted');
      expect(data.workflowRuns.run_state_002.finalAction).toBe('pause');
    });

    it('returns all email logs in the store', async () => {
      dunningStore.logEmail({
        idempotencyKey: 'email_key_001',
        to: 'customer1@example.com',
        customerId: 'cus_001',
        invoiceId: 'inv_001',
        escalationLevel: 0,
        webhookUrl: 'https://example.com/pay/inv_001',
      });
      dunningStore.logEmail({
        idempotencyKey: 'email_key_002',
        to: 'customer2@example.com',
        customerId: 'cus_002',
        invoiceId: 'inv_002',
        escalationLevel: 2,
        webhookUrl: 'https://example.com/pay/inv_002',
      });

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data._summary.emailLogCount).toBe(2);
      expect(data.emailLogs).toHaveLength(2);
      expect(data.emailLogs[0].to).toBe('customer1@example.com');
      expect(data.emailLogs[0].escalationLevel).toBe(0);
      expect(data.emailLogs[1].escalationLevel).toBe(2);
    });

    it('returns all subscription operations in the store', async () => {
      dunningStore.logSubscriptionOperation({
        type: 'pause',
        targetId: 'sub_001',
        idempotencyKey: 'op_pause_001',
      });
      dunningStore.logSubscriptionOperation({
        type: 'restrict_access',
        targetId: 'cus_001',
        idempotencyKey: 'op_restrict_001',
      });
      dunningStore.logSubscriptionOperation({
        type: 'cancel',
        targetId: 'sub_002',
        idempotencyKey: 'op_cancel_001',
      });

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data._summary.subscriptionOperationCount).toBe(3);
      expect(data.subscriptionOperations).toHaveLength(3);
      expect(data.subscriptionOperations[0].type).toBe('pause');
      expect(data.subscriptionOperations[1].type).toBe('restrict_access');
      expect(data.subscriptionOperations[2].type).toBe('cancel');
    });

    it('returns processed event IDs', async () => {
      dunningStore.markEventProcessed('evt_stripe_001');
      dunningStore.markEventProcessed('evt_stripe_002');
      dunningStore.markEventProcessed('evt_stripe_003');

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data._summary.processedEventCount).toBe(3);
      expect(data.processedEventIds).toContain('evt_stripe_001');
      expect(data.processedEventIds).toContain('evt_stripe_002');
      expect(data.processedEventIds).toContain('evt_stripe_003');
    });

    it('returns restricted customers', async () => {
      // Restrict access through subscription operation
      dunningStore.logSubscriptionOperation({
        type: 'restrict_access',
        targetId: 'cus_restricted_001',
        idempotencyKey: 'op_restrict_001',
      });
      dunningStore.logSubscriptionOperation({
        type: 'restrict_access',
        targetId: 'cus_restricted_002',
        idempotencyKey: 'op_restrict_002',
      });

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data._summary.restrictedCustomerCount).toBe(2);
      expect(data.restrictedCustomers).toContain('cus_restricted_001');
      expect(data.restrictedCustomers).toContain('cus_restricted_002');
    });

    it('returns paused and canceled subscriptions', async () => {
      dunningStore.logSubscriptionOperation({
        type: 'pause',
        targetId: 'sub_paused_001',
        idempotencyKey: 'op_pause_001',
      });
      dunningStore.logSubscriptionOperation({
        type: 'cancel',
        targetId: 'sub_canceled_001',
        idempotencyKey: 'op_cancel_001',
      });

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data._summary.pausedSubscriptionCount).toBe(1);
      expect(data._summary.canceledSubscriptionCount).toBe(1);
      expect(data.pausedSubscriptions).toContain('sub_paused_001');
      expect(data.canceledSubscriptions).toContain('sub_canceled_001');
    });
  });

  describe('state inspection use cases', () => {
    it('allows inspection of complete dunning scenario state', async () => {
      // Set up a complete dunning scenario
      const invoiceId = 'inv_scenario_001';
      const customerId = 'cus_scenario_001';
      const subscriptionId = 'sub_scenario_001';

      // 1. Create invoice
      dunningStore.createInvoice(invoiceId, customerId, subscriptionId, {
        status: 'open',
        amountDue: 9999,
        currency: 'usd',
      });

      // 2. Track Stripe event
      dunningStore.markEventProcessed('evt_payment_failed_001');

      // 3. Start workflow
      dunningStore.setWorkflowRun({
        runId: 'run_scenario_001',
        invoiceId,
        customerId,
        subscriptionId,
        currentAttempt: 3,
        state: 'running',
        startedAt: Date.now() - 100000,
      });

      // 4. Email logs
      dunningStore.logEmail({
        idempotencyKey: 'email_scenario_001',
        to: `${customerId}@example.com`,
        customerId,
        invoiceId,
        escalationLevel: 0,
        webhookUrl: `https://example.com/pay/${invoiceId}`,
      });
      dunningStore.logEmail({
        idempotencyKey: 'email_scenario_002',
        to: `${customerId}@example.com`,
        customerId,
        invoiceId,
        escalationLevel: 1,
        webhookUrl: `https://example.com/pay/${invoiceId}`,
      });

      // 5. Access restricted
      dunningStore.logSubscriptionOperation({
        type: 'restrict_access',
        targetId: customerId,
        idempotencyKey: 'restrict_scenario_001',
      });

      // Now inspect state
      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);

      // Verify full scenario state
      expect(data._summary.invoiceCount).toBe(1);
      expect(data._summary.workflowRunCount).toBe(1);
      expect(data._summary.emailLogCount).toBe(2);
      expect(data._summary.subscriptionOperationCount).toBe(1);
      expect(data._summary.processedEventCount).toBe(1);
      expect(data._summary.restrictedCustomerCount).toBe(1);

      expect(data.invoices[invoiceId].status).toBe('open');
      expect(data.workflowRuns.run_scenario_001.currentAttempt).toBe(3);
      expect(data.restrictedCustomers).toContain(customerId);
    });

    it('reflects state changes after operations', async () => {
      // Initial state
      let response = await GET();
      let data = await response.json();
      expect(data._summary.invoiceCount).toBe(0);

      // Add an invoice
      dunningStore.createInvoice('inv_change_001', 'cus_001', 'sub_001');

      response = await GET();
      data = await response.json();
      expect(data._summary.invoiceCount).toBe(1);
      expect(data.invoices.inv_change_001.status).toBe('open');

      // Mark invoice as paid
      dunningStore.markInvoicePaid('inv_change_001');

      response = await GET();
      data = await response.json();
      expect(data.invoices.inv_change_001.status).toBe('paid');

      // Reset store
      dunningStore.reset();

      response = await GET();
      data = await response.json();
      expect(data._summary.invoiceCount).toBe(0);
    });
  });
});
