import {
  createOutreachApplicationToken,
  createOutreachUnsubscribeToken,
} from './outreachComplianceCore';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildOutreachUnsubscribeUrl(input: {
  organizationId: number;
  sourcedCandidateId: number;
  campaignId: string;
  campaignRound: number;
  email: string;
}): string {
  const token = createOutreachUnsubscribeToken(input);
  const baseUrl = (process.env.BASE_URL || 'http://localhost:5000').replace(/\/$/, '');
  return `${baseUrl}/api/outreach/unsubscribe?token=${encodeURIComponent(token)}`;
}

export function buildOutreachApplicationUrl(input: {
  publicJobUrl: string;
  organizationId: number;
  jobId: number;
  sourcedCandidateId: number;
  campaignId: string;
  campaignRound: number;
}): string {
  const token = createOutreachApplicationToken(input);
  const separator = input.publicJobUrl.includes('?') ? '&' : '?';
  return `${input.publicJobUrl}${separator}outreach=${encodeURIComponent(token)}`;
}

export function appendOutreachComplianceFooter(
  html: string,
  text: string,
  unsubscribeUrl: string,
): { html: string; text: string } {
  return {
    html: `${html}
      <p style="margin:16px 0 0;color:#64748b;font-size:12px;">
        Do not want outreach from this hiring team?
        <a href="${escapeHtml(unsubscribeUrl)}" style="color:#475569;">Unsubscribe</a>
      </p>`,
    text: `${text}\n\nStop outreach from this hiring team: ${unsubscribeUrl}`,
  };
}

export function buildBrevoCorrelationHeader(deliveryId: string): string {
  return `delivery_id:${deliveryId}`;
}

export function buildOutreachDeliveryKey(
  sourcedCandidateId: number,
  campaignRound: number,
): string {
  return `candidate:${sourcedCandidateId}:round:${campaignRound}`;
}

export function parseBrevoCorrelationHeader(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/(?:^|\|)delivery_id:([0-9a-f-]{36})(?:\||$)/i);
  return match?.[1]?.toLowerCase() ?? null;
}
