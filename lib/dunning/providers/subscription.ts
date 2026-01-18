/**
 * Mock subscription service for managing subscription state.
 *
 * Provides idempotent operations for pausing, canceling subscriptions
 * and restricting customer access.
 */

import { dunningStore } from '../store';

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

export interface SubscriptionServiceConfig {
  /** Simulated operation latency in ms (default: 50) */
  operationLatency?: number;
  /** Enable/disable latency simulation (default: true) */
  simulateLatency?: boolean;
}

const defaultConfig: Required<SubscriptionServiceConfig> = {
  operationLatency: 50,
  simulateLatency: true,
};

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface OperationResult {
  /** Whether operation was executed (false if idempotent no-op) */
  executed: boolean;
  /** Reason if not executed */
  reason?: 'already_executed' | 'already_in_state';
}

// -----------------------------------------------------------------------------
// Service Implementation
// -----------------------------------------------------------------------------

/**
 * Mock subscription service for testing subscription operations.
 */
class MockSubscriptionService {
  private config: Required<SubscriptionServiceConfig>;

  constructor(config: SubscriptionServiceConfig = {}) {
    this.config = { ...defaultConfig, ...config };
  }

  /**
   * Update service configuration.
   */
  configure(config: SubscriptionServiceConfig): void {
    this.config = { ...this.config, ...config };
    this.log('configure', config as Record<string, unknown>);
  }

  /**
   * Reset configuration to defaults.
   */
  resetConfig(): void {
    this.config = { ...defaultConfig };
    this.log('resetConfig', {});
  }

  /**
   * Pause a subscription.
   * Idempotent: safe to call multiple times.
   */
  async pauseSubscription(
    subscriptionId: string,
    idempotencyKey: string
  ): Promise<OperationResult> {
    this.log('pauseSubscription', { subscriptionId, idempotencyKey });

    await this.simulateLatency();

    // Check if already executed with this idempotency key
    if (dunningStore.wasOperationExecuted(idempotencyKey)) {
      this.log('pauseSubscription:duplicate', { idempotencyKey });
      return { executed: false, reason: 'already_executed' };
    }

    // Check if already paused
    if (dunningStore.isSubscriptionPaused(subscriptionId)) {
      // Still log the operation for tracking, but note it was already paused
      dunningStore.logSubscriptionOperation({
        type: 'pause',
        targetId: subscriptionId,
        idempotencyKey,
      });
      this.log('pauseSubscription:alreadyPaused', { subscriptionId });
      return { executed: false, reason: 'already_in_state' };
    }

    // Execute the operation
    dunningStore.logSubscriptionOperation({
      type: 'pause',
      targetId: subscriptionId,
      idempotencyKey,
    });

    this.log('pauseSubscription:executed', { subscriptionId });
    return { executed: true };
  }

  /**
   * Cancel a subscription.
   * Idempotent: safe to call multiple times.
   */
  async cancelSubscription(
    subscriptionId: string,
    idempotencyKey: string
  ): Promise<OperationResult> {
    this.log('cancelSubscription', { subscriptionId, idempotencyKey });

    await this.simulateLatency();

    // Check if already executed with this idempotency key
    if (dunningStore.wasOperationExecuted(idempotencyKey)) {
      this.log('cancelSubscription:duplicate', { idempotencyKey });
      return { executed: false, reason: 'already_executed' };
    }

    // Check if already canceled
    if (dunningStore.isSubscriptionCanceled(subscriptionId)) {
      dunningStore.logSubscriptionOperation({
        type: 'cancel',
        targetId: subscriptionId,
        idempotencyKey,
      });
      this.log('cancelSubscription:alreadyCanceled', { subscriptionId });
      return { executed: false, reason: 'already_in_state' };
    }

    // Execute the operation
    dunningStore.logSubscriptionOperation({
      type: 'cancel',
      targetId: subscriptionId,
      idempotencyKey,
    });

    this.log('cancelSubscription:executed', { subscriptionId });
    return { executed: true };
  }

  /**
   * Restrict customer access.
   * Idempotent: safe to call multiple times.
   */
  async restrictAccess(
    customerId: string,
    idempotencyKey: string
  ): Promise<OperationResult> {
    this.log('restrictAccess', { customerId, idempotencyKey });

    await this.simulateLatency();

    // Check if already executed with this idempotency key
    if (dunningStore.wasOperationExecuted(idempotencyKey)) {
      this.log('restrictAccess:duplicate', { idempotencyKey });
      return { executed: false, reason: 'already_executed' };
    }

    // Check if already restricted
    if (dunningStore.isCustomerRestricted(customerId)) {
      dunningStore.logSubscriptionOperation({
        type: 'restrict_access',
        targetId: customerId,
        idempotencyKey,
      });
      this.log('restrictAccess:alreadyRestricted', { customerId });
      return { executed: false, reason: 'already_in_state' };
    }

    // Execute the operation
    dunningStore.logSubscriptionOperation({
      type: 'restrict_access',
      targetId: customerId,
      idempotencyKey,
    });

    this.log('restrictAccess:executed', { customerId });
    return { executed: true };
  }

  /**
   * Mark invoice as unpaid/uncollectible.
   * Idempotent: safe to call multiple times.
   */
  async markUnpaid(
    invoiceId: string,
    idempotencyKey: string
  ): Promise<OperationResult> {
    this.log('markUnpaid', { invoiceId, idempotencyKey });

    await this.simulateLatency();

    // Check if already executed with this idempotency key
    if (dunningStore.wasOperationExecuted(idempotencyKey)) {
      this.log('markUnpaid:duplicate', { idempotencyKey });
      return { executed: false, reason: 'already_executed' };
    }

    // Update invoice status
    const updated = dunningStore.setInvoiceStatus(invoiceId, 'uncollectible');

    // Log the operation
    dunningStore.logSubscriptionOperation({
      type: 'mark_unpaid',
      targetId: invoiceId,
      idempotencyKey,
    });

    if (!updated) {
      this.log('markUnpaid:invoiceNotFound', { invoiceId });
    } else {
      this.log('markUnpaid:executed', { invoiceId });
    }

    return { executed: true };
  }

  /**
   * Simulate operation latency.
   */
  private async simulateLatency(): Promise<void> {
    if (!this.config.simulateLatency) return;
    await new Promise((resolve) =>
      setTimeout(resolve, this.config.operationLatency)
    );
  }

  private log(method: string, data: Record<string, unknown>): void {
    console.log(`[MockSubscription.${method}]`, JSON.stringify(data));
  }
}

// Export singleton instance
export const mockSubscriptionService = new MockSubscriptionService();

// Export class for testing
export { MockSubscriptionService };
