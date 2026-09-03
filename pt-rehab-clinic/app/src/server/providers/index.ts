/**
 * Delivery adapters (spec §10). One interface, so the provider can be swapped
 * without touching the reminder queue. Defaults: Semaphore for PH SMS, Resend
 * for email — both chosen in the spec, neither built from scratch.
 */
export interface DeliveryResult { providerMessageId: string | null }

export interface MessageSender {
  sendSms(to: string, body: string): Promise<DeliveryResult>;
  sendEmail(to: string, subject: string, body: string): Promise<DeliveryResult>;
}

class LoggingSender implements MessageSender {
  async sendSms(to: string, body: string) {
    console.info(`[reminder:sms:dry-run] ${to} :: ${body}`);
    return { providerMessageId: null };
  }
  async sendEmail(to: string, subject: string, body: string) {
    console.info(`[reminder:email:dry-run] ${to} :: ${subject} :: ${body}`);
    return { providerMessageId: null };
  }
}

class LiveSender implements MessageSender {
  async sendSms(to: string, body: string): Promise<DeliveryResult> {
    const res = await fetch('https://api.semaphore.co/api/v4/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        apikey: process.env.SEMAPHORE_API_KEY,
        number: to,
        message: body,
        sendername: process.env.SEMAPHORE_SENDER_NAME,
      }),
    });
    if (!res.ok) throw new Error(`Semaphore refused the message (${res.status}).`);
    const payload = (await res.json()) as Array<{ message_id?: string | number }>;
    return { providerMessageId: payload?.[0]?.message_id?.toString() ?? null };
  }

  async sendEmail(to: string, subject: string, body: string): Promise<DeliveryResult> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.REMINDER_FROM_EMAIL,
        to,
        subject,
        text: body,
      }),
    });
    if (!res.ok) throw new Error(`Resend refused the message (${res.status}).`);
    const payload = (await res.json()) as { id?: string };
    return { providerMessageId: payload?.id ?? null };
  }
}

/**
 * Without credentials the app logs instead of sending. That is deliberate: an
 * unconfigured clinic should never silently fail to reach a patient, nor
 * accidentally message one from a staging environment.
 */
export function messageSender(): MessageSender {
  const configured = process.env.SEMAPHORE_API_KEY || process.env.RESEND_API_KEY;
  return configured ? new LiveSender() : new LoggingSender();
}
