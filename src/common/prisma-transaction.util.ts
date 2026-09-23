import { ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// Prisma's interactive transactions queue for a pooled connection before
// they can even begin (default maxWait 2s). Heavy concurrent contention on
// the same row can exhaust that wait and throw a raw
// PrismaClientKnownRequestError (P2028) that would otherwise surface as an
// unhandled 500 — not a correctness bug, just a capacity limit. Translate
// it into a clean, retryable error instead. Any module doing
// "$transaction + atomic conditional UPDATE" (inventory adjustments, order
// stock reservation) should route through this.
export async function runTransaction<T>(
  prisma: PrismaService,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: { maxWait?: number; timeout?: number },
): Promise<T> {
  try {
    return await prisma.$transaction(fn, options);
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2028'
    ) {
      throw new ServiceUnavailableException(
        'High contention on this resource right now — please retry',
      );
    }
    throw err;
  }
}
