import { Counter } from 'prom-client';

export const contactsCreated = new Counter({
  name: 'contacts_created_total',
  help: 'Total contacts created',
  labelNames: ['workspace_id'] as const,
});

export const contactsUpdated = new Counter({
  name: 'contacts_updated_total',
  help: 'Total contacts updated',
  labelNames: ['workspace_id'] as const,
});

export const segmentsCreated = new Counter({
  name: 'segments_created_total',
  help: 'Total segments created',
  labelNames: ['workspace_id', 'type'] as const,
});

export const segmentsUpdated = new Counter({
  name: 'segments_updated_total',
  help: 'Total segments updated',
  labelNames: ['workspace_id'] as const,
});

export const segmentRefreshQueued = new Counter({
  name: 'segment_refresh_queued_total',
  help: 'Total segment refresh jobs enqueued',
  labelNames: ['workspace_id'] as const,
});
