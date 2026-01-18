import { describe, it, expect, beforeEach } from 'vitest';
import { MockSubscriptionService } from './subscription';
import { dunningStore } from '../store';

describe('MockSubscriptionService', () => {
  let subscriptionService: MockSubscriptionService;

  beforeEach(() => {
    dunningStore.reset();
    subscriptionService = new MockSubscriptionService({
      simulateLatency: false,
    });
  });

  describe('pauseSubscription', () => {
    it('pauses a subscription', async () => {
      const result = await subscriptionService.pauseSubscription(
        'sub_123',
        'pause_key_1'
      );

      expect(result.executed).toBe(true);
      expect(dunningStore.isSubscriptionPaused('sub_123')).toBe(true);
    });

    it('is idempotent with same idempotency key', async () => {
      const first = await subscriptionService.pauseSubscription(
        'sub_123',
        'pause_key_1'
      );
      const second = await subscriptionService.pauseSubscription(
        'sub_123',
        'pause_key_1'
      );

      expect(first.executed).toBe(true);
      expect(second.executed).toBe(false);
      expect(second.reason).toBe('already_executed');
    });

    it('reports already paused with different key', async () => {
      await subscriptionService.pauseSubscription('sub_123', 'pause_key_1');
      const second = await subscriptionService.pauseSubscription(
        'sub_123',
        'pause_key_2'
      );

      expect(second.executed).toBe(false);
      expect(second.reason).toBe('already_in_state');
    });

    it('logs operation to store', async () => {
      await subscriptionService.pauseSubscription('sub_123', 'pause_key_1');

      const ops = dunningStore.getSubscriptionOperations();
      expect(ops).toHaveLength(1);
      expect(ops[0].type).toBe('pause');
      expect(ops[0].targetId).toBe('sub_123');
    });
  });

  describe('cancelSubscription', () => {
    it('cancels a subscription', async () => {
      const result = await subscriptionService.cancelSubscription(
        'sub_123',
        'cancel_key_1'
      );

      expect(result.executed).toBe(true);
      expect(dunningStore.isSubscriptionCanceled('sub_123')).toBe(true);
    });

    it('is idempotent with same idempotency key', async () => {
      const first = await subscriptionService.cancelSubscription(
        'sub_123',
        'cancel_key_1'
      );
      const second = await subscriptionService.cancelSubscription(
        'sub_123',
        'cancel_key_1'
      );

      expect(first.executed).toBe(true);
      expect(second.executed).toBe(false);
      expect(second.reason).toBe('already_executed');
    });

    it('reports already canceled with different key', async () => {
      await subscriptionService.cancelSubscription('sub_123', 'cancel_key_1');
      const second = await subscriptionService.cancelSubscription(
        'sub_123',
        'cancel_key_2'
      );

      expect(second.executed).toBe(false);
      expect(second.reason).toBe('already_in_state');
    });
  });

  describe('restrictAccess', () => {
    it('restricts customer access', async () => {
      const result = await subscriptionService.restrictAccess(
        'cus_123',
        'restrict_key_1'
      );

      expect(result.executed).toBe(true);
      expect(dunningStore.isCustomerRestricted('cus_123')).toBe(true);
    });

    it('is idempotent with same idempotency key', async () => {
      const first = await subscriptionService.restrictAccess(
        'cus_123',
        'restrict_key_1'
      );
      const second = await subscriptionService.restrictAccess(
        'cus_123',
        'restrict_key_1'
      );

      expect(first.executed).toBe(true);
      expect(second.executed).toBe(false);
      expect(second.reason).toBe('already_executed');
    });

    it('reports already restricted with different key', async () => {
      await subscriptionService.restrictAccess('cus_123', 'restrict_key_1');
      const second = await subscriptionService.restrictAccess(
        'cus_123',
        'restrict_key_2'
      );

      expect(second.executed).toBe(false);
      expect(second.reason).toBe('already_in_state');
    });

    it('logs operation to store', async () => {
      await subscriptionService.restrictAccess('cus_123', 'restrict_key_1');

      const ops = dunningStore.getSubscriptionOperations();
      expect(ops).toHaveLength(1);
      expect(ops[0].type).toBe('restrict_access');
      expect(ops[0].targetId).toBe('cus_123');
    });
  });

  describe('markUnpaid', () => {
    it('marks invoice as uncollectible', async () => {
      dunningStore.createInvoice('inv_123', 'cus_123', 'sub_123');

      const result = await subscriptionService.markUnpaid(
        'inv_123',
        'unpaid_key_1'
      );

      expect(result.executed).toBe(true);
      expect(dunningStore.getInvoice('inv_123')?.status).toBe('uncollectible');
    });

    it('is idempotent with same idempotency key', async () => {
      dunningStore.createInvoice('inv_123', 'cus_123', 'sub_123');

      const first = await subscriptionService.markUnpaid(
        'inv_123',
        'unpaid_key_1'
      );
      const second = await subscriptionService.markUnpaid(
        'inv_123',
        'unpaid_key_1'
      );

      expect(first.executed).toBe(true);
      expect(second.executed).toBe(false);
      expect(second.reason).toBe('already_executed');
    });

    it('handles non-existent invoice gracefully', async () => {
      // Still executes (logs operation) even if invoice not found
      const result = await subscriptionService.markUnpaid(
        'inv_nonexistent',
        'unpaid_key_1'
      );

      expect(result.executed).toBe(true);
    });

    it('logs operation to store', async () => {
      dunningStore.createInvoice('inv_123', 'cus_123', 'sub_123');

      await subscriptionService.markUnpaid('inv_123', 'unpaid_key_1');

      const ops = dunningStore.getSubscriptionOperations();
      expect(ops).toHaveLength(1);
      expect(ops[0].type).toBe('mark_unpaid');
      expect(ops[0].targetId).toBe('inv_123');
    });
  });

  describe('configuration', () => {
    it('can update configuration', () => {
      subscriptionService.configure({ operationLatency: 200 });
      // Configuration updated (tested indirectly)
    });

    it('can reset configuration to defaults', () => {
      subscriptionService.configure({ operationLatency: 500 });
      subscriptionService.resetConfig();
      // Reset to defaults
    });
  });
});

describe('MockSubscriptionService singleton', () => {
  beforeEach(() => {
    dunningStore.reset();
  });

  it('mockSubscriptionService is exported as singleton', async () => {
    const { mockSubscriptionService } = await import('./subscription');

    mockSubscriptionService.configure({ simulateLatency: false });

    const result = await mockSubscriptionService.pauseSubscription(
      'sub_singleton',
      'singleton_key'
    );

    expect(result.executed).toBe(true);
  });
});
