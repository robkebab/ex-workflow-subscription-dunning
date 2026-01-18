/**
 * Dunning start endpoint for manually triggering dunning workflows.
 *
 * This endpoint enables developers to manually start a dunning workflow for testing
 * and debugging. It accepts invoice, customer, and subscription IDs along with
 * optional configuration overrides.
 *
 * Uses `start()` from workflow/api to properly trigger the workflow through the
 * runtime, enabling durable execution, observability, and proper Run management.
 */

import { NextRequest, NextResponse } from 'next/server';
import { start } from 'workflow/api';
import { dunningStore } from '@/lib/dunning/store';
import { dunningWorkflow } from '@/lib/dunning/workflow';
import type { DunningWorkflowInput, DunningConfig } from '@/lib/dunning/types';

/**
 * Request body structure for starting a dunning workflow.
 */
interface StartDunningRequest {
  invoiceId: string;
  customerId: string;
  subscriptionId: string;
  config?: DunningConfig;
}

/**
 * Validates the request body structure.
 */
function isValidRequest(body: unknown): body is StartDunningRequest {
  if (!body || typeof body !== 'object') return false;
  const req = body as Record<string, unknown>;

  // Check required string fields
  if (typeof req.invoiceId !== 'string' || !req.invoiceId) return false;
  if (typeof req.customerId !== 'string' || !req.customerId) return false;
  if (typeof req.subscriptionId !== 'string' || !req.subscriptionId) return false;

  // If config is provided, validate its structure
  if (req.config !== undefined) {
    if (typeof req.config !== 'object' || req.config === null) return false;
    const config = req.config as Record<string, unknown>;

    // Validate optional config fields if present
    if (config.retrySchedule !== undefined) {
      if (!Array.isArray(config.retrySchedule)) return false;
      if (!config.retrySchedule.every((s: unknown) => typeof s === 'string')) return false;
    }
    if (config.maxAttempts !== undefined && typeof config.maxAttempts !== 'number') return false;
    if (config.gracePeriod !== undefined && typeof config.gracePeriod !== 'string') return false;
    if (config.finalAction !== undefined) {
      if (!['pause', 'cancel', 'mark_unpaid'].includes(config.finalAction as string)) return false;
    }
    if (config.restrictAccessAfterAttempt !== undefined && typeof config.restrictAccessAfterAttempt !== 'number') {
      return false;
    }
  }

  return true;
}

/**
 * Handle POST requests to manually start a dunning workflow.
 *
 * This endpoint is primarily for testing and debugging. It allows developers to
 * trigger the dunning workflow with custom parameters without needing a Stripe
 * webhook event.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    console.log('[dunning-start] Failed to parse JSON body');
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  // Validate request structure
  if (!isValidRequest(body)) {
    console.log('[dunning-start] Malformed request body', body);
    return NextResponse.json(
      { error: 'Malformed request body. Required: invoiceId, customerId, subscriptionId' },
      { status: 400 }
    );
  }

  const { invoiceId, customerId, subscriptionId, config } = body;

  console.log(
    `[dunning-start] Starting dunning workflow: ` +
    `invoice=${invoiceId} customer=${customerId} subscription=${subscriptionId}`
  );

  // Check if there's already an active workflow for this invoice
  // Note: This only checks local mapping - in production the workflow runtime
  // provides the actual status via getRun()
  const existingMapping = dunningStore.getInvoiceRunMapping(invoiceId);
  if (existingMapping) {
    console.log(`[dunning-start] Workflow already registered for invoice=${invoiceId}`);
    return NextResponse.json(
      {
        error: 'Workflow already running for this invoice',
        runId: existingMapping.runId,
      },
      { status: 409 }
    );
  }

  // Prepare workflow input
  const workflowInput: DunningWorkflowInput = {
    provider: 'stripe',
    invoiceId,
    customerId,
    subscriptionId,
    config,
  };

  // Start workflow via runtime - this enables durable execution and proper Run management
  const run = await start(dunningWorkflow, [workflowInput]);
  const runId = run.runId;

  // Store minimal mapping for status endpoint lookups
  // The workflow runtime manages all state - we only need to map invoiceId -> runId
  dunningStore.setInvoiceRunMapping({
    invoiceId,
    runId,
    customerId,
    subscriptionId,
  });

  console.log(`[dunning-start] Workflow started: runId=${runId}`);

  return NextResponse.json({
    success: true,
    runId,
    invoiceId,
    customerId,
    subscriptionId,
  });
}
