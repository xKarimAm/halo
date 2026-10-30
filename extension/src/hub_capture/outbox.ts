// Envelope outbox: no ACK in 2 s (or on reconnect) resends the same id,
// 3 tries then status degraded. Inbound dedupe by envelope id.
import type { Envelope } from "../../../contracts/ext/gen/types";

export const RESEND_AFTER_MS = 2000;
export const MAX_TRIES = 3;

interface Pending {
  env: Envelope;
  tries: number;
  lastSentMs: number;
}

export class Outbox {
  private pending = new Map<string, Pending>();
  private seen = new Set<string>();
  degraded = false;

  constructor(private send: (text: string) => void) {}

  get backlog(): number {
    return this.pending.size;
  }

  enqueue(env: Envelope, nowMs: number): void {
    this.pending.set(env.id, { env, tries: 1, lastSentMs: nowMs });
    this.send(JSON.stringify(env));
  }

  ack(ackOf: string): void {
    this.pending.delete(ackOf);
  }

  /** Resend everything due; returns how many envelopes were resent. */
  pump(nowMs: number): number {
    let resent = 0;
    for (const p of this.pending.values()) {
      if (nowMs - p.lastSentMs < RESEND_AFTER_MS) continue;
      if (p.tries >= MAX_TRIES) {
        this.degraded = true;
        continue;
      }
      p.tries += 1;
      p.lastSentMs = nowMs;
      this.send(JSON.stringify(p.env));
      resent += 1;
    }
    return resent;
  }

  resendAll(nowMs: number): void {
    for (const p of this.pending.values()) {
      p.lastSentMs = nowMs;
      this.send(JSON.stringify(p.env));
    }
  }

  /** True the first time an inbound envelope id is seen. */
  firstSeen(id: string): boolean {
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    return true;
  }
}
