/**
 * Inline HTML email templates for system/auth emails.
 *
 * These are rendered on the API side before publishing to NATS — the email
 * worker only accepts pre-rendered html/text, it has no template engine.
 */

export interface TemplateResult {
  html: string;
  text: string;
}

// ─── Shared layout ────────────────────────────────────────────────────────────

function layout(body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>EngageIQ</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f4f4f5;padding:40px 0;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" width="560" style="background:#ffffff;border-radius:8px;padding:40px;max-width:560px;">
        <tr><td>
          <p style="margin:0 0 32px;font-size:22px;font-weight:700;color:#0f172a;">EngageIQ</p>
          ${body}
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:32px 0;" />
          <p style="margin:0;font-size:12px;color:#94a3b8;">You received this email because you have an account with EngageIQ. If you didn't request this, you can safely ignore it.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function btn(url: string, label: string): string {
  return `<a href="${url}" style="display:inline-block;padding:12px 24px;background:#6366f1;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;font-size:15px;">${label}</a>`;
}

// ─── auth.email_verification ──────────────────────────────────────────────────

interface EmailVerificationData {
  url: string;
  expiresInHours: number;
}

function emailVerification(data: EmailVerificationData): TemplateResult {
  const html = layout(`
    <h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#0f172a;">Verify your email address</h1>
    <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.6;">Click the button below to verify your email address. This link expires in ${data.expiresInHours} hour${data.expiresInHours !== 1 ? 's' : ''}.</p>
    <p style="margin:0 0 24px;">${btn(data.url, 'Verify Email')}</p>
    <p style="margin:0;font-size:13px;color:#94a3b8;">Or copy this link:<br/><a href="${data.url}" style="color:#6366f1;word-break:break-all;">${data.url}</a></p>
  `);

  const text = `Verify your email address\n\nClick the link below to verify your email. This link expires in ${data.expiresInHours} hour${data.expiresInHours !== 1 ? 's' : ''}.\n\n${data.url}\n\nIf you didn't create an account, you can ignore this email.`;

  return { html, text };
}

// ─── auth.password_reset ──────────────────────────────────────────────────────

interface PasswordResetData {
  resetUrl: string;
  expiresInMinutes: number;
}

function passwordReset(data: PasswordResetData): TemplateResult {
  const html = layout(`
    <h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#0f172a;">Reset your password</h1>
    <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.6;">We received a request to reset your EngageIQ password. Click the button below. This link expires in ${data.expiresInMinutes} minutes.</p>
    <p style="margin:0 0 24px;">${btn(data.resetUrl, 'Reset Password')}</p>
    <p style="margin:0;font-size:13px;color:#94a3b8;">Or copy this link:<br/><a href="${data.resetUrl}" style="color:#6366f1;word-break:break-all;">${data.resetUrl}</a></p>
  `);

  const text = `Reset your password\n\nWe received a request to reset your EngageIQ password. Click the link below (expires in ${data.expiresInMinutes} minutes):\n\n${data.resetUrl}\n\nIf you didn't request a password reset, you can safely ignore this email.`;

  return { html, text };
}

// ─── auth.invite ──────────────────────────────────────────────────────────────

interface InviteData {
  acceptUrl: string;
  role: string;
  expiresInDays: number;
}

function invite(data: InviteData): TemplateResult {
  const html = layout(`
    <h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#0f172a;">You've been invited to EngageIQ</h1>
    <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.6;">You've been invited to join a workspace as <strong>${data.role}</strong>. This invitation expires in ${data.expiresInDays} day${data.expiresInDays !== 1 ? 's' : ''}.</p>
    <p style="margin:0 0 24px;">${btn(data.acceptUrl, 'Accept Invitation')}</p>
    <p style="margin:0;font-size:13px;color:#94a3b8;">Or copy this link:<br/><a href="${data.acceptUrl}" style="color:#6366f1;word-break:break-all;">${data.acceptUrl}</a></p>
  `);

  const text = `You've been invited to EngageIQ\n\nYou've been invited to join a workspace as ${data.role}. Accept your invitation (expires in ${data.expiresInDays} day${data.expiresInDays !== 1 ? 's' : ''}):\n\n${data.acceptUrl}\n\nIf you weren't expecting this invite, you can safely ignore this email.`;

  return { html, text };
}

// ─── domain.verification.reminder ────────────────────────────────────────────

interface DomainReminderData {
  domain: string;
  dashboardUrl?: string;
}

function domainVerificationReminder(data: DomainReminderData): TemplateResult {
  const url = data.dashboardUrl ?? 'https://app.engageiq.io/domains';
  const html = layout(`
    <h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#0f172a;">Your domain is still unverified</h1>
    <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6;">We're still waiting for DNS records to propagate for <strong>${data.domain}</strong>. Make sure you've added the DKIM CNAME records to your domain registrar.</p>
    <p style="margin:0 0 24px;font-size:15px;color:#475569;">DNS changes can take up to 48 hours to propagate globally — no action is needed if you've already added the records.</p>
    <p style="margin:0 0 24px;">${btn(url, 'View DNS Records')}</p>
  `);

  const text = `Your domain is still unverified\n\nWe're still waiting for DNS records for ${data.domain}. If you haven't added the DKIM CNAME records to your registrar yet, please do so now.\n\nDNS propagation can take up to 48 hours. View your DNS records: ${url}`;

  return { html, text };
}

// ─── domain.verification.expired ─────────────────────────────────────────────

interface DomainExpiredData {
  domain: string;
  dashboardUrl?: string;
}

function domainVerificationExpired(data: DomainExpiredData): TemplateResult {
  const url = data.dashboardUrl ?? 'https://app.engageiq.io/domains';
  const html = layout(`
    <h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#0f172a;">Domain verification expired</h1>
    <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.6;">The verification window for <strong>${data.domain}</strong> has expired after 30 days. To resume sending from this domain, please delete it and add it again to start a fresh verification window.</p>
    <p style="margin:0 0 24px;">${btn(url, 'Manage Domains')}</p>
  `);

  const text = `Domain verification expired\n\nThe 30-day verification window for ${data.domain} has expired. To resume sending, delete the domain and re-add it to start a fresh verification window.\n\nManage domains: ${url}`;

  return { html, text };
}

// ─── Public render function ───────────────────────────────────────────────────

export function renderTemplate(template: string, data: Record<string, unknown>): TemplateResult {
  switch (template) {
    case 'auth.email_verification':
      return emailVerification(data as unknown as EmailVerificationData);
    case 'auth.password_reset':
      return passwordReset(data as unknown as PasswordResetData);
    case 'auth.invite':
      return invite(data as unknown as InviteData);
    case 'domain.verification.reminder':
      return domainVerificationReminder(data as unknown as DomainReminderData);
    case 'domain.verification.expired':
      return domainVerificationExpired(data as unknown as DomainExpiredData);
    default:
      throw new Error(`Unknown email template: ${template}`);
  }
}
