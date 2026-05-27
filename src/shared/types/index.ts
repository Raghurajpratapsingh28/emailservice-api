import type { Permission, RoleSlug } from '@constants/rbac.js';

/** Identity carried on `request.user` after `authenticate`. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  isEmailVerified: boolean;
  isActive: boolean;
}

/** Workspace context carried on `request.workspace` after `workspace-guard`. */
export interface WorkspaceContext {
  id: string;
  slug: string;
  plan: string;
  role: RoleSlug;
  membershipId: string;
}

/** RFC7807-ish error envelope. */
export interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

/** Standard tokens response shape. */
export interface TokensResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number; // seconds until access token expiry
}

/** Pagination envelope for list endpoints. */
export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export type { Permission, RoleSlug };
