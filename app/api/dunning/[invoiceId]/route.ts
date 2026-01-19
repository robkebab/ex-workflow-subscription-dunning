/**
 * Dunning status endpoint for retrieving the current state of a dunning workflow.
 *
 * This endpoint returns the current dunning status for an invoice by querying
 * the workflow runtime. The Run object from workflow/api provides real-time
 * status, return value, and timestamps.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getRun } from 'workflow/api';
import { dunningStore } from '@/lib/dunning/store';
import type { DunningResult } from '@/lib/dunning/types';

interface RouteParams {
  params: Promise<{
    invoiceId: string;
  }>;
}

/**
 * Handle GET requests to retrieve dunning status for an invoice.
 *
 * Uses the workflow runtime's Run object for real-time status:
 * - runId: The unique workflow run identifier
 * - invoiceId: The invoice being processed
 * - customerId: The customer associated with the invoice
 * - subscriptionId: The subscription being dunned
 * - status: The workflow status from the runtime ('pending', 'running', 'completed', 'failed', 'cancelled')
 * - result: The workflow result if completed (outcome, finalAction, attemptsUsed)
 * - createdAt: When the workflow was created (ISO timestamp)
 * - startedAt: When the workflow started execution (ISO timestamp, if applicable)
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

  // Look up the runId for this invoice
  const mapping = dunningStore.getInvoiceRunMapping(invoiceId);

  if (!mapping) {
    console.log(`[dunning-status] No dunning workflow found for invoice=${invoiceId}`);
    return NextResponse.json(
      { error: 'No dunning workflow found for this invoice' },
      { status: 404 }
    );
  }

  // Get the Run object from the workflow runtime
  const run = getRun<DunningResult>(mapping.runId);

  // Fetch status and timestamps from the runtime
  const [status, createdAt, startedAt, completedAt] = await Promise.all([
    run.status,
    run.createdAt,
    run.startedAt,
    run.completedAt,
  ]);

  // Build base response
  const response: Record<string, unknown> = {
    runId: mapping.runId,
    invoiceId: mapping.invoiceId,
    customerId: mapping.customerId,
    subscriptionId: mapping.subscriptionId,
    status,
    createdAt: createdAt.toISOString(),
    startedAt: startedAt?.toISOString(),
    completedAt: completedAt?.toISOString(),
  };

  // If completed, include the result
  if (status === 'completed') {
    try {
      const result = await run.returnValue;
      response.result = result;
    } catch (error) {
      console.error(`[dunning-status] Failed to get returnValue: runId=${mapping.runId}`, error);
    }
  }

  console.log(
    `[dunning-status] Found workflow: runId=${mapping.runId} status=${status}`
  );

  return NextResponse.json(response);
}
