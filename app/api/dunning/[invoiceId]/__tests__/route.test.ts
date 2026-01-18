/**
 * Tests for the dunning status endpoint.
 *
 * This endpoint provides visibility into the current state of dunning workflows.
 * Tests verify successful status retrieval, 404 handling for missing workflows,
 * and proper timestamp formatting.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../route';
import { dunningStore } from '@/lib/dunning/store';

/**
 * Helper to create a mock GET request for a specific invoice ID.
 */
function createMockRequest(invoiceId: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/dunning/${invoiceId}`, {
    method: 'GET',
  });
}

/**
 * Helper to create route params matching Next.js App Router convention.
 */
function createRouteParams(invoiceId: string): { params: Promise<{ invoiceId: string }> } {
  return {
    params: Promise.resolve({ invoiceId }),
  };
}

describe('GET /api/dunning/[invoiceId]', () => {
  beforeEach(() => {
    // Reset store state before each test to ensure isolation
    dunningStore.reset();
  });

  describe('successful status retrieval', () => {
    it('returns workflow status for existing invoice', async () => {
      // Create a workflow run in the store
      const runId = 'run_status_001';
      const invoiceId = 'inv_status_001';
      const now = Date.now();

      dunningStore.setWorkflowRun({
        runId,
        invoiceId,
        customerId: 'cus_status_001',
        subscriptionId: 'sub_status_001',
        currentAttempt: 2,
        state: 'running',
        startedAt: now,
      });

      const request = createMockRequest(invoiceId);
      const response = await GET(request, createRouteParams(invoiceId));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.runId).toBe(runId);
      expect(data.invoiceId).toBe(invoiceId);
      expect(data.customerId).toBe('cus_status_001');
      expect(data.subscriptionId).toBe('sub_status_001');
      expect(data.currentAttempt).toBe(2);
      expect(data.state).toBe('running');
    });

    it('returns completed workflow with outcome', async () => {
      const runId = 'run_completed_001';
      const invoiceId = 'inv_completed_001';
      const startTime = Date.now() - 60000; // 1 minute ago
      const endTime = Date.now();

      dunningStore.setWorkflowRun({
        runId,
        invoiceId,
        customerId: 'cus_completed_001',
        subscriptionId: 'sub_completed_001',
        currentAttempt: 1,
        state: 'completed',
        outcome: 'recovered',
        startedAt: startTime,
        completedAt: endTime,
      });

      const request = createMockRequest(invoiceId);
      const response = await GET(request, createRouteParams(invoiceId));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.state).toBe('completed');
      expect(data.outcome).toBe('recovered');
      expect(data.completedAt).toBeDefined();
    });

    it('returns exhausted workflow with final action', async () => {
      const runId = 'run_exhausted_001';
      const invoiceId = 'inv_exhausted_001';
      const startTime = Date.now() - 120000; // 2 minutes ago
      const endTime = Date.now();

      dunningStore.setWorkflowRun({
        runId,
        invoiceId,
        customerId: 'cus_exhausted_001',
        subscriptionId: 'sub_exhausted_001',
        currentAttempt: 3,
        state: 'completed',
        outcome: 'exhausted',
        finalAction: 'pause',
        startedAt: startTime,
        completedAt: endTime,
      });

      const request = createMockRequest(invoiceId);
      const response = await GET(request, createRouteParams(invoiceId));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.state).toBe('completed');
      expect(data.outcome).toBe('exhausted');
      expect(data.finalAction).toBe('pause');
    });

    it('returns timestamps in ISO format', async () => {
      const runId = 'run_timestamps_001';
      const invoiceId = 'inv_timestamps_001';
      const startTime = new Date('2024-01-15T10:30:00.000Z').getTime();
      const endTime = new Date('2024-01-15T10:35:00.000Z').getTime();

      dunningStore.setWorkflowRun({
        runId,
        invoiceId,
        customerId: 'cus_timestamps_001',
        subscriptionId: 'sub_timestamps_001',
        currentAttempt: 2,
        state: 'completed',
        outcome: 'recovered',
        startedAt: startTime,
        completedAt: endTime,
      });

      const request = createMockRequest(invoiceId);
      const response = await GET(request, createRouteParams(invoiceId));
      const data = await response.json();

      expect(response.status).toBe(200);
      // Verify ISO format by parsing
      expect(new Date(data.startedAt).toISOString()).toBe(data.startedAt);
      expect(new Date(data.completedAt).toISOString()).toBe(data.completedAt);
    });
  });

  describe('404 handling', () => {
    it('returns 404 when no workflow exists for invoice', async () => {
      const invoiceId = 'inv_nonexistent_001';

      const request = createMockRequest(invoiceId);
      const response = await GET(request, createRouteParams(invoiceId));
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('No dunning workflow found for this invoice');
    });

    it('returns 404 for empty invoice ID', async () => {
      const invoiceId = '';

      const request = createMockRequest(invoiceId);
      const response = await GET(request, createRouteParams(invoiceId));
      const data = await response.json();

      expect(response.status).toBe(404);
    });
  });

  describe('edge cases', () => {
    it('returns most recent workflow when multiple exist for same invoice', async () => {
      const invoiceId = 'inv_multiple_001';

      // Create an older workflow run
      dunningStore.setWorkflowRun({
        runId: 'run_old_001',
        invoiceId,
        customerId: 'cus_multiple_001',
        subscriptionId: 'sub_multiple_001',
        currentAttempt: 3,
        state: 'completed',
        outcome: 'exhausted',
        finalAction: 'pause',
        startedAt: Date.now() - 200000, // Older
        completedAt: Date.now() - 100000,
      });

      // Create a newer workflow run
      dunningStore.setWorkflowRun({
        runId: 'run_new_001',
        invoiceId,
        customerId: 'cus_multiple_001',
        subscriptionId: 'sub_multiple_001',
        currentAttempt: 1,
        state: 'running',
        startedAt: Date.now() - 1000, // Newer
      });

      const request = createMockRequest(invoiceId);
      const response = await GET(request, createRouteParams(invoiceId));
      const data = await response.json();

      expect(response.status).toBe(200);
      // Should return the most recent run
      expect(data.runId).toBe('run_new_001');
      expect(data.state).toBe('running');
    });

    it('omits completedAt when workflow is still running', async () => {
      const runId = 'run_running_001';
      const invoiceId = 'inv_running_001';

      dunningStore.setWorkflowRun({
        runId,
        invoiceId,
        customerId: 'cus_running_001',
        subscriptionId: 'sub_running_001',
        currentAttempt: 1,
        state: 'running',
        startedAt: Date.now(),
      });

      const request = createMockRequest(invoiceId);
      const response = await GET(request, createRouteParams(invoiceId));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.completedAt).toBeUndefined();
    });

    it('handles failed workflow state', async () => {
      const runId = 'run_failed_001';
      const invoiceId = 'inv_failed_001';

      dunningStore.setWorkflowRun({
        runId,
        invoiceId,
        customerId: 'cus_failed_001',
        subscriptionId: 'sub_failed_001',
        currentAttempt: 2,
        state: 'failed',
        startedAt: Date.now() - 30000,
        completedAt: Date.now(),
      });

      const request = createMockRequest(invoiceId);
      const response = await GET(request, createRouteParams(invoiceId));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.state).toBe('failed');
      expect(data.outcome).toBeUndefined();
    });
  });
});
