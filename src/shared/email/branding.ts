import { resourceLimitsForPlan } from '@constants/plan-limits.js';

const BRANDING_FOOTER = `
<div style="margin-top: 32px; padding: 20px; border-radius: 8px; background-color: #f9fafb; text-align: center; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; border: 1px solid #e5e7eb; max-width: 500px; margin-left: auto; margin-right: auto; box-sizing: border-box;">
  <span style="font-size: 10px; font-weight: 700; color: #9ca3af; letter-spacing: 1.5px; text-transform: uppercase; display: block; margin-bottom: 4px;">Sent with</span>
  <a href="https://mailvex.com" style="font-size: 18px; font-weight: 800; color: #6366f1; text-decoration: none; letter-spacing: -0.5px; display: inline-block; margin-bottom: 2px;">Mailvex</a>
  <p style="margin: 0; font-size: 12px; color: #6b7280; font-weight: 500;">Create your own automated email marketing campaigns for free.</p>
</div>`;

/**
 * Appends the Mailvex branding footer to an HTML email body when the
 * workspace's plan does not have `removeBranding` set. Returns the original
 * string unchanged for paid plans.
 */
export function injectBrandingFooter(html: string, plan: string): string {
  if (resourceLimitsForPlan(plan).removeBranding) {
    return html;
  }
  const closeBody = html.lastIndexOf('</body>');
  if (closeBody !== -1) {
    return html.slice(0, closeBody) + BRANDING_FOOTER + html.slice(closeBody);
  }
  return html + BRANDING_FOOTER;
}

