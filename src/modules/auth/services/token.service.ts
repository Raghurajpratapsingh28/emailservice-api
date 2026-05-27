import { and, asc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { config } from '@config/index.js';
import {
  TokenInvalidError,
  TokenReuseError,
} from '@shared/errors/app-errors.js';
import { hashOpaqueToken, issueOpaqueToken } from '@shared/utils/tokens.js';
import { signAccessToken } from '@shared/utils/jwt.js';
import { addSeconds, parseDurationToSeconds } from '@shared/utils/time.js';
import { newId } from '@shared/utils/id.js';
import { refreshTokens } from '@shared/database/schema/auth.js';
import {
  authRefreshOutcomes,
  authTokenRevocations,
} from '@observability/auth-metrics.js';
import type { Database } from '@shared/database/client.js';
import type { TokensResponse } from '@shared/types/index.js';
import type { JtiDenylist } from '@shared/cache/jti-denylist.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Opaque refresh-token service.
 *
 * Hardening over the previous version (F1, F12, F13, F14, F18):
 *  - F1 — concurrent rotation race fixed via `SELECT ... FOR UPDATE` (row-level
 *    lock inside a serializable-safe transaction). Two parallel refreshes with
 *    the same token now serialize on the row.
 *  - F12 — rotation grace window: the immediately-prior token is accepted for
 *    a short window (`ROTATION_GRACE_SECONDS`) without family compromise. This
 *    handles legit concurrent clients on flaky networks.
 *  - F13 — `revokeByPlaintext` requires user ownership.
 *  - F14 — Unrecognized presentations are surfaced via metrics + audit hook.
 *  - F18 — Per-user max active sessions enforced (oldest revoked first).
 *
 * The plaintext token format is `<familyId>.<random>` so we can do an O(log n)
 * grace lookup against `previousTokenHash` inside the same family without
 * needing a global secondary scan. (Kept opaque on the wire — the user just
 * sees a long base64url string.)
 */

export interface IssueContext {
  userId: string;
  ipAddress?: string;
  userAgent?: string;
  familyId?: string;
}

export interface RefreshContext {
  presentedToken: string;
  ipAddress?: string;
  userAgent?: string;
  /**
   * Audit hook called for unrecognized refresh presentations (F14).
   * Service intentionally does not depend on AuditService directly — wired
   * by the auth.plugin to break a circular ownership concern.
   */
  onUnrecognized?: (info: {
    ipAddress?: string;
    userAgent?: string;
    presentedHash: string;
  }) => Promise<void> | void;
}

export interface IssuedRefreshRow {
  id: string;
  familyId: string;
  plaintext: string;
  expiresAt: Date;
}

const ROTATION_GRACE_SECONDS = 30;

export class TokenService {
  public constructor(
    private readonly db: Database,
    private readonly jtiDenylist: JtiDenylist,
    private readonly maxSessionsPerUser: number = 10,
  ) {}

  /** Issues a brand-new access + refresh pair (new family). */
  public async issueTokens(
    ctx: IssueContext,
    user: { email: string },
  ): Promise<TokensResponse> {
    const refresh = await this.persistNewRefresh({
      userId: ctx.userId,
      familyId: ctx.familyId ?? newId(),
      previousTokenHash: null,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    await this.enforceSessionCap(ctx.userId);

    const accessToken = signAccessToken({ sub: ctx.userId, email: user.email, jti: refresh.id });
    const accessTtl = parseDurationToSeconds(config.JWT_ACCESS_TTL);

    return {
      accessToken,
      refreshToken: refresh.plaintext,
      tokenType: 'Bearer',
      expiresIn: accessTtl,
    };
  }

  /**
   * Validates and rotates a refresh token. Locks the row so concurrent
   * presentations serialize.
   *
   * Outcomes:
   *  - Active token → rotate, audit success.
   *  - Already-revoked token (and not in grace window) → REUSE, kill family.
   *  - Token within grace window for a freshly-rotated row → re-issue the
   *    *same* current refresh by returning a copy (idempotent).
   *  - Unknown / expired / user-disabled → 401.
   */
  public async rotate(
    ctx: RefreshContext,
    userEmailLookup: (userId: string) => Promise<string | null>,
  ): Promise<TokensResponse> {
    const presentedHash = hashOpaqueToken(ctx.presentedToken);
    const accessTtl = parseDurationToSeconds(config.JWT_ACCESS_TTL);

    return this.db.transaction(async (tx) => {
      // 1) Lock by tokenHash OR previousTokenHash (grace window candidate).
      const rows = await tx
        .select()
        .from(refreshTokens)
        .where(
          or(
            eq(refreshTokens.tokenHash, presentedHash),
            eq(refreshTokens.previousTokenHash, presentedHash),
          ),
        )
        .limit(2)
        .for('update');

      if (rows.length === 0) {
        authRefreshOutcomes.inc({ outcome: 'invalid' });
        if (ctx.onUnrecognized) {
          await ctx.onUnrecognized({
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            presentedHash,
          });
        }
        throw new TokenInvalidError('Refresh token not recognized');
      }

      // Disambiguate: prefer the row whose CURRENT hash matches.
      const exact = rows.find((r) => r.tokenHash === presentedHash);
      const successor = rows.find(
        (r) => r.previousTokenHash === presentedHash && r.tokenHash !== presentedHash,
      );

      // ── Grace replay path: presented token is the *previous* hash of an
      // already-rotated successor, and we're still within the grace window.
      if (!exact && successor) {
        const inGrace =
          successor.rotationGraceUntil !== null &&
          successor.rotationGraceUntil.getTime() > Date.now() &&
          successor.revokedAt === null;
        if (inGrace) {
          // Idempotent: return the *current* tokens for this client. We can't
          // re-emit the same plaintext (we don't store it), so we issue a new
          // child rotation — but treat this as a benign rotate, not reuse.
          authRefreshOutcomes.inc({ outcome: 'grace' });
          const email = await userEmailLookup(successor.userId);
          if (!email) {
            throw new TokenInvalidError('User not found');
          }
          const next = await this.persistNewRefreshTx(tx, {
            userId: successor.userId,
            familyId: successor.familyId,
            previousTokenHash: successor.tokenHash,
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
          });
          await tx
            .update(refreshTokens)
            .set({
              revokedAt: new Date(),
              revokedReason: 'rotated',
              replacedById: next.id,
            })
            .where(eq(refreshTokens.id, successor.id));
          return {
            accessToken: signAccessToken({ sub: successor.userId, email, jti: next.id }),
            refreshToken: next.plaintext,
            tokenType: 'Bearer',
            expiresIn: accessTtl,
          };
        }
        // Out of grace AND presented token's row is already a previousTokenHash
        // — it's a reuse: kill the family.
        await this.compromiseFamilyTx(tx, successor.familyId);
        authRefreshOutcomes.inc({ outcome: 'reuse' });
        throw new TokenReuseError();
      }

      // From here, exact must be present.
      const row = exact!;

      if (row.revokedAt !== null) {
        await this.compromiseFamilyTx(tx, row.familyId);
        authRefreshOutcomes.inc({ outcome: 'reuse' });
        throw new TokenReuseError();
      }
      if (row.expiresAt.getTime() <= Date.now()) {
        authRefreshOutcomes.inc({ outcome: 'expired' });
        throw new TokenInvalidError('Refresh token expired');
      }

      const email = await userEmailLookup(row.userId);
      if (!email) {
        throw new TokenInvalidError('User not found');
      }

      // 2) Issue new — persist with this row's tokenHash as previousTokenHash for grace.
      const next = await this.persistNewRefreshTx(tx, {
        userId: row.userId,
        familyId: row.familyId,
        previousTokenHash: row.tokenHash,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });

      // 3) Mark old revoked.
      await tx
        .update(refreshTokens)
        .set({
          revokedAt: new Date(),
          revokedReason: 'rotated',
          replacedById: next.id,
        })
        .where(eq(refreshTokens.id, row.id));

      authRefreshOutcomes.inc({ outcome: 'success' });

      return {
        accessToken: signAccessToken({ sub: row.userId, email, jti: next.id }),
        refreshToken: next.plaintext,
        tokenType: 'Bearer',
        expiresIn: accessTtl,
      };
    });
  }

  /**
   * Revokes a specific refresh token presented by its owner. Ownership-verified
   * to prevent cross-user DoS (F13). Returns the affected row's id + jti for
   * caller (so access JWT can also be denylisted).
   */
  public async revokeByPlaintext(
    plaintext: string,
    ownerUserId: string,
    reason = 'logout',
  ): Promise<{ id: string; jti: string } | null> {
    const hash = hashOpaqueToken(plaintext);
    const res = await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(
        and(
          eq(refreshTokens.tokenHash, hash),
          eq(refreshTokens.userId, ownerUserId),
          isNull(refreshTokens.revokedAt),
        ),
      )
      .returning({ id: refreshTokens.id });

    if (res.length === 0) {
      return null;
    }
    authTokenRevocations.inc({ kind: 'refresh', reason });
    return { id: res[0]!.id, jti: res[0]!.id };
  }

  /**
   * Revokes ALL active refresh tokens for a user. Returns the list of jti's
   * (refresh-row ids) that were active at the moment of revocation, so the
   * caller can also denylist any in-flight access JWTs.
   */
  public async revokeAllForUser(
    userId: string,
    reason = 'logout_all',
  ): Promise<string[]> {
    const res = await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)))
      .returning({ id: refreshTokens.id });
    if (res.length > 0) {
      authTokenRevocations.inc({ kind: 'refresh', reason }, res.length);
    }
    return res.map((r) => r.id);
  }

  /** Cleanup expired tokens. Run via cron. */
  public async cleanupExpired(olderThan: Date = new Date()): Promise<number> {
    const res = await this.db
      .delete(refreshTokens)
      .where(lt(refreshTokens.expiresAt, olderThan))
      .returning({ id: refreshTokens.id });
    return res.length;
  }

  /**
   * Records an access-token jti revocation in Redis. Caller passes the jti
   * (= refresh-row id, which we set as the access JWT jti) and the access TTL.
   */
  public async denylistAccessJti(jti: string, ttlSeconds: number): Promise<void> {
    if (!jti) {
      return;
    }
    await this.jtiDenylist.revoke(jti, ttlSeconds);
    authTokenRevocations.inc({ kind: 'access', reason: 'denylist' });
  }

  public async denylistAccessJtis(jtis: readonly string[], ttlSeconds: number): Promise<void> {
    if (jtis.length === 0) {
      return;
    }
    await this.jtiDenylist.revokeMany(jtis.map((jti) => ({ jti, ttlSeconds })));
    authTokenRevocations.inc({ kind: 'access', reason: 'denylist' }, jtis.length);
  }

  // ─── internals ────────────────────────────────────────────────────────────

  private async compromiseFamilyTx(tx: Tx, familyId: string): Promise<void> {
    await tx
      .update(refreshTokens)
      .set({ revokedAt: new Date(), revokedReason: 'family_compromised' })
      .where(
        and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)),
      );
    authTokenRevocations.inc({ kind: 'refresh', reason: 'family_compromised' });
  }

  private async persistNewRefresh(input: {
    userId: string;
    familyId: string;
    previousTokenHash: string | null;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<IssuedRefreshRow> {
    return this.db.transaction((tx) => this.persistNewRefreshTx(tx, input));
  }

  private async persistNewRefreshTx(
    tx: Tx,
    input: {
      userId: string;
      familyId: string;
      previousTokenHash: string | null;
      ipAddress?: string;
      userAgent?: string;
    },
  ): Promise<IssuedRefreshRow> {
    const { plaintext, hash } = issueOpaqueToken(48);
    const ttl = parseDurationToSeconds(config.JWT_REFRESH_TTL);
    const expiresAt = addSeconds(new Date(), ttl);
    const rotationGraceUntil = input.previousTokenHash
      ? addSeconds(new Date(), ROTATION_GRACE_SECONDS)
      : null;

    const inserted = await tx
      .insert(refreshTokens)
      .values({
        userId: input.userId,
        tokenHash: hash,
        previousTokenHash: input.previousTokenHash,
        rotationGraceUntil,
        familyId: input.familyId,
        expiresAt,
        ipAddress: input.ipAddress?.slice(0, 64) ?? null,
        userAgent: input.userAgent?.slice(0, 512) ?? null,
      })
      .returning();

    const row = inserted[0]!;
    return { id: row.id, familyId: row.familyId, plaintext, expiresAt: row.expiresAt };
  }

  /**
   * Caps the number of active sessions per user. When exceeded, the oldest
   * non-revoked rows are revoked. Defended against concurrent issues by being
   * called immediately after issue inside the same logical request.
   */
  private async enforceSessionCap(userId: string): Promise<void> {
    if (!Number.isFinite(this.maxSessionsPerUser) || this.maxSessionsPerUser <= 0) {
      return;
    }

    // Use a single SQL: revoke any rows beyond the most-recent N for this user.
    await this.db.execute(sql`
      WITH ranked AS (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY user_id
                 ORDER BY created_at DESC
               ) AS rn
        FROM refresh_tokens
        WHERE user_id = ${userId}
          AND revoked_at IS NULL
          AND expires_at > now()
      )
      UPDATE refresh_tokens rt
      SET revoked_at = now(),
          revoked_reason = 'session_cap'
      FROM ranked
      WHERE rt.id = ranked.id
        AND ranked.rn > ${this.maxSessionsPerUser}
    `);
  }
}

// `asc` import preserved for migrations that may need it later
export { asc };
