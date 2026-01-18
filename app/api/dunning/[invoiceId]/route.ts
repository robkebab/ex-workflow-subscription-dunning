/**
 * Dunning status endpoint for retrieving the current state of a dunning workflow.
 *
 * This endpoint returns the current dunning status for an invoice, including
 * attempt count, workflow state, and relevant timestamps. Used for monitoring
 * and debugging dunning workflows.
 */

import { NextRequest, NextResponse } from 'next/server';
import { dunningStore } from '@/lib/dunning/store';

interface RouteParams {
  params: Promise<{
    invoiceId: string;
  }>;
}

/**
 * Handle GET requests to retrieve dunning status for an invoice.
 *
 * Returns the current workflow state including:
 * - runId: The unique workflow run identifier
 * - invoiceId: The invoice being processed
 * - customerId: The customer associated with the invoice
 * - subscriptionId: The subscription being dunned
 * - currentAttempt: The current retry attempt number
 * - state: The workflow state ('running', 'completed', 'failed')
 * - outcome: The workflow outcome if completed ('recovered', 'exhausted')
 * - finalAction: The final action taken if exhausted
 * - startedAt: When the workflow started (ISO timestamp)
 * - completedAt: When the workflow completed (ISO timestamp, if applicable)
 *
 * Returns 404 if no dunning workflow exists for the invoice.
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  const { invoiceId } = await params;

  console.log(`[dunning-status] Getting status for invoice=${invoiceId}`);

  // Look up the workflow run for this invoice
  const workflowRun = dunningStore.getWorkflowRunByInvoice(invoiceId);

  if (!workflowRun) {
    console.log(`[dunning-status] No dunning workflow found for invoice=${invoiceId}`);
    return NextResponse.json(
      { error: 'No dunning workflow found for this invoice' },
      { status: 404 }
    );
  }

  // Build response with timestamps in ISO format for API consumers
  const response = {
    runId: workflowRun.runId,
    invoiceId: workflowRun.invoiceId,
    customerId: workflowRun.customerId,
    subscriptionId: workflowRun.subscriptionId,
    currentAttempt: workflowRun.currentAttempt,
    state: workflowRun.state,
    outcome: workflowRun.outcome,
    finalAction: workflowRun.finalAction,
    startedAt: new Date(workflowRun.startedAt).toISOString(),
    completedAt: workflowRun.completedAt
      ? new Date(workflowRun.completedAt).toISOString()
      : undefined,
  };

  console.log(
    `[dunning-status] Found workflow: runId=${workflowRun.runId} state=${workflowRun.state}`
  );

  return NextResponse.json(response);
}
