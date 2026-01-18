/**
 * In-memory dunning store for tracking invoice states and workflow runs.
 *
 * This store enables local development and testing without external database
 * dependencies. It provides methods for state manipulation to simulate
 * customer actions like paying invoices.
 */

import type { InvoiceState } from './types';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface WorkflowRun {
  /** Unique run identifier */
  runId: string;
  /** Invoice being processed */
  invoiceId: string;
  /** Customer ID */
  customerId: string;
  /** Subscription ID */
  subscriptionId: string;
  /** Current attempt number (1-indexed) */
  currentAttempt: number;
  /** Workflow state */
  state: 'running' | 'completed' | 'failed';
  /** Outcome if completed */
  outcome?: 'recovered' | 'exhausted';
  /** Final action taken if exhausted */
  finalAction?: 'pause' | 'cancel' | 'mark_unpaid';
  /** Timestamp when workflow started */
  startedAt: number;
  /** Timestamp when workflow completed */
  completedAt?: number;
}

export interface EmailLog {
  /** Unique email identifier */
  id: string;
  /** Idempotency key used */
  idempotencyKey: string;
  /** Recipient email */
  to: string;
  /** Customer ID */
  customerId: string;
  /** Invoice ID */
  invoiceId: string;
  /** Escalation level (0, 1, or 2) */
  escalationLevel: number;
  /** Webhook URL included in email */
  webhookUrl: string;
  /** Timestamp when sent */
  sentAt: number;
}

export interface SubscriptionOperation {
  /** Operation type */
  type: 'pause' | 'cancel' | 'restrict_access' | 'mark_unpaid';
  /** Target ID (subscription or customer depending on operation) */
  targetId: string;
  /** Idempotency key used */
  idempotencyKey: string;
  /** Timestamp when executed */
  executedAt: number;
}

export interface StoreState {
  invoices: Map<string, InvoiceState>;
  workflowRuns: Map<string, WorkflowRun>;
  emailLogs: EmailLog[];
  subscriptionOperations: SubscriptionOperation[];
  processedEventIds: Set<string>;
  restrictedCustomers: Set<string>;
}

// -----------------------------------------------------------------------------
// Store Implementation
// -----------------------------------------------------------------------------

/**
 * In-memory store for dunning workflow state.
 * Singleton instance ensures consistency across the application.
 */
class DunningStore {
  private invoices: Map<string, InvoiceState> = new Map();
  private workflowRuns: Map<string, WorkflowRun> = new Map();
  private emailLogs: EmailLog[] = [];
  private subscriptionOperations: SubscriptionOperation[] = [];
  private processedEventIds: Set<string> = new Set();
  private restrictedCustomers: Set<string> = new Set();
  private pausedSubscriptions: Set<string> = new Set();
  private canceledSubscriptions: Set<string> = new Set();

  // ---------------------------------------------------------------------------
  // Invoice Methods
  // ---------------------------------------------------------------------------

  /**
   * Get an invoice by ID.
   * Returns undefined if invoice doesn't exist.
   */
  getInvoice(invoiceId: string): InvoiceState | undefined {
    this.log('getInvoice', { invoiceId });
    return this.invoices.get(invoiceId);
  }

  /**
   * Set or update an invoice.
   */
  setInvoice(invoice: InvoiceState): void {
    this.log('setInvoice', { invoiceId: invoice.id, status: invoice.status });
    this.invoices.set(invoice.id, invoice);
  }

  /**
   * Update invoice status.
   * Returns true if invoice exists and was updated.
   */
  setInvoiceStatus(
    invoiceId: string,
    status: InvoiceState['status']
  ): boolean {
    const invoice = this.invoices.get(invoiceId);
    if (!invoice) {
      this.log('setInvoiceStatus', { invoiceId, status, found: false });
      return false;
    }
    invoice.status = status;
    this.invoices.set(invoiceId, invoice);
    this.log('setInvoiceStatus', { invoiceId, status, found: true });
    return true;
  }

  /**
   * Mark an invoice as paid.
   * Convenience method for test manipulation.
   */
  markInvoicePaid(invoiceId: string): boolean {
    this.log('markInvoicePaid', { invoiceId });
    return this.setInvoiceStatus(invoiceId, 'paid');
  }

  /**
   * Create a default invoice for testing.
   * Useful when starting a dunning workflow without a pre-existing invoice.
   */
  createInvoice(
    invoiceId: string,
    customerId: string,
    subscriptionId: string,
    options?: Partial<InvoiceState>
  ): InvoiceState {
    const invoice: InvoiceState = {
      id: invoiceId,
      status: 'open',
      amountDue: 9900, // $99.00 default
      currency: 'usd',
      customerId,
      subscriptionId,
      ...options,
    };
    this.setInvoice(invoice);
    return invoice;
  }

  // ---------------------------------------------------------------------------
  // Workflow Run Methods
  // ---------------------------------------------------------------------------

  /**
   * Get a workflow run by run ID.
   */
  getWorkflowRun(runId: string): WorkflowRun | undefined {
    return this.workflowRuns.get(runId);
  }

  /**
   * Get workflow run by invoice ID.
   * Returns the most recent run for the invoice.
   */
  getWorkflowRunByInvoice(invoiceId: string): WorkflowRun | undefined {
    const runs = Array.from(this.workflowRuns.values())
      .filter((run) => run.invoiceId === invoiceId)
      .sort((a, b) => b.startedAt - a.startedAt);
    return runs[0];
  }

  /**
   * Create or update a workflow run.
   */
  setWorkflowRun(run: WorkflowRun): void {
    this.log('setWorkflowRun', {
      runId: run.runId,
      invoiceId: run.invoiceId,
      state: run.state,
    });
    this.workflowRuns.set(run.runId, run);
  }

  /**
   * Update workflow run state.
   */
  updateWorkflowRun(
    runId: string,
    updates: Partial<WorkflowRun>
  ): WorkflowRun | undefined {
    const run = this.workflowRuns.get(runId);
    if (!run) return undefined;
    const updated = { ...run, ...updates };
    this.workflowRuns.set(runId, updated);
    this.log('updateWorkflowRun', { runId, updates });
    return updated;
  }

  // ---------------------------------------------------------------------------
  // Email Log Methods
  // ---------------------------------------------------------------------------

  /**
   * Log an email that was sent.
   * Returns false if an email with the same idempotency key exists (duplicate).
   */
  logEmail(email: Omit<EmailLog, 'id' | 'sentAt'>): EmailLog | null {
    // Check for duplicate by idempotency key
    const existing = this.emailLogs.find(
      (e) => e.idempotencyKey === email.idempotencyKey
    );
    if (existing) {
      this.log('logEmail', {
        idempotencyKey: email.idempotencyKey,
        duplicate: true,
      });
      return null; // Duplicate, already sent
    }

    const logged: EmailLog = {
      ...email,
      id: `email_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      sentAt: Date.now(),
    };
    this.emailLogs.push(logged);
    this.log('logEmail', {
      id: logged.id,
      to: logged.to,
      escalationLevel: logged.escalationLevel,
    });
    return logged;
  }

  /**
   * Get all email logs, optionally filtered by invoice ID.
   */
  getEmailLogs(invoiceId?: string): EmailLog[] {
    if (!invoiceId) return [...this.emailLogs];
    return this.emailLogs.filter((e) => e.invoiceId === invoiceId);
  }

  /**
   * Check if an email with the given idempotency key was already sent.
   */
  wasEmailSent(idempotencyKey: string): boolean {
    return this.emailLogs.some((e) => e.idempotencyKey === idempotencyKey);
  }

  // ---------------------------------------------------------------------------
  // Subscription Operation Methods
  // ---------------------------------------------------------------------------

  /**
   * Log a subscription operation.
   * Returns false if operation with same idempotency key exists (duplicate).
   */
  logSubscriptionOperation(
    operation: Omit<SubscriptionOperation, 'executedAt'>
  ): SubscriptionOperation | null {
    // Check for duplicate by idempotency key
    const existing = this.subscriptionOperations.find(
      (op) => op.idempotencyKey === operation.idempotencyKey
    );
    if (existing) {
      this.log('logSubscriptionOperation', {
        type: operation.type,
        idempotencyKey: operation.idempotencyKey,
        duplicate: true,
      });
      return null;
    }

    const logged: SubscriptionOperation = {
      ...operation,
      executedAt: Date.now(),
    };
    this.subscriptionOperations.push(logged);

    // Update internal state based on operation type
    if (operation.type === 'restrict_access') {
      this.restrictedCustomers.add(operation.targetId);
    } else if (operation.type === 'pause') {
      this.pausedSubscriptions.add(operation.targetId);
    } else if (operation.type === 'cancel') {
      this.canceledSubscriptions.add(operation.targetId);
    }

    this.log('logSubscriptionOperation', {
      type: operation.type,
      targetId: operation.targetId,
    });
    return logged;
  }

  /**
   * Get all subscription operations.
   */
  getSubscriptionOperations(): SubscriptionOperation[] {
    return [...this.subscriptionOperations];
  }

  /**
   * Check if an operation with the given idempotency key was already executed.
   */
  wasOperationExecuted(idempotencyKey: string): boolean {
    return this.subscriptionOperations.some(
      (op) => op.idempotencyKey === idempotencyKey
    );
  }

  /**
   * Check if a customer has restricted access.
   */
  isCustomerRestricted(customerId: string): boolean {
    return this.restrictedCustomers.has(customerId);
  }

  /**
   * Check if a subscription is paused.
   */
  isSubscriptionPaused(subscriptionId: string): boolean {
    return this.pausedSubscriptions.has(subscriptionId);
  }

  /**
   * Check if a subscription is canceled.
   */
  isSubscriptionCanceled(subscriptionId: string): boolean {
    return this.canceledSubscriptions.has(subscriptionId);
  }

  // ---------------------------------------------------------------------------
  // Event Processing (Idempotency)
  // ---------------------------------------------------------------------------

  /**
   * Check if an event ID has already been processed.
   */
  hasProcessedEvent(eventId: string): boolean {
    return this.processedEventIds.has(eventId);
  }

  /**
   * Mark an event ID as processed.
   * Returns false if already processed (duplicate).
   */
  markEventProcessed(eventId: string): boolean {
    if (this.processedEventIds.has(eventId)) {
      this.log('markEventProcessed', { eventId, duplicate: true });
      return false;
    }
    this.processedEventIds.add(eventId);
    this.log('markEventProcessed', { eventId, duplicate: false });
    return true;
  }

  // ---------------------------------------------------------------------------
  // State Management
  // ---------------------------------------------------------------------------

  /**
   * Get full store state for debugging/inspection.
   */
  getState(): StoreState {
    return {
      invoices: new Map(this.invoices),
      workflowRuns: new Map(this.workflowRuns),
      emailLogs: [...this.emailLogs],
      subscriptionOperations: [...this.subscriptionOperations],
      processedEventIds: new Set(this.processedEventIds),
      restrictedCustomers: new Set(this.restrictedCustomers),
    };
  }

  /**
   * Get serializable state for API responses.
   */
  getSerializableState(): Record<string, unknown> {
    return {
      invoices: Object.fromEntries(this.invoices),
      workflowRuns: Object.fromEntries(this.workflowRuns),
      emailLogs: this.emailLogs,
      subscriptionOperations: this.subscriptionOperations,
      processedEventIds: Array.from(this.processedEventIds),
      restrictedCustomers: Array.from(this.restrictedCustomers),
      pausedSubscriptions: Array.from(this.pausedSubscriptions),
      canceledSubscriptions: Array.from(this.canceledSubscriptions),
    };
  }

  /**
   * Reset all state.
   * Use for test isolation.
   */
  reset(): void {
    this.log('reset', {});
    this.invoices.clear();
    this.workflowRuns.clear();
    this.emailLogs = [];
    this.subscriptionOperations = [];
    this.processedEventIds.clear();
    this.restrictedCustomers.clear();
    this.pausedSubscriptions.clear();
    this.canceledSubscriptions.clear();
  }

  // ---------------------------------------------------------------------------
  // Logging
  // ---------------------------------------------------------------------------

  private log(method: string, data: Record<string, unknown>): void {
    console.log(`[DunningStore.${method}]`, JSON.stringify(data));
  }
}

// Export singleton instance
export const dunningStore = new DunningStore();

// Export class for testing (allows creating isolated instances)
export { DunningStore };
