import { and, count, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from '@shared/database/client.js';
import { campaigns, campaignRecipients } from '@shared/database/schema/campaigns.js';
import { contacts } from '@shared/database/schema/contacts.js';
import { segments } from '@shared/database/schema/segments.js';
import { workflows, workflowExecutions } from '@shared/database/schema/workflows.js';
import { domains } from '@shared/database/schema/domains.js';
import { workspaceMembers } from '@shared/database/schema/roles.js';
import { invites } from '@shared/database/schema/auth.js';

export class AnalyticsRepository {
  constructor(private db: Database) {}

  async getCampaignStats(workspaceId: string) {
    const [totals, recent] = await Promise.all([
      this.db
        .select({
          total: count(),
          sent: sql<number>`count(*) filter (where ${campaigns.status} = 'sent')`,
          draft: sql<number>`count(*) filter (where ${campaigns.status} = 'draft')`,
          sending: sql<number>`count(*) filter (where ${campaigns.status} = 'sending')`,
          scheduled: sql<number>`count(*) filter (where ${campaigns.status} = 'scheduled')`,
        })
        .from(campaigns)
        .where(and(eq(campaigns.workspaceId, workspaceId), isNull(campaigns.deletedAt))),

      this.db
        .select({
          id: campaigns.id,
          name: campaigns.name,
          status: campaigns.status,
          sentCount: campaigns.sentCount,
          recipientCount: campaigns.recipientCount,
          failedCount: campaigns.failedCount,
          createdAt: campaigns.createdAt,
          completedAt: campaigns.completedAt,
        })
        .from(campaigns)
        .where(and(eq(campaigns.workspaceId, workspaceId), isNull(campaigns.deletedAt)))
        .orderBy(sql`${campaigns.createdAt} desc`)
        .limit(5),
    ]);

    return { totals: totals[0]!, recent };
  }

  async getCampaignDeliveryStats(workspaceId: string) {
    const rows = await this.db
      .select({
        total: count(),
        delivered: sql<number>`count(*) filter (where ${campaignRecipients.status} in ('delivered','opened','clicked'))`,
        opened: sql<number>`count(*) filter (where ${campaignRecipients.status} in ('opened','clicked'))`,
        clicked: sql<number>`count(*) filter (where ${campaignRecipients.status} = 'clicked')`,
        bounced: sql<number>`count(*) filter (where ${campaignRecipients.status} = 'bounced')`,
        unsubscribed: sql<number>`count(*) filter (where ${campaignRecipients.status} = 'unsubscribed')`,
      })
      .from(campaignRecipients)
      .where(eq(campaignRecipients.workspaceId, workspaceId));

    return rows[0]!;
  }

  async getContactStats(workspaceId: string) {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const rows = await this.db
      .select({
        total: count(),
        active: sql<number>`count(*) filter (where ${contacts.emailSuppressed} = false and ${contacts.unsubscribed} = false and ${contacts.deletedAt} is null)`,
        suppressed: sql<number>`count(*) filter (where ${contacts.emailSuppressed} = true)`,
        unsubscribed: sql<number>`count(*) filter (where ${contacts.unsubscribed} = true)`,
        addedLast30Days: sql<number>`count(*) filter (where ${contacts.createdAt} >= ${thirtyDaysAgo}::timestamptz and ${contacts.deletedAt} is null)`,
        addedLast7Days: sql<number>`count(*) filter (where ${contacts.createdAt} >= ${sevenDaysAgo}::timestamptz and ${contacts.deletedAt} is null)`,
        leads: sql<number>`count(*) filter (where ${contacts.lifecycleStage} = 'lead' and ${contacts.deletedAt} is null)`,
        customers: sql<number>`count(*) filter (where ${contacts.lifecycleStage} = 'customer' and ${contacts.deletedAt} is null)`,
      })
      .from(contacts)
      .where(eq(contacts.workspaceId, workspaceId));

    return rows[0]!;
  }

  async getContactGrowthTimeline(workspaceId: string, days = 30) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const rows = await this.db
      .select({
        day: sql<string>`date_trunc('day', ${contacts.createdAt})::date::text`,
        count: count(),
      })
      .from(contacts)
      .where(
        and(
          eq(contacts.workspaceId, workspaceId),
          sql`${contacts.createdAt} >= ${since}::timestamptz`,
          isNull(contacts.deletedAt),
        ),
      )
      .groupBy(sql`date_trunc('day', ${contacts.createdAt})`)
      .orderBy(sql`date_trunc('day', ${contacts.createdAt})`);

    return rows;
  }

  async getSegmentStats(workspaceId: string) {
    const [totals, top] = await Promise.all([
      this.db
        .select({
          total: count(),
          dynamic: sql<number>`count(*) filter (where ${segments.type} = 'dynamic')`,
          static: sql<number>`count(*) filter (where ${segments.type} = 'static')`,
          ready: sql<number>`count(*) filter (where ${segments.status} = 'ready')`,
        })
        .from(segments)
        .where(and(eq(segments.workspaceId, workspaceId), isNull(segments.deletedAt))),

      this.db
        .select({ id: segments.id, name: segments.name, contactCount: segments.contactCount, type: segments.type })
        .from(segments)
        .where(and(eq(segments.workspaceId, workspaceId), isNull(segments.deletedAt)))
        .orderBy(sql`${segments.contactCount} desc`)
        .limit(5),
    ]);

    return { totals: totals[0]!, top };
  }

  async getWorkflowStats(workspaceId: string) {
    const [totals, execStats] = await Promise.all([
      this.db
        .select({
          total: count(),
          published: sql<number>`count(*) filter (where ${workflows.status} = 'published')`,
          draft: sql<number>`count(*) filter (where ${workflows.status} = 'draft')`,
          paused: sql<number>`count(*) filter (where ${workflows.status} = 'paused')`,
        })
        .from(workflows)
        .where(and(eq(workflows.workspaceId, workspaceId), isNull(workflows.deletedAt))),

      this.db
        .select({
          total: count(),
          running: sql<number>`count(*) filter (where ${workflowExecutions.status} in ('queued','running','waiting'))`,
          completed: sql<number>`count(*) filter (where ${workflowExecutions.status} = 'completed')`,
          failed: sql<number>`count(*) filter (where ${workflowExecutions.status} = 'failed')`,
        })
        .from(workflowExecutions)
        .where(eq(workflowExecutions.workspaceId, workspaceId)),
    ]);

    return { totals: totals[0]!, executions: execStats[0]! };
  }

  async getDomainStats(workspaceId: string) {
    const rows = await this.db
      .select({
        total: count(),
        verified: sql<number>`count(*) filter (where ${domains.status} = 'verified')`,
        pending: sql<number>`count(*) filter (where ${domains.status} in ('pending','verifying'))`,
        failed: sql<number>`count(*) filter (where ${domains.status} = 'failed')`,
      })
      .from(domains)
      .where(
        and(
          eq(domains.workspaceId, workspaceId),
          sql`${domains.status} not in ('deleted','deleting')`,
        ),
      );

    return rows[0]!;
  }

  async getMemberStats(workspaceId: string) {
    const [memberRows, pendingRows] = await Promise.all([
      this.db
        .select({ total: count() })
        .from(workspaceMembers)
        .where(eq(workspaceMembers.workspaceId, workspaceId)),

      this.db
        .select({ total: count() })
        .from(invites)
        .where(
          and(
            eq(invites.workspaceId, workspaceId),
            isNull(invites.acceptedAt),
            isNull(invites.revokedAt),
            sql`${invites.expiresAt} >= ${new Date().toISOString()}::timestamptz`,
          ),
        ),
    ]);

    return {
      members: Number(memberRows[0]?.total ?? 0),
      pendingInvites: Number(pendingRows[0]?.total ?? 0),
    };
  }
}
