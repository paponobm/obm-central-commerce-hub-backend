import { BadRequestException, Injectable } from '@nestjs/common';
import { OrderStatus, Prisma, ShipmentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationsService } from '../integrations.service';

// Steadfast's `delivery_status` event sends one of these — mapped onto our
// own ShipmentStatus enum, which doesn't have a 1:1 match for every value.
// Anything not listed here (e.g. "unknown") deliberately maps to `null`,
// meaning "log the event, but don't force a status change we're not
// confident about" — safer than guessing.
function mapSteadfastStatus(status: unknown): ShipmentStatus | null {
  switch (status) {
    case 'delivered':
    case 'partial_delivered':
      return ShipmentStatus.DELIVERED;
    case 'cancelled':
      return ShipmentStatus.FAILED;
    case 'pending':
      // Steadfast's "pending" here means "out, not yet delivered" (this
      // event only fires after a parcel already exists) — our closest
      // equivalent is IN_TRANSIT, not NOT_SHIPPED/PROCESSING.
      return ShipmentStatus.IN_TRANSIT;
    default:
      return null;
  }
}

// Which Order.status this same event should try to advance the order to —
// confirmed directly with the merchant: delivered -> Delivered,
// partial_delivered -> Partial, cancelled -> Pending Return (a cancelled-
// after-dispatch parcel means it's physically on its way back; marking it
// Returned and restocking inventory stays a separate, manual step done
// once the parcel is actually back in hand — not automated here).
// "pending"/unknown never move Order.status, only the Shipment record.
function mapSteadfastOrderStatus(status: unknown): OrderStatus | null {
  switch (status) {
    case 'delivered':
      return OrderStatus.DELIVERED;
    case 'partial_delivered':
      return OrderStatus.PARTIAL;
    case 'cancelled':
      return OrderStatus.PENDING_RETURN;
    default:
      return null;
  }
}

// Mirrors the subset of OrdersService's TRANSITIONS state machine relevant
// to the three statuses a webhook can ever target above — duplicated
// rather than imported to avoid a circular module dependency between
// IntegrationsModule and OrdersModule. If OrdersService's TRANSITIONS
// table ever changes which statuses can reach these, update this too.
const ORDER_STATUS_ALLOWED_FROM: Partial<Record<OrderStatus, OrderStatus[]>> = {
  DELIVERED: [OrderStatus.SHIPPED, OrderStatus.PARTIAL],
  PARTIAL: [OrderStatus.SHIPPED],
  PENDING_RETURN: [
    OrderStatus.SHIPPED,
    OrderStatus.PARTIAL,
    OrderStatus.DELIVERED,
  ],
};

@Injectable()
export class WebhooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrationsService: IntegrationsService,
  ) {}

  // Always updates Shipment/ShipmentEvent. Also tries to advance
  // Order.status to match (delivered/partial_delivered/cancelled only) —
  // but only when the order's current status is a valid predecessor, e.g.
  // it will never jump an order straight from Ready to Ship to Delivered;
  // the admin still has to mark it Shipped by hand first. If the current
  // status doesn't allow it, this silently skips the Order update (still
  // records the Shipment/ShipmentEvent) rather than erroring.
  async handleSteadfastWebhook(
    integrationId: string,
    rawBody: Buffer,
    signature: string | undefined,
  ): Promise<{ received: boolean }> {
    // Throws (ForbiddenException/NotFoundException) on a bad signature or
    // unknown integration — let that propagate to the controller as-is,
    // never swallow it into a 200.
    await this.integrationsService.verifyWebhookRequest(
      integrationId,
      rawBody,
      signature,
    );

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
    } catch {
      throw new BadRequestException('Invalid JSON body');
    }

    const consignmentId =
      payload.consignment_id !== undefined && payload.consignment_id !== null
        ? String(payload.consignment_id)
        : undefined;
    // Acknowledge (200) even when there's nothing to act on — an
    // unrecognized or already-removed consignment isn't an error on
    // Steadfast's side, and a non-2xx just makes them retry pointlessly.
    if (!consignmentId) return { received: true };

    const shipment = await this.prisma.shipment.findFirst({
      where: { integrationId, externalConsignmentId: consignmentId },
    });
    if (!shipment) return { received: true };

    const mappedShipmentStatus = mapSteadfastStatus(payload.status);
    const mappedOrderStatus = mapSteadfastOrderStatus(payload.status);
    const note =
      (typeof payload.tracking_message === 'string'
        ? payload.tracking_message
        : undefined) ??
      (typeof payload.notification_type === 'string'
        ? payload.notification_type
        : undefined) ??
      null;
    const rawResponse = payload as Prisma.InputJsonValue;

    const order = await this.prisma.order.findUnique({
      where: { id: shipment.orderId },
      select: { status: true },
    });
    const canAdvanceOrder =
      mappedOrderStatus !== null &&
      order !== null &&
      (ORDER_STATUS_ALLOWED_FROM[mappedOrderStatus] ?? []).includes(
        order.status,
      );

    await this.prisma.$transaction(async (tx) => {
      await tx.shipment.update({
        where: { id: shipment.id },
        data: {
          ...(mappedShipmentStatus ? { status: mappedShipmentStatus } : {}),
          ...(mappedShipmentStatus === ShipmentStatus.DELIVERED
            ? { deliveredAt: new Date() }
            : {}),
          lastSyncedAt: new Date(),
          rawResponse,
        },
      });
      await tx.shipmentEvent.create({
        data: {
          shipmentId: shipment.id,
          status: mappedShipmentStatus ?? shipment.status,
          note,
          rawResponse,
        },
      });

      if (canAdvanceOrder && mappedOrderStatus && order) {
        await tx.order.update({
          where: { id: shipment.orderId },
          data: {
            status: mappedOrderStatus,
            ...(mappedOrderStatus === OrderStatus.DELIVERED
              ? { shipmentStatus: ShipmentStatus.DELIVERED }
              : {}),
          },
        });
        await tx.orderStatusHistory.create({
          data: {
            orderId: shipment.orderId,
            fromStatus: order.status,
            toStatus: mappedOrderStatus,
            note: note
              ? `Auto-synced from Steadfast: ${note}`
              : 'Auto-synced from Steadfast webhook',
            changedById: null,
          },
        });
      }
    });

    return { received: true };
  }
}
