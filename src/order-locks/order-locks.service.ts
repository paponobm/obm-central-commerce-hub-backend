import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from '../auth/types/jwt-payload.type';

// A lock with no heartbeat in this long is treated as abandoned (closed
// tab, crashed browser, lost network) and swept on the next read, so a
// dead session never blocks an order forever. The frontend heartbeats
// well inside this window (see HEARTBEAT_INTERVAL_MS in web-orders) —
// three missed beats before expiry, to absorb a slow request or two.
const LOCK_TTL_MS = 30_000;

export interface Holder {
  id: string;
  name: string;
}

@Injectable()
export class OrderLocksService {
  constructor(private readonly prisma: PrismaService) {}

  private staleCutoff(): Date {
    return new Date(Date.now() - LOCK_TTL_MS);
  }

  private async sweepExpired(): Promise<void> {
    await this.prisma.orderLock.deleteMany({
      where: { updatedAt: { lt: this.staleCutoff() } },
    });
  }

  // Everyone currently holding a live lock — the Web Orders list merges
  // this into its rows to show who has each order open.
  async list(): Promise<{ orderId: string; holder: Holder }[]> {
    await this.sweepExpired();
    const locks = await this.prisma.orderLock.findMany({
      include: { user: { select: { id: true, name: true } } },
    });
    return locks.map((lock) => ({
      orderId: lock.orderId,
      holder: { id: lock.user.id, name: lock.user.name },
    }));
  }

  // Opening the order detail page calls this. Succeeds immediately if the
  // order is unlocked, already locked by this same user (e.g. a refresh,
  // or re-opened in another tab), or the lock has gone stale. Otherwise
  // throws 409 with who holds it, unless force is set (Take Over).
  async acquire(
    orderId: string,
    user: JwtPayload,
    force: boolean,
  ): Promise<{ holder: Holder }> {
    await this.sweepExpired();
    // Two requests for the same still-unlocked order (e.g. a double-click,
    // or React re-invoking an effect) can both see no existing row and race
    // into create — the loser's insert then hits the unique constraint on
    // orderId. One retry re-reads the now-committed row and updates it
    // instead, same as if it had lost the race to a genuinely different
    // request.
    for (let attempt = 0; attempt < 2; attempt++) {
      const existing = await this.prisma.orderLock.findUnique({
        where: { orderId },
        include: { user: { select: { id: true, name: true } } },
      });
      if (existing && existing.userId !== user.sub && !force) {
        throw new ConflictException({
          message: `This order is currently being viewed by ${existing.user.name}.`,
          holder: { id: existing.user.id, name: existing.user.name },
        });
      }
      try {
        const lock = await this.prisma.orderLock.upsert({
          where: { orderId },
          create: { orderId, userId: user.sub },
          update: { userId: user.sub, updatedAt: new Date() },
          include: { user: { select: { id: true, name: true } } },
        });
        return { holder: { id: lock.user.id, name: lock.user.name } };
      } catch (err) {
        const isUniqueRace =
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002';
        if (!isUniqueRace || attempt === 1) throw err;
      }
    }
    // Unreachable — the loop above always returns or throws.
    throw new ConflictException('Could not acquire the order lock');
  }

  // Polled while the detail page stays open. ok:false means this user is
  // no longer the holder — someone took over, or the lock expired and
  // someone else grabbed it — so the frontend sends them back to the list.
  async heartbeat(
    orderId: string,
    user: JwtPayload,
  ): Promise<{ ok: boolean; holder: Holder | null }> {
    const existing = await this.prisma.orderLock.findUnique({
      where: { orderId },
      include: { user: { select: { id: true, name: true } } },
    });
    if (!existing || existing.userId !== user.sub) {
      return {
        ok: false,
        holder: existing
          ? { id: existing.user.id, name: existing.user.name }
          : null,
      };
    }
    await this.prisma.orderLock.update({
      where: { orderId },
      data: { updatedAt: new Date() },
    });
    return { ok: true, holder: null };
  }

  // Navigating away releases the lock. Only deletes it if still held by
  // the caller, so it's a safe no-op after a takeover already moved it on.
  async release(orderId: string, user: JwtPayload): Promise<void> {
    await this.prisma.orderLock.deleteMany({
      where: { orderId, userId: user.sub },
    });
  }
}
