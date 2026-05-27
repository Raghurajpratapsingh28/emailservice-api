import { Counter, Histogram } from 'prom-client';

/**
 * Prometheus metrics for security-sensitive auth events.
 * Imported via the auth.plugin so they're registered exactly once.
 */
export const authLoginAttempts = new Counter({
  name: 'auth_login_attempts_total',
  help: 'Total login attempts',
  labelNames: ['outcome'] as const, // success | invalid_credentials | locked | disabled
});

export const authRefreshOutcomes = new Counter({
  name: 'auth_refresh_outcomes_total',
  help: 'Refresh token rotation outcomes',
  labelNames: ['outcome'] as const, // success | invalid | expired | reuse | grace
});

export const authTokenRevocations = new Counter({
  name: 'auth_token_revocations_total',
  help: 'Refresh + access token revocations',
  labelNames: ['kind', 'reason'] as const, // refresh|access ; logout|reset|family_compromised|admin
});

export const authPermissionDenials = new Counter({
  name: 'auth_permission_denials_total',
  help: 'RBAC permission denials',
  labelNames: ['workspace_role'] as const,
});

export const authPasswordOps = new Counter({
  name: 'auth_password_ops_total',
  help: 'Password operations',
  labelNames: ['op', 'outcome'] as const, // op: forgot|reset|change ; outcome: success|invalid|user_not_found
});

export const authBcryptDuration = new Histogram({
  name: 'auth_bcrypt_duration_seconds',
  help: 'Bcrypt operation latency',
  labelNames: ['op'] as const,
  buckets: [0.05, 0.1, 0.2, 0.5, 1, 2],
});
