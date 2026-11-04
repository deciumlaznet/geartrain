// Sign-in for the web app. Invite-only: accounts come from configuration (the
// GEARTRAIN_USERS secret), never from a public sign-up form. Passwords are
// stored as scrypt hashes; sessions are HMAC-signed, HttpOnly cookies that
// expire after eight hours.
//
// Two roles:
//   staff  - Geartrain's own team: every client, the expert queue, the audit trail.
//   client - a client's people: only the clients listed against them.

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export interface User {
  email: string;
  name: string;
  role: "staff" | "client";
  /** Client keys this user may see. Staff see every client whatever this says. */
  clients: string[];
  /** From `pnpm --filter @geartrain/web hash-password`. */
  passwordHash: string;
}

export const SESSION_COOKIE = "gt_session";
export const SESSION_HOURS = 8;

const N = 16384;
const KEYLEN = 64;

export function hashPassword(password: string): string {
  if (password.length < 12) throw new Error("Passwords must be at least 12 characters");
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN, { N });
  return `scrypt$${N}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, n, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !n || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = scryptSync(password, Buffer.from(salt, "base64url"), expected.length, { N: Number(n) });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** A hash to compare against when the email is unknown, so timing does not reveal which emails exist. */
const DUMMY_HASH = `scrypt$${N}$${Buffer.alloc(16).toString("base64url")}$${Buffer.alloc(KEYLEN).toString("base64url")}`;

export class UserDirectory {
  private readonly byEmail = new Map<string, User>();

  constructor(users: User[]) {
    for (const u of users) {
      const email = u.email.trim().toLowerCase();
      if (!email.includes("@")) throw new Error(`Invalid email for user ${u.name}`);
      if (u.role !== "staff" && u.role !== "client") throw new Error(`Invalid role for ${email}`);
      if (!u.passwordHash.startsWith("scrypt$")) throw new Error(`Password for ${email} must be a scrypt hash, not plain text`);
      if (u.role === "client" && u.clients.length === 0) throw new Error(`Client user ${email} has no clients`);
      this.byEmail.set(email, { ...u, email });
    }
  }

  get size() {
    return this.byEmail.size;
  }

  get(email: string): User | undefined {
    return this.byEmail.get(email.trim().toLowerCase());
  }

  authenticate(email: string, password: string): User | undefined {
    const user = this.get(email);
    const ok = verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
    return ok && user ? user : undefined;
  }

  /** Reads GEARTRAIN_USERS: a JSON array of users. */
  static fromEnv(json: string | undefined): UserDirectory {
    if (!json) throw new Error("GEARTRAIN_USERS is not set");
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) throw new Error("GEARTRAIN_USERS must be a JSON array");
    return new UserDirectory(parsed as User[]);
  }
}

export function canSeeClient(user: User, clientKey: string): boolean {
  return user.role === "staff" || user.clients.includes(clientKey);
}

/** Five failed attempts for an email locks it for fifteen minutes. */
export class LoginThrottle {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly limit = 5,
    private readonly windowMs = 15 * 60_000,
    private readonly clock: () => number = Date.now,
  ) {}

  private recent(key: string): number[] {
    const now = this.clock();
    const list = (this.failures.get(key) ?? []).filter((t) => now - t < this.windowMs);
    this.failures.set(key, list);
    return list;
  }

  locked(key: string): boolean {
    return this.recent(key).length >= this.limit;
  }

  fail(key: string) {
    this.recent(key).push(this.clock());
  }

  clear(key: string) {
    this.failures.delete(key);
  }
}
