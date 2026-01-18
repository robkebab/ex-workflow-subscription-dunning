/**
 * Test endpoint for simulating invoice payment.
 *
 * This endpoint allows developers to simulate a customer paying an invoice
 * during dunning. Used to test the recovery path where a workflow detects
 * payment and terminates early with a 'recovered' outcome.
 */

import { NextRequest, NextResponse } from 'next/server';
import { dunningStore } from '@/lib/dunning/store';

/**
 * Request body structure for paying an invoice.
 */
interface PayInvoiceRequest {
  invoiceId: string;
}

/**
 * Validates the request body structure.
 */
function isValidRequest(body: unknown): body is PayInvoiceRequest {
  if (!body || typeof body !== 'object') return false;
  const req = body as Record<string, unknown>;

  if (typeof req.invoiceId !== 'string' || !req.invoiceId) return false;

  return true;
}

/**
 * Handle POST requests to simulate paying an invoice.
 *
 * This marks the invoice as paid in the mock store, which will be detected
 * by the dunning workflow's checkInvoiceStatus step on its next check.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    console.log('[pay-invoice] Failed to parse JSON body');
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  // Validate request structure
  if (!isValidRequest(body)) {
    console.log('[pay-invoice] Malformed request body', body);
    return NextResponse.json(
      { error: 'Malformed request body. Required: invoiceId' },
      { status: 400 }
    );
  }

  const { invoiceId } = body;

  console.log(`[pay-invoice] Marking invoice as paid: invoiceId=${invoiceId}`);

  // Check if invoice exists in the store
  const invoice = dunningStore.getInvoice(invoiceId);
  if (!invoice) {
    console.log(`[pay-invoice] Invoice not found: invoiceId=${invoiceId}`);
    return NextResponse.json(
      { error: 'Invoice not found', invoiceId },
      { status: 404 }
    );
  }

  // Check if already paid
  if (invoice.status === 'paid') {
    console.log(`[pay-invoice] Invoice already paid: invoiceId=${invoiceId}`);
    return NextResponse.json({
      success: true,
      invoiceId,
      previousStatus: 'paid',
      message: 'Invoice was already paid',
    });
  }

  const previousStatus = invoice.status;

  // Mark the invoice as paid
  const updated = dunningStore.markInvoicePaid(invoiceId);

  if (!updated) {
    console.error(`[pay-invoice] Failed to update invoice: invoiceId=${invoiceId}`);
    return NextResponse.json(
      { error: 'Failed to update invoice status' },
      { status: 500 }
    );
  }

  console.log(`[pay-invoice] Invoice marked as paid: invoiceId=${invoiceId} previousStatus=${previousStatus}`);

  return NextResponse.json({
    success: true,
    invoiceId,
    previousStatus,
    newStatus: 'paid',
    message: 'Invoice has been marked as paid',
  });
}
