import "server-only";
import { PrismaClient, Prisma } from "@prisma/client";
interface Entry<T> {
  value: T;
  updatedAt: number;
  expiresAt: number;
}
const globalCache = globalThis as unknown as {
  mpCache?: Map<string, Entry<unknown>>;
  mpPending?: Map<string, Promise<unknown>>;
  mpPrisma?: PrismaClient;
};
const memory = (globalCache.mpCache ??= new Map());
const pending = (globalCache.mpPending ??= new Map());
export const prisma = process.env.DATABASE_URL
  ? (globalCache.mpPrisma ??= new PrismaClient())
  : null;
export async function cached<T>(
  key: string,
  ttl: number,
  load: () => Promise<T>,
): Promise<{ value: T; updatedAt: number; stale: boolean; warning?: string }> {
  let entry = memory.get(key) as Entry<T> | undefined;
  if (!entry && prisma) {
    try {
      const row = await prisma.cacheEntry.findUnique({ where: { key } });
      if (row)
        entry = {
          value: row.payload as T,
          updatedAt: row.updatedAt.getTime(),
          expiresAt: row.expiresAt.getTime(),
        };
    } catch {
      /* Database availability must not fabricate data. */
    }
  }
  if (entry && entry.expiresAt > Date.now()) return { ...entry, stale: false };
  let task = pending.get(key) as Promise<Entry<T>> | undefined;
  if (!task) {
    task = (async () => {
      const value = await load();
      const updatedAt = Date.now(),
        expiresAt = updatedAt + ttl;
      const next = { value, updatedAt, expiresAt };
      memory.set(key, next);
      if (prisma)
        await prisma.cacheEntry
          .upsert({
            where: { key },
            create: {
              key,
              payload: value as Prisma.InputJsonValue,
              updatedAt: new Date(updatedAt),
              expiresAt: new Date(expiresAt),
            },
            update: {
              payload: value as Prisma.InputJsonValue,
              updatedAt: new Date(updatedAt),
              expiresAt: new Date(expiresAt),
            },
          })
          .catch(() => undefined);
      return next;
    })();
    pending.set(key, task);
  }
  try {
    return { ...(await task), stale: false };
  } catch (error) {
    if (entry)
      return {
        ...entry,
        stale: true,
        warning: error instanceof Error ? error.message : "Refresh failed",
      };
    throw error;
  } finally {
    pending.delete(key);
  }
}
export function ttl(name: string, defaultSeconds: number) {
  const n = Number(process.env[`${name}_TTL_SECONDS`] ?? defaultSeconds);
  return Math.max(30, Number.isFinite(n) ? n : defaultSeconds) * 1000;
}
