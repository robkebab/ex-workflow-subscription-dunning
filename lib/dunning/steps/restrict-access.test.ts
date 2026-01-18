/**
 * Tests for restrictCustomerAccess step function.
 *
 * These tests verify:
 * 1. Success path - restricts access for a customer
 * 2. Idempotency - uses stepId to prevent duplicate restrictions
 * 3. Already restricted - handles case where customer is already restricted
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FatalError, RetryableError } from 'workflow';
import { restrictCustomerAccess } from './restrict-access';
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

describe('restrictCustomerAccess step', () => {
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

  describe('success path', () => {
    it('restricts access for a customer successfully', async () => {
      const result = await restrictCustomerAccess({
        customerId: 'cus_test',
        invoiceId: 'inv_test',
        subscriptionId: 'sub_test',
      });

      expect(result.executed).toBe(true);
      expect(result.customerId).toBe('cus_test');
      expect(result.reason).toBeUndefined();
    });

    it('logs the operation in the store', async () => {
      await restrictCustomerAccess({
        customerId: 'cus_logged',
        invoiceId: 'inv_logged',
      });

      // Verify the operation was logged
      const ops = dunningStore.getSubscriptionOperations();
      const restrictOp = ops.find(
        op => op.type === 'restrict_access' && op.targetId === 'cus_logged'
      );
      expect(restrictOp).toBeDefined();
    });

    it('marks customer as restricted in store', async () => {
      expect(dunningStore.isCustomerRestricted('cus_state')).toBe(false);

      await restrictCustomerAccess({
        customerId: 'cus_state',
        invoiceId: 'inv_state',
      });

      expect(dunningStore.isCustomerRestricted('cus_state')).toBe(true);
    });
  });

  describe('idempotency', () => {
    it('uses stepId as idempotency key to prevent duplicate restrictions', async () => {
      // Use same stepId for both calls
      mockStepId = 'idempotent-restrict-123';

      // First call - should execute
      const result1 = await restrictCustomerAccess({
        customerId: 'cus_idempotent',
        invoiceId: 'inv_idempotent',
      });

      expect(result1.executed).toBe(true);

      // Second call with same stepId - should be deduplicated
      const result2 = await restrictCustomerAccess({
        customerId: 'cus_idempotent',
        invoiceId: 'inv_idempotent',
      });

      expect(result2.executed).toBe(false);
      expect(result2.reason).toBe('already_executed');
    });

    it('different stepIds result in separate operations being logged', async () => {
      // First call
      mockStepId = 'restrict-step-1';
      await restrictCustomerAccess({
        customerId: 'cus_multi',
        invoiceId: 'inv_multi',
      });

      // Second call with different stepId - but customer already restricted
      mockStepId = 'restrict-step-2';
      const result = await restrictCustomerAccess({
        customerId: 'cus_multi',
        invoiceId: 'inv_multi',
      });

      // Second call should detect already_in_state (not already_executed)
      expect(result.executed).toBe(false);
      expect(result.reason).toBe('already_in_state');

      // Both operations should be logged
      const ops = dunningStore.getSubscriptionOperations();
      const restrictOps = ops.filter(
        op => op.type === 'restrict_access' && op.targetId === 'cus_multi'
      );
      expect(restrictOps.length).toBe(2);
    });
  });

  describe('already restricted', () => {
    it('returns already_in_state when customer is already restricted', async () => {
      // First call to restrict
      mockStepId = 'initial-restrict';
      await restrictCustomerAccess({
        customerId: 'cus_already',
        invoiceId: 'inv_already_1',
      });

      // Second call with different stepId but same customer
      mockStepId = 'subsequent-restrict';
      const result = await restrictCustomerAccess({
        customerId: 'cus_already',
        invoiceId: 'inv_already_2',
      });

      expect(result.executed).toBe(false);
      expect(result.reason).toBe('already_in_state');
    });
  });

  describe('optional subscriptionId', () => {
    it('works without subscriptionId', async () => {
      const result = await restrictCustomerAccess({
        customerId: 'cus_no_sub',
        invoiceId: 'inv_no_sub',
        // subscriptionId intentionally omitted
      });

      expect(result.executed).toBe(true);
      expect(result.customerId).toBe('cus_no_sub');
    });

    it('works with subscriptionId', async () => {
      const result = await restrictCustomerAccess({
        customerId: 'cus_with_sub',
        invoiceId: 'inv_with_sub',
        subscriptionId: 'sub_test_123',
      });

      expect(result.executed).toBe(true);
      expect(result.customerId).toBe('cus_with_sub');
    });
  });
});
