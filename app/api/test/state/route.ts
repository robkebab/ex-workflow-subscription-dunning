/**
 * Test endpoint for dumping mock store state.
 *
 * This endpoint allows developers to inspect the full internal state of the
 * dunning system during testing. It returns all invoices, email logs,
 * subscription operations, and workflow runs for debugging and verification.
 */

import { NextResponse } from 'next/server';
import { dunningStore } from '@/lib/dunning/store';

/**
 * Handle GET requests to retrieve full mock store state.
 *
 * Returns a JSON object containing:
 * - invoices: All invoice records
 * - invoiceRunMappings: Mapping of invoiceId -> runId (for status lookups)
 * - workflowRuns: (deprecated) Legacy workflow run records
 * - emailLogs: All sent email records
 * - subscriptionOperations: All subscription operations (pause, cancel, restrict)
 * - processedEventIds: IDs of processed Stripe events (for idempotency)
 * - restrictedCustomers: Customer IDs with restricted access
 * - pausedSubscriptions: Subscription IDs that have been paused
 * - canceledSubscriptions: Subscription IDs that have been canceled
 */
export async function GET(): Promise<NextResponse> {
  console.log('[state] Dumping full mock store state');

  const state = dunningStore.getSerializableState();

  // Add counts for summary
  const summary = {
    invoiceCount: Object.keys(state.invoices as Record<string, unknown>).length,
    invoiceRunMappingCount: Object.keys(state.invoiceRunMappings as Record<string, unknown>).length,
    workflowRunCount: Object.keys(state.workflowRuns as Record<string, unknown>).length,
    emailLogCount: (state.emailLogs as unknown[]).length,
    subscriptionOperationCount: (state.subscriptionOperations as unknown[]).length,
    processedEventCount: (state.processedEventIds as unknown[]).length,
    restrictedCustomerCount: (state.restrictedCustomers as unknown[]).length,
    pausedSubscriptionCount: (state.pausedSubscriptions as unknown[]).length,
    canceledSubscriptionCount: (state.canceledSubscriptions as unknown[]).length,
  };

  console.log('[state] State summary:', JSON.stringify(summary));

  return NextResponse.json({
    ...state,
    _summary: summary,
  });
}
