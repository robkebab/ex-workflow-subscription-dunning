/**
 * Mock Stripe provider for invoice operations.
 *
 * Simulates Stripe API behavior including latency, rate limits, and transient
 * failures for realistic testing scenarios.
 */

import type { InvoiceState } from '../types';
import { dunningStore } from '../store';

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

export interface StripeProviderConfig {
  /** Minimum simulated latency in ms (default: 50) */
  minLatency?: number;
  /** Maximum simulated latency in ms (default: 200) */
  maxLatency?: number;
  /** Probability of 429 rate limit response (0-1, default: 0.05) */
  rateLimitProbability?: number;
  /** Probability of transient 5xx error (0-1, default: 0.02) */
  transientErrorProbability?: number;
  /** Enable/disable latency simulation (default: true) */
  simulateLatency?: boolean;
}

const defaultConfig: Required<StripeProviderConfig> = {
  minLatency: 50,
  maxLatency: 200,
  rateLimitProbability: 0.05,
  transientErrorProbability: 0.02,
  simulateLatency: true,
};

// -----------------------------------------------------------------------------
// Error Types
// -----------------------------------------------------------------------------

export class StripeError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number,
    public readonly retryable: boolean
  ) {
    super(message);
    this.name = 'StripeError';
  }
}

export class RateLimitError extends StripeError {
  constructor(public readonly retryAfterMs: number = 1000) {
    super('Rate limit exceeded', 'rate_limit_exceeded', 429, true);
    this.name = 'RateLimitError';
  }
}

export class InvoiceNotFoundError extends StripeError {
  constructor(invoiceId: string) {
    super(
      `Invoice not found: ${invoiceId}`,
      'resource_missing',
      404,
      false
    );
    this.name = 'InvoiceNotFoundError';
  }
}

export class TransientError extends StripeError {
  constructor() {
    super('Internal server error', 'internal_error', 500, true);
    this.name = 'TransientError';
  }
}

// -----------------------------------------------------------------------------
// Provider Implementation
// -----------------------------------------------------------------------------

/**
 * Mock Stripe provider for testing invoice operations.
 */
class MockStripeProvider {
  private config: Required<StripeProviderConfig>;

  constructor(config: StripeProviderConfig = {}) {
    this.config = { ...defaultConfig, ...config };
  }

  /**
   * Update provider configuration.
   */
  configure(config: StripeProviderConfig): void {
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
   * Get an invoice by ID.
   * Simulates Stripe GET /v1/invoices/:id
   */
  async getInvoice(invoiceId: string): Promise<InvoiceState> {
    this.log('getInvoice', { invoiceId });

    await this.simulateLatency();
    this.maybeThrowTransientError();
    this.maybeThrowRateLimit();

    const invoice = dunningStore.getInvoice(invoiceId);
    if (!invoice) {
      throw new InvoiceNotFoundError(invoiceId);
    }

    return invoice;
  }

  /**
   * Check invoice payment status.
   * Returns just the status field for efficiency.
   */
  async checkInvoiceStatus(
    invoiceId: string
  ): Promise<InvoiceState['status']> {
    this.log('checkInvoiceStatus', { invoiceId });

    await this.simulateLatency();
    this.maybeThrowTransientError();
    this.maybeThrowRateLimit();

    const invoice = dunningStore.getInvoice(invoiceId);
    if (!invoice) {
      throw new InvoiceNotFoundError(invoiceId);
    }

    return invoice.status;
  }

  /**
   * Simulate latency based on configuration.
   */
  private async simulateLatency(): Promise<void> {
    if (!this.config.simulateLatency) return;

    const delay =
      this.config.minLatency +
      Math.random() * (this.config.maxLatency - this.config.minLatency);

    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  /**
   * Maybe throw a rate limit error based on probability.
   */
  private maybeThrowRateLimit(): void {
    if (Math.random() < this.config.rateLimitProbability) {
      const retryAfter = 1000 + Math.random() * 2000; // 1-3 seconds
      this.log('rateLimit', { retryAfterMs: retryAfter });
      throw new RateLimitError(retryAfter);
    }
  }

  /**
   * Maybe throw a transient error based on probability.
   */
  private maybeThrowTransientError(): void {
    if (Math.random() < this.config.transientErrorProbability) {
      this.log('transientError', {});
      throw new TransientError();
    }
  }

  private log(method: string, data: Record<string, unknown>): void {
    console.log(`[MockStripe.${method}]`, JSON.stringify(data));
  }
}

// Export singleton instance with default config
export const mockStripe = new MockStripeProvider();

// Export class for testing (allows creating isolated instances)
export { MockStripeProvider };
