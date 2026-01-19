/**
 * Stripe webhook endpoint for handling invoice payment failures.
 *
 * This endpoint receives Stripe webhook events and starts the dunning workflow
 * when an invoice payment fails. It implements idempotency to prevent duplicate
 * workflow starts from retried webhook deliveries.
 *
 * Uses `start()` from workflow/api to properly trigger the workflow through the
 * runtime, enabling durable execution, observability, and proper Run management.
 *
 * Security Note: Webhook signature verification is skipped for this demo.
 * In production, you should verify the Stripe-Signature header using
 * stripe.webhooks.constructEvent() to ensure the webhook is authentic.
 */

import { NextRequest, NextResponse } from 'next/server';
import { start } from 'workflow/api';
import { dunningStore } from '@/lib/dunning/store';
import { dunningWorkflow } from '@/lib/dunning/workflow';
import type { DunningWorkflowInput } from '@/lib/dunning/types';

/**
 * Expected Stripe webhook event structure for invoice.payment_failed.
 */
interface StripeEvent {
  id: string;
  type: string;
  data: {
    object: {
      id: string; // invoice ID
      customer: string; // customer ID
      subscription?: string | null; // subscription ID (optional)
    };
  };
}

/**
 * Validates the Stripe event payload structure.
 */
function isValidStripeEvent(body: unknown): body is StripeEvent {
  if (!body || typeof body !== 'object') return false;
  const event = body as Record<string, unknown>;

  // Check required top-level fields
  if (typeof event.id !== 'string' || !event.id) return false;
  if (typeof event.type !== 'string' || !event.type) return false;

  // Check data.object structure
  if (!event.data || typeof event.data !== 'object') return false;
  const data = event.data as Record<string, unknown>;
  if (!data.object || typeof data.object !== 'object') return false;

  const obj = data.object as Record<string, unknown>;
  if (typeof obj.id !== 'string' || !obj.id) return false;
  if (typeof obj.customer !== 'string' || !obj.customer) return false;
  // subscription can be null or undefined for one-off invoices
  if (obj.subscription !== undefined && obj.subscription !== null && typeof obj.subscription !== 'string') {
    return false;
  }

  return true;
}

/**
 * Handle POST requests from Stripe webhooks.
 *
 * Processes invoice.payment_failed events by starting a dunning workflow.
 * Other event types are acknowledged but not processed.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    console.log('[stripe-webhook] Failed to parse JSON body');
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  // Validate payload structure
  if (!isValidStripeEvent(body)) {
    console.log('[stripe-webhook] Malformed payload structure', body);
    return NextResponse.json(
      { error: 'Malformed webhook payload' },
      { status: 400 }
    );
  }

  const event = body;
  console.log(`[stripe-webhook] Received event: type=${event.type} id=${event.id}`);

  // Only handle invoice.payment_failed events
  if (event.type !== 'invoice.payment_failed') {
    console.log(`[stripe-webhook] Ignoring event type: ${event.type}`);
    return NextResponse.json({ received: true, processed: false });
  }

  // Check for duplicate event (idempotency)
  if (dunningStore.hasProcessedEvent(event.id)) {
    console.log(`[stripe-webhook] Duplicate event ignored: ${event.id}`);
    return NextResponse.json({ received: true, processed: false, reason: 'duplicate' });
  }

  // Extract IDs from the event
  const invoiceId = event.data.object.id;
  const customerId = event.data.object.customer;
  const subscriptionId = event.data.object.subscription || undefined;

  console.log(
    `[stripe-webhook] Processing invoice.payment_failed: ` +
    `invoice=${invoiceId} customer=${customerId} subscription=${subscriptionId}`
  );

  // Mark event as processed BEFORE starting workflow (prevents race conditions)
  dunningStore.markEventProcessed(event.id);

  // Prepare workflow input
  // Note: subscriptionId may be undefined for one-off invoices, use empty string as fallback
  const workflowInput: DunningWorkflowInput = {
    provider: 'stripe',
    invoiceId,
    customerId,
    subscriptionId: subscriptionId || '',
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
    subscriptionId: subscriptionId || '',
  });

  console.log(`[stripe-webhook] Workflow started: runId=${runId}`);

  return NextResponse.json({
    received: true,
    processed: true,
    runId,
    invoiceId,
  });
}
