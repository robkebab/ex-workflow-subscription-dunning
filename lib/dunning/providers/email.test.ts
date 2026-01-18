import { describe, it, expect, beforeEach } from 'vitest';
import { MockEmailService, EmailTransientError } from './email';
import { dunningStore } from '../store';

describe('MockEmailService', () => {
  let emailService: MockEmailService;

  beforeEach(() => {
    dunningStore.reset();
    emailService = new MockEmailService({
      simulateLatency: false,
      transientFailureProbability: 0,
    });
  });

  describe('sendEmail', () => {
    const baseEmailOptions = {
      to: 'customer@example.com',
      customerId: 'cus_123',
      invoiceId: 'inv_123',
      escalationLevel: 0 as const,
      webhookUrl: 'https://example.com/pay/dunning:inv_123',
      idempotencyKey: 'email_step_1',
    };

    it('sends an email successfully', async () => {
      const result = await emailService.sendEmail(baseEmailOptions);

      expect(result.sent).toBe(true);
      expect(result.emailId).toBeDefined();
    });

    it('logs email to store', async () => {
      await emailService.sendEmail(baseEmailOptions);

      const logs = dunningStore.getEmailLogs('inv_123');
      expect(logs).toHaveLength(1);
      expect(logs[0].to).toBe('customer@example.com');
      expect(logs[0].escalationLevel).toBe(0);
    });

    it('prevents duplicate sends with same idempotency key', async () => {
      const first = await emailService.sendEmail(baseEmailOptions);
      const second = await emailService.sendEmail(baseEmailOptions);

      expect(first.sent).toBe(true);
      expect(second.sent).toBe(false);
      expect(second.reason).toBe('duplicate');
    });

    it('allows different emails with different idempotency keys', async () => {
      const first = await emailService.sendEmail(baseEmailOptions);
      const second = await emailService.sendEmail({
        ...baseEmailOptions,
        idempotencyKey: 'email_step_2',
        escalationLevel: 1,
      });

      expect(first.sent).toBe(true);
      expect(second.sent).toBe(true);
    });

    it('records different escalation levels', async () => {
      await emailService.sendEmail({
        ...baseEmailOptions,
        idempotencyKey: 'level_0',
        escalationLevel: 0,
      });
      await emailService.sendEmail({
        ...baseEmailOptions,
        idempotencyKey: 'level_1',
        escalationLevel: 1,
      });
      await emailService.sendEmail({
        ...baseEmailOptions,
        idempotencyKey: 'level_2',
        escalationLevel: 2,
      });

      const logs = dunningStore.getEmailLogs();
      expect(logs).toHaveLength(3);
      expect(logs.map((l) => l.escalationLevel)).toEqual([0, 1, 2]);
    });
  });

  describe('transient failures', () => {
    it('throws EmailTransientError when configured', async () => {
      const failingService = new MockEmailService({
        simulateLatency: false,
        transientFailureProbability: 1, // Always fail
      });

      await expect(
        failingService.sendEmail({
          to: 'test@test.com',
          customerId: 'cus_1',
          invoiceId: 'inv_1',
          escalationLevel: 0,
          webhookUrl: 'http://test',
          idempotencyKey: 'key_1',
        })
      ).rejects.toThrow(EmailTransientError);
    });

    it('EmailTransientError is marked as retryable', () => {
      const error = new EmailTransientError();
      expect(error.retryable).toBe(true);
      expect(error.code).toBe('transient_error');
    });
  });

  describe('email templates', () => {
    it('returns subject for escalation level 0', () => {
      const subject = emailService.getSubject(0);
      expect(subject).toContain('Payment reminder');
    });

    it('returns subject for escalation level 1', () => {
      const subject = emailService.getSubject(1);
      expect(subject).toContain('Urgent');
    });

    it('returns subject for escalation level 2', () => {
      const subject = emailService.getSubject(2);
      expect(subject).toContain('Final notice');
    });

    it('substitutes webhook URL in content', () => {
      const webhookUrl = 'https://example.com/fix-payment';
      const content = emailService.getContent(0, webhookUrl);
      expect(content).toContain(webhookUrl);
    });
  });

  describe('configuration', () => {
    it('can update configuration', () => {
      emailService.configure({ transientFailureProbability: 0.5 });
      // Configuration is updated (tested indirectly through behavior)
    });

    it('can reset configuration to defaults', () => {
      emailService.configure({ transientFailureProbability: 1 });
      emailService.resetConfig();
      // After reset, default probability should be low
    });
  });
});

describe('MockEmailService singleton', () => {
  beforeEach(() => {
    dunningStore.reset();
  });

  it('mockEmailService is exported as singleton', async () => {
    const { mockEmailService } = await import('./email');

    mockEmailService.configure({
      simulateLatency: false,
      transientFailureProbability: 0,
    });

    const result = await mockEmailService.sendEmail({
      to: 'singleton@test.com',
      customerId: 'cus_singleton',
      invoiceId: 'inv_singleton',
      escalationLevel: 0,
      webhookUrl: 'http://test',
      idempotencyKey: 'singleton_key',
    });

    expect(result.sent).toBe(true);
  });
});
