/**
 * Tests for executeFinalAction step function.
 *
 * These tests verify:
 * 1. Pause action - pauses a subscription
 * 2. Cancel action - cancels a subscription
 * 3. Mark unpaid action - marks invoice as uncollectible
 * 4. Idempotency - uses stepId to prevent duplicate operations
 *
 * The final action step is critical because it determines the end state
 * of a subscription after all dunning attempts are exhausted. Each action
 * type has different implications for the customer and business.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FatalError, RetryableError } from 'workflow';
import { executeFinalAction, type FinalAction } from './execute-final-action';
import { dunningStore } from '../store';
import { mockSubscriptionService } from '../providers/subscription';

// Track stepId for idempotency tests
let mockStepId = 'test-step-id';

// Mock getStepMetadata since we're testing outside of workflow runtime
vi.mock('workflow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('workflow')>();
  return {
    ...actual,
    getStepMetadata: () => ({
      stepId: mockStepId,
      stepStartedAt: new Date(),
      attempt: 1,
    }),
  };
});

describe('executeFinalAction step', () => {
  beforeEach(() => {
    // Reset store and subscription service config before each test
    dunningStore.reset();
    mockSubscriptionService.resetConfig();
    // Disable latency for predictable tests
    mockSubscriptionService.configure({
      simulateLatency: false,
    });
    // Reset stepId to unique value per test
    mockStepId = 'test-step-id-' + Math.random().toString(36).slice(2);
  });

  describe('pause action', () => {
    it('pauses a subscription successfully', async () => {
      const result = await executeFinalAction({
        action: 'pause',
        subscriptionId: 'sub_test',
        invoiceId: 'inv_test',
        customerId: 'cus_test',
      });

      expect(result.executed).toBe(true);
      expect(result.action).toBe('pause');
      expect(result.targetId).toBe('sub_test');
      expect(result.reason).toBeUndefined();
    });

    it('logs pause operation in the store', async () => {
      await executeFinalAction({
        action: 'pause',
        subscriptionId: 'sub_logged',
        invoiceId: 'inv_logged',
        customerId: 'cus_logged',
      });

      const ops = dunningStore.getSubscriptionOperations();
      const pauseOp = ops.find(
        op => op.type === 'pause' && op.targetId === 'sub_logged'
      );
      expect(pauseOp).toBeDefined();
    });

    it('marks subscription as paused in store', async () => {
      expect(dunningStore.isSubscriptionPaused('sub_state')).toBe(false);

      await executeFinalAction({
        action: 'pause',
        subscriptionId: 'sub_state',
        invoiceId: 'inv_state',
        customerId: 'cus_state',
      });

      expect(dunningStore.isSubscriptionPaused('sub_state')).toBe(true);
    });

    it('returns already_in_state when subscription is already paused', async () => {
      // First pause
      mockStepId = 'pause-step-1';
      await executeFinalAction({
        action: 'pause',
        subscriptionId: 'sub_already',
        invoiceId: 'inv_already',
        customerId: 'cus_already',
      });

      // Second pause with different stepId
      mockStepId = 'pause-step-2';
      const result = await executeFinalAction({
        action: 'pause',
        subscriptionId: 'sub_already',
        invoiceId: 'inv_already',
        customerId: 'cus_already',
      });

      expect(result.executed).toBe(false);
      expect(result.reason).toBe('already_in_state');
    });
  });

  describe('cancel action', () => {
    it('cancels a subscription successfully', async () => {
      const result = await executeFinalAction({
        action: 'cancel',
        subscriptionId: 'sub_cancel',
        invoiceId: 'inv_cancel',
        customerId: 'cus_cancel',
      });

      expect(result.executed).toBe(true);
      expect(result.action).toBe('cancel');
      expect(result.targetId).toBe('sub_cancel');
      expect(result.reason).toBeUndefined();
    });

    it('logs cancel operation in the store', async () => {
      await executeFinalAction({
        action: 'cancel',
        subscriptionId: 'sub_cancel_log',
        invoiceId: 'inv_cancel_log',
        customerId: 'cus_cancel_log',
      });

      const ops = dunningStore.getSubscriptionOperations();
      const cancelOp = ops.find(
        op => op.type === 'cancel' && op.targetId === 'sub_cancel_log'
      );
      expect(cancelOp).toBeDefined();
    });

    it('marks subscription as canceled in store', async () => {
      expect(dunningStore.isSubscriptionCanceled('sub_cancel_state')).toBe(false);

      await executeFinalAction({
        action: 'cancel',
        subscriptionId: 'sub_cancel_state',
        invoiceId: 'inv_cancel_state',
        customerId: 'cus_cancel_state',
      });

      expect(dunningStore.isSubscriptionCanceled('sub_cancel_state')).toBe(true);
    });

    it('returns already_in_state when subscription is already canceled', async () => {
      // First cancel
      mockStepId = 'cancel-step-1';
      await executeFinalAction({
        action: 'cancel',
        subscriptionId: 'sub_cancel_already',
        invoiceId: 'inv_cancel_already',
        customerId: 'cus_cancel_already',
      });

      // Second cancel with different stepId
      mockStepId = 'cancel-step-2';
      const result = await executeFinalAction({
        action: 'cancel',
        subscriptionId: 'sub_cancel_already',
        invoiceId: 'inv_cancel_already',
        customerId: 'cus_cancel_already',
      });

      expect(result.executed).toBe(false);
      expect(result.reason).toBe('already_in_state');
    });
  });

  describe('mark_unpaid action', () => {
    it('marks invoice as unpaid successfully', async () => {
      // Create an invoice first using createInvoice
      dunningStore.createInvoice('inv_unpaid', 'cus_unpaid', 'sub_unpaid');

      const result = await executeFinalAction({
        action: 'mark_unpaid',
        subscriptionId: 'sub_unpaid',
        invoiceId: 'inv_unpaid',
        customerId: 'cus_unpaid',
      });

      expect(result.executed).toBe(true);
      expect(result.action).toBe('mark_unpaid');
      expect(result.targetId).toBe('inv_unpaid');
      expect(result.reason).toBeUndefined();
    });

    it('logs mark_unpaid operation in the store', async () => {
      dunningStore.createInvoice('inv_unpaid_log', 'cus_unpaid_log', 'sub_unpaid_log');

      await executeFinalAction({
        action: 'mark_unpaid',
        subscriptionId: 'sub_unpaid_log',
        invoiceId: 'inv_unpaid_log',
        customerId: 'cus_unpaid_log',
      });

      const ops = dunningStore.getSubscriptionOperations();
      const markUnpaidOp = ops.find(
        op => op.type === 'mark_unpaid' && op.targetId === 'inv_unpaid_log'
      );
      expect(markUnpaidOp).toBeDefined();
    });

    it('updates invoice status to uncollectible', async () => {
      // Use createInvoice to properly set up the invoice
      dunningStore.createInvoice('inv_status', 'cus_status', 'sub_status');
      const before = dunningStore.getInvoice('inv_status');
      expect(before?.status).toBe('open');

      await executeFinalAction({
        action: 'mark_unpaid',
        subscriptionId: 'sub_status',
        invoiceId: 'inv_status',
        customerId: 'cus_status',
      });

      const after = dunningStore.getInvoice('inv_status');
      expect(after?.status).toBe('uncollectible');
    });

    it('handles non-existent invoice gracefully', async () => {
      // Don't create the invoice - should still succeed
      const result = await executeFinalAction({
        action: 'mark_unpaid',
        subscriptionId: 'sub_nonexistent',
        invoiceId: 'inv_nonexistent',
        customerId: 'cus_nonexistent',
      });

      // Operation should still be marked as executed (logged)
      expect(result.executed).toBe(true);
    });
  });

  describe('idempotency', () => {
    it('uses stepId as idempotency key to prevent duplicate pause', async () => {
      mockStepId = 'idempotent-pause-123';

      // First call - should execute
      const result1 = await executeFinalAction({
        action: 'pause',
        subscriptionId: 'sub_idem',
        invoiceId: 'inv_idem',
        customerId: 'cus_idem',
      });

      expect(result1.executed).toBe(true);

      // Second call with same stepId - should be deduplicated
      const result2 = await executeFinalAction({
        action: 'pause',
        subscriptionId: 'sub_idem',
        invoiceId: 'inv_idem',
        customerId: 'cus_idem',
      });

      expect(result2.executed).toBe(false);
      expect(result2.reason).toBe('already_executed');
    });

    it('uses stepId as idempotency key to prevent duplicate cancel', async () => {
      mockStepId = 'idempotent-cancel-123';

      const result1 = await executeFinalAction({
        action: 'cancel',
        subscriptionId: 'sub_idem_cancel',
        invoiceId: 'inv_idem_cancel',
        customerId: 'cus_idem_cancel',
      });

      expect(result1.executed).toBe(true);

      const result2 = await executeFinalAction({
        action: 'cancel',
        subscriptionId: 'sub_idem_cancel',
        invoiceId: 'inv_idem_cancel',
        customerId: 'cus_idem_cancel',
      });

      expect(result2.executed).toBe(false);
      expect(result2.reason).toBe('already_executed');
    });

    it('uses stepId as idempotency key to prevent duplicate mark_unpaid', async () => {
      dunningStore.createInvoice('inv_idem_unpaid', 'cus_idem_unpaid', 'sub_idem_unpaid');
      mockStepId = 'idempotent-unpaid-123';

      const result1 = await executeFinalAction({
        action: 'mark_unpaid',
        subscriptionId: 'sub_idem_unpaid',
        invoiceId: 'inv_idem_unpaid',
        customerId: 'cus_idem_unpaid',
      });

      expect(result1.executed).toBe(true);

      const result2 = await executeFinalAction({
        action: 'mark_unpaid',
        subscriptionId: 'sub_idem_unpaid',
        invoiceId: 'inv_idem_unpaid',
        customerId: 'cus_idem_unpaid',
      });

      expect(result2.executed).toBe(false);
      expect(result2.reason).toBe('already_executed');
    });

    it('different stepIds result in separate operations being tracked', async () => {
      // First call
      mockStepId = 'final-action-step-1';
      await executeFinalAction({
        action: 'pause',
        subscriptionId: 'sub_multi',
        invoiceId: 'inv_multi',
        customerId: 'cus_multi',
      });

      // Second call with different stepId - but subscription already paused
      mockStepId = 'final-action-step-2';
      const result = await executeFinalAction({
        action: 'pause',
        subscriptionId: 'sub_multi',
        invoiceId: 'inv_multi',
        customerId: 'cus_multi',
      });

      // Second call should detect already_in_state (not already_executed)
      expect(result.executed).toBe(false);
      expect(result.reason).toBe('already_in_state');

      // Both operations should be logged
      const ops = dunningStore.getSubscriptionOperations();
      const pauseOps = ops.filter(
        op => op.type === 'pause' && op.targetId === 'sub_multi'
      );
      expect(pauseOps.length).toBe(2);
    });
  });
});
