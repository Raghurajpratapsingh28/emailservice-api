import { and, eq, gt, lt, isNull, isNotNull, sql, or, SQL, inArray, notInArray } from 'drizzle-orm';

interface WorkerLogger {
  info(obj: Record<string, unknown> | string, msg?: string): void;
  warn(obj: Record<string, unknown> | string, msg?: string): void;
  error(obj: Record<string, unknown> | string, msg?: string): void;
}
import type { Database } from '@shared/database/client.js';
import { contacts } from '@shared/database/schema/contacts.js';
import { eventsRaw } from '@shared/database/schema/events.js';
import type { SegmentRepository } from '@modules/segments/repositories/segment.repository.js';

interface FilterRule {
  field: string;
  operator: string;
  value: string | number;
}

interface FilterGroup {
  operator: 'AND' | 'OR';
  rules: (FilterRule | FilterGroup)[];
}

export class SegmentRefreshProcessor {
  public constructor(
    private readonly db: Database,
    private readonly segmentRepo: SegmentRepository,
    private readonly log: WorkerLogger,
  ) {}

  public async processRefresh(workspaceId: string, segmentId: string): Promise<void> {
    const segment = await this.segmentRepo.findById(workspaceId, segmentId);
    if (!segment) {
      this.log.warn({ workspaceId, segmentId }, 'segment not found for refresh');
      return;
    }

    if (segment.type !== 'dynamic') {
      this.log.warn({ workspaceId, segmentId }, 'cannot refresh static segment');
      return;
    }

    try {
      await this.segmentRepo.update(workspaceId, segmentId, { status: 'computing' });

      const filterTree = segment.filterTree as FilterGroup;
      const contactIds = await this.queryContacts(workspaceId, filterTree);

      await this.db.transaction(async (tx) => {
        await this.segmentRepo.replaceMemberships(tx, workspaceId, segmentId, contactIds);
      });

      await this.segmentRepo.update(workspaceId, segmentId, {
        contactCount: contactIds.length,
        status: 'ready',
        lastComputed: new Date(),
      });

      this.log.info({ workspaceId, segmentId, count: contactIds.length }, 'segment refreshed');
    } catch (err) {
      this.log.error({ err, workspaceId, segmentId }, 'segment refresh failed');
      await this.segmentRepo.update(workspaceId, segmentId, { status: 'failed' });
    }
  }

  private async queryContacts(workspaceId: string, filterTree: FilterGroup): Promise<string[]> {
    const whereClause = this.buildWhereClause(filterTree);
    
    const rows = await this.db
      .select({ id: contacts.id })
      .from(contacts)
      .where(
        and(
          eq(contacts.workspaceId, workspaceId),
          isNull(contacts.deletedAt),
          whereClause,
        ),
      );

    return rows.map((r) => r.id);
  }

  private buildWhereClause(group: FilterGroup): SQL | undefined {
    const conditions: SQL[] = [];

    for (const rule of group.rules) {
      if ('rules' in rule) {
        const nestedCondition = this.buildWhereClause(rule as FilterGroup);
        if (nestedCondition) conditions.push(nestedCondition);
      } else {
        const condition = this.buildRuleCondition(rule as FilterRule);
        if (condition) conditions.push(condition);
      }
    }

    if (conditions.length === 0) return undefined;
    if (conditions.length === 1) return conditions[0];

    return group.operator === 'AND' ? and(...conditions) : or(...conditions);
  }

  private buildRuleCondition(rule: FilterRule): SQL | undefined {
    const { field, operator, value } = rule;

    // Handle event:* fields — value after "event:" is the raw eventName stored in DB
    if (field.startsWith('event:')) {
      const eventName = field.slice('event:'.length);
      return this.buildEventCondition(eventName, operator, value);
    }

    // Handle properties.* fields stored in jsonb
    if (field.startsWith('properties.')) {
      const propKey = field.slice('properties.'.length);
      return this.buildPropertiesCondition(propKey, operator, value);
    }

    // Map field names to database columns, with their types
    const columnMap: Record<string, { col: any; numeric: boolean }> = {
      email:          { col: contacts.email,          numeric: false },
      leadScore:      { col: contacts.leadScore,      numeric: true  },
      lifecycleStage: { col: contacts.lifecycleStage, numeric: false },
      phone:          { col: contacts.phone,          numeric: false },
      firstName:      { col: contacts.firstName,      numeric: false },
      lastName:       { col: contacts.lastName,       numeric: false },
    };

    const entry = columnMap[field];
    if (!entry) {
      this.log.warn({ field }, 'unknown field in segment filter');
      return undefined;
    }

    // Coerce value to number for integer columns — JSONB retrieval can return strings
    const coercedValue = entry.numeric && value !== undefined && value !== null
      ? Number(value)
      : value;

    return this.applyOperator(entry.col, operator, coercedValue);
  }

  private applyOperator(column: any, operator: string, value: string | number | undefined): SQL | undefined {
    switch (operator) {
      case 'equals':
        return sql`${column} = ${value}`;
      case 'not_equals':
        return sql`${column} != ${value}`;
      case 'contains':
        return sql`${column} ILIKE ${'%' + String(value) + '%'}`;
      case 'starts_with':
        return sql`${column} ILIKE ${String(value) + '%'}`;
      case 'ends_with':
        return sql`${column} ILIKE ${'%' + String(value)}`;
      case 'greater_than':
        return gt(column, value as any);
      case 'less_than':
        return lt(column, value as any);
      case 'exists':
        return isNotNull(column);
      case 'not_exists':
        return isNull(column);
      case 'in': {
        const list = String(value).split(',').map((v) => v.trim()).filter(Boolean);
        return list.length > 0 ? inArray(column, list) : undefined;
      }
      case 'not_in': {
        const list = String(value).split(',').map((v) => v.trim()).filter(Boolean);
        return list.length > 0 ? notInArray(column, list) : undefined;
      }
      default:
        this.log.warn({ operator }, 'unknown operator in segment filter');
        return undefined;
    }
  }

  private buildPropertiesCondition(propKey: string, operator: string, value: string | number | undefined): SQL | undefined {
    switch (operator) {
      case 'equals':
        return sql`${contacts.properties}->>${propKey} = ${String(value)}`;
      case 'not_equals':
        return sql`${contacts.properties}->>${propKey} != ${String(value)}`;
      case 'contains':
        return sql`${contacts.properties}->>${propKey} ILIKE ${'%' + String(value) + '%'}`;
      case 'starts_with':
        return sql`${contacts.properties}->>${propKey} ILIKE ${String(value) + '%'}`;
      case 'ends_with':
        return sql`${contacts.properties}->>${propKey} ILIKE ${'%' + String(value)}`;
      case 'greater_than':
        return sql`(${contacts.properties}->>${propKey})::numeric > ${value}`;
      case 'less_than':
        return sql`(${contacts.properties}->>${propKey})::numeric < ${value}`;
      case 'exists':
        return sql`${contacts.properties} ? ${propKey}`;
      case 'not_exists':
        return sql`NOT (${contacts.properties} ? ${propKey})`;
      case 'in': {
        const list = String(value).split(',').map((v) => v.trim()).filter(Boolean);
        if (list.length === 0) return undefined;
        return sql`${contacts.properties}->>${propKey} = ANY(${list})`;
      }
      case 'not_in': {
        const list = String(value).split(',').map((v) => v.trim()).filter(Boolean);
        if (list.length === 0) return undefined;
        return sql`NOT (${contacts.properties}->>${propKey} = ANY(${list}))`;
      }
      default:
        this.log.warn({ operator, propKey }, 'unknown operator for properties field');
        return undefined;
    }
  }

  private buildEventCondition(eventName: string, operator: string, value: string | number | undefined): SQL | undefined {
    switch (operator) {
      case 'exists':
        return sql`EXISTS (
          SELECT 1 FROM ${eventsRaw}
          WHERE ${eventsRaw.userId} = ${contacts.id}::text
            AND ${eventsRaw.eventName} ILIKE ${eventName}
            AND ${eventsRaw.workspaceId} = ${contacts.workspaceId}
        )`;
      case 'not_exists':
        return sql`NOT EXISTS (
          SELECT 1 FROM ${eventsRaw}
          WHERE ${eventsRaw.userId} = ${contacts.id}::text
            AND ${eventsRaw.eventName} ILIKE ${eventName}
            AND ${eventsRaw.workspaceId} = ${contacts.workspaceId}
        )`;
      case 'occurred_within_days': {
        const days = Number(value);
        if (isNaN(days) || days <= 0) return undefined;
        return sql`EXISTS (
          SELECT 1 FROM ${eventsRaw}
          WHERE ${eventsRaw.userId} = ${contacts.id}::text
            AND ${eventsRaw.eventName} ILIKE ${eventName}
            AND ${eventsRaw.workspaceId} = ${contacts.workspaceId}
            AND ${eventsRaw.normalizedTimestamp} >= NOW() - INTERVAL '1 day' * ${days}
        )`;
      }
      default:
        this.log.warn({ operator, eventName }, 'unsupported operator for event field');
        return undefined;
    }
  }
}
