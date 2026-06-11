import type { Database } from '@shared/database/client.js';
import type { Redis } from 'ioredis';
import { AnalyticsRepository } from '../repositories/analytics.repository.js';
import type { BillingService } from '@modules/billing/services/billing.service.js';

const CACHE_TTL_S = 60; // 1 minute — dashboard data can be slightly stale

export class AnalyticsService {
  private repo: AnalyticsRepository;

  constructor(
    db: Database,
    private redis: Redis,
    private billing: BillingService,
  ) {
    this.repo = new AnalyticsRepository(db);
  }

  async getWorkspaceSummary(workspaceId: string) {
    const cacheKey = `analytics:summary:${workspaceId}`;
    const cached = await this.redis.get(cacheKey).catch(() => null);
    if (cached) {
      try {
        return JSON.parse(cached) as WorkspaceSummary;
      } catch {
        // fall through
      }
    }

    const [
      campaignStats,
      deliveryStats,
      contactStats,
      contactGrowth,
      segmentStats,
      workflowStats,
      domainStats,
      memberStats,
      usageSnapshot,
      subscription,
    ] = await Promise.all([
      this.repo.getCampaignStats(workspaceId),
      this.repo.getCampaignDeliveryStats(workspaceId),
      this.repo.getContactStats(workspaceId),
      this.repo.getContactGrowthTimeline(workspaceId, 30),
      this.repo.getSegmentStats(workspaceId),
      this.repo.getWorkflowStats(workspaceId),
      this.repo.getDomainStats(workspaceId),
      this.repo.getMemberStats(workspaceId),
      this.billing.getUsage(workspaceId),
      this.billing.getSubscription(workspaceId).catch(() => null),
    ]);

    const totalSent = Number(deliveryStats.total) || 0;
    const openRate = totalSent > 0 ? Number(deliveryStats.opened) / totalSent : 0;
    const clickRate = totalSent > 0 ? Number(deliveryStats.clicked) / totalSent : 0;
    const deliveryRate = totalSent > 0 ? Number(deliveryStats.delivered) / totalSent : 0;
    const bounceRate = totalSent > 0 ? Number(deliveryStats.bounced) / totalSent : 0;

    const summary: WorkspaceSummary = {
      generatedAt: new Date().toISOString(),
      campaigns: {
        total: Number(campaignStats.totals.total),
        sent: Number(campaignStats.totals.sent),
        draft: Number(campaignStats.totals.draft),
        sending: Number(campaignStats.totals.sending),
        scheduled: Number(campaignStats.totals.scheduled),
        recent: campaignStats.recent.map((c) => ({
          id: c.id,
          name: c.name,
          status: c.status,
          sentCount: c.sentCount,
          recipientCount: c.recipientCount,
          failedCount: c.failedCount,
          createdAt: c.createdAt.toISOString(),
          completedAt: c.completedAt?.toISOString() ?? null,
        })),
        delivery: {
          totalRecipients: totalSent,
          delivered: Number(deliveryStats.delivered),
          opened: Number(deliveryStats.opened),
          clicked: Number(deliveryStats.clicked),
          bounced: Number(deliveryStats.bounced),
          unsubscribed: Number(deliveryStats.unsubscribed),
          openRate: parseFloat(openRate.toFixed(4)),
          clickRate: parseFloat(clickRate.toFixed(4)),
          deliveryRate: parseFloat(deliveryRate.toFixed(4)),
          bounceRate: parseFloat(bounceRate.toFixed(4)),
        },
      },
      contacts: {
        total: Number(contactStats.total),
        active: Number(contactStats.active),
        suppressed: Number(contactStats.suppressed),
        unsubscribed: Number(contactStats.unsubscribed),
        addedLast30Days: Number(contactStats.addedLast30Days),
        addedLast7Days: Number(contactStats.addedLast7Days),
        leads: Number(contactStats.leads),
        customers: Number(contactStats.customers),
        growthTimeline: contactGrowth.map((r) => ({ day: r.day, count: Number(r.count) })),
      },
      segments: {
        total: Number(segmentStats.totals.total),
        dynamic: Number(segmentStats.totals.dynamic),
        static: Number(segmentStats.totals.static),
        ready: Number(segmentStats.totals.ready),
        top: segmentStats.top.map((s) => ({
          id: s.id,
          name: s.name,
          contactCount: s.contactCount,
          type: s.type,
        })),
      },
      workflows: {
        total: Number(workflowStats.totals.total),
        published: Number(workflowStats.totals.published),
        draft: Number(workflowStats.totals.draft),
        paused: Number(workflowStats.totals.paused),
        executions: {
          total: Number(workflowStats.executions.total),
          running: Number(workflowStats.executions.running),
          completed: Number(workflowStats.executions.completed),
          failed: Number(workflowStats.executions.failed),
        },
      },
      domains: {
        total: Number(domainStats.total),
        verified: Number(domainStats.verified),
        pending: Number(domainStats.pending),
        failed: Number(domainStats.failed),
      },
      members: {
        total: memberStats.members,
        pendingInvites: memberStats.pendingInvites,
      },
      usage: {
        contacts: { used: usageSnapshot.contacts.used, limit: usageSnapshot.contacts.limit },
        emails: { used: usageSnapshot.emails.used, limit: usageSnapshot.emails.limit },
        events: { used: usageSnapshot.events.used, limit: usageSnapshot.events.limit },
        periodStart: usageSnapshot.periodStart.toISOString(),
        periodEnd: usageSnapshot.periodEnd.toISOString(),
      },
      subscription: subscription
        ? {
            plan: subscription.plan,
            status: subscription.status,
            billingInterval: subscription.billingInterval ?? null,
            currentPeriodEnd: subscription.currentPeriodEnd
              ? new Date(subscription.currentPeriodEnd).toISOString()
              : null,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
          }
        : null,
    };

    await this.redis
      .set(cacheKey, JSON.stringify(summary), 'EX', CACHE_TTL_S)
      .catch(() => undefined);

    return summary;
  }
}

// ─── Response shape ───────────────────────────────────────────────────────────

export interface WorkspaceSummary {
  generatedAt: string;
  campaigns: {
    total: number;
    sent: number;
    draft: number;
    sending: number;
    scheduled: number;
    recent: Array<{
      id: string;
      name: string;
      status: string;
      sentCount: number;
      recipientCount: number;
      failedCount: number;
      createdAt: string;
      completedAt: string | null;
    }>;
    delivery: {
      totalRecipients: number;
      delivered: number;
      opened: number;
      clicked: number;
      bounced: number;
      unsubscribed: number;
      openRate: number;
      clickRate: number;
      deliveryRate: number;
      bounceRate: number;
    };
  };
  contacts: {
    total: number;
    active: number;
    suppressed: number;
    unsubscribed: number;
    addedLast30Days: number;
    addedLast7Days: number;
    leads: number;
    customers: number;
    growthTimeline: Array<{ day: string; count: number }>;
  };
  segments: {
    total: number;
    dynamic: number;
    static: number;
    ready: number;
    top: Array<{ id: string; name: string; contactCount: number; type: string }>;
  };
  workflows: {
    total: number;
    published: number;
    draft: number;
    paused: number;
    executions: { total: number; running: number; completed: number; failed: number };
  };
  domains: { total: number; verified: number; pending: number; failed: number };
  members: { total: number; pendingInvites: number };
  usage: {
    contacts: { used: number; limit: number };
    emails: { used: number; limit: number };
    events: { used: number; limit: number };
    periodStart: string;
    periodEnd: string;
  };
  subscription: {
    plan: string;
    status: string;
    billingInterval: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  } | null;
}
