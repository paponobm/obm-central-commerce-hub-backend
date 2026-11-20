import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EncryptionService } from '../common/crypto/encryption.service';

const SETTING_KEY = 'bdCourier';
const BASE_URL = 'https://api.bdcourier.com';
const REQUEST_TIMEOUT_MS = 10_000;
// BD Courier bills per lookup — a short cache means reopening the same
// order (or switching between New Order/Web Orders/Edit Order for the
// same customer) within this window doesn't re-charge the account.
const CACHE_TTL_MS = 10 * 60 * 1000;

// One row per courier BD Courier reports on, in the order their own API
// returns them (see their "Courier Check" docs) — present only when that
// courier has ever handled a parcel for this number.
export interface BdCourierCourierStat {
  key: string;
  name: string;
  logo: string | null;
  totalParcel: number;
  successParcel: number;
  cancelledParcel: number;
  successRatio: number;
}

export interface BdCourierFraudReport {
  id: string;
  name: string;
  details: string;
  createdAt: string;
  courierName: string | null;
  courierLogo: string | null;
}

export interface BdCourierCheckResult {
  phone: string;
  summary: BdCourierCourierStat;
  couriers: BdCourierCourierStat[];
  reports: BdCourierFraudReport[];
}

interface RawCourierStat {
  name?: string;
  logo?: string;
  total_parcel?: number;
  success_parcel?: number;
  cancelled_parcel?: number;
  success_ratio?: number;
}

interface RawCheckResponse {
  status?: string;
  message?: string;
  data?: Record<string, RawCourierStat> & { summary?: RawCourierStat };
  reports?: {
    id: string;
    name: string;
    details: string;
    created_at: string;
    courierName?: string;
    courierLogo?: string;
  }[];
}

@Injectable()
export class BdCourierService {
  private cache = new Map<
    string,
    { expiresAt: number; result: BdCourierCheckResult }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  async getSettings(): Promise<{ hasApiKey: boolean }> {
    const key = await this.getDecryptedKey();
    return { hasApiKey: !!key };
  }

  async updateApiKey(apiKey: string): Promise<{ hasApiKey: boolean }> {
    await this.prisma.setting.upsert({
      where: { key: SETTING_KEY },
      create: {
        key: SETTING_KEY,
        value: { apiKeyEncrypted: this.encryption.encrypt(apiKey) },
      },
      update: { value: { apiKeyEncrypted: this.encryption.encrypt(apiKey) } },
    });
    this.cache.clear();
    return { hasApiKey: true };
  }

  async disconnect(): Promise<{ hasApiKey: boolean }> {
    await this.prisma.setting.upsert({
      where: { key: SETTING_KEY },
      create: { key: SETTING_KEY, value: { apiKeyEncrypted: null } },
      update: { value: { apiKeyEncrypted: null } },
    });
    this.cache.clear();
    return { hasApiKey: false };
  }

  // BD Courier's own quota is small (a few hundred calls total) — this is
  // the real entry point every page should use once an order/lead exists.
  // Persists the result on the order itself and never re-fetches for it
  // again unless the phone number actually changes, instead of the 10min
  // cache in checkPhone() below re-charging the account on every reload.
  async getOrderCheck(orderId: string): Promise<BdCourierCheckResult> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        shippingPhone: true,
        bdCourierCheckedPhone: true,
        bdCourierResult: true,
      },
    });
    if (!order) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }
    if (
      order.bdCourierResult &&
      order.bdCourierCheckedPhone === order.shippingPhone
    ) {
      return order.bdCourierResult as unknown as BdCourierCheckResult;
    }

    const result = await this.checkPhone(order.shippingPhone);
    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        bdCourierCheckedPhone: order.shippingPhone,
        bdCourierCheckedAt: new Date(),
        bdCourierResult: result as unknown as Prisma.InputJsonValue,
      },
    });
    return result;
  }

  // Same idea as getOrderCheck, for an Incomplete checkout that isn't a
  // real Order yet. Deliberately not carried over if the lead later
  // becomes an order — that order fetches (and persists) its own.
  async getLeadCheck(leadId: string): Promise<BdCourierCheckResult> {
    const lead = await this.prisma.checkoutLead.findUnique({
      where: { id: leadId },
      select: {
        phone: true,
        bdCourierCheckedPhone: true,
        bdCourierResult: true,
      },
    });
    if (!lead) {
      throw new NotFoundException(`Checkout lead ${leadId} not found`);
    }
    if (lead.bdCourierResult && lead.bdCourierCheckedPhone === lead.phone) {
      return lead.bdCourierResult as unknown as BdCourierCheckResult;
    }

    const result = await this.checkPhone(lead.phone);
    await this.prisma.checkoutLead.update({
      where: { id: leadId },
      data: {
        bdCourierCheckedPhone: lead.phone,
        bdCourierCheckedAt: new Date(),
        bdCourierResult: result as unknown as Prisma.InputJsonValue,
      },
    });
    return result;
  }

  // The underlying live-fetch, still used directly by New Order (no
  // order/lead row exists yet to persist onto) — its own short in-memory
  // cache just avoids re-billing for the exact same number within a few
  // minutes of typing it, not a substitute for the persistence above.
  async checkPhone(phoneRaw: string): Promise<BdCourierCheckResult> {
    const phone = phoneRaw.trim();
    if (!/^01\d{9}$/.test(phone)) {
      throw new BadRequestException(
        'Enter a valid 11-digit Bangladeshi mobile number',
      );
    }

    const cached = this.cache.get(phone);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.result;
    }

    const apiKey = await this.getDecryptedKey();
    if (!apiKey) {
      throw new BadRequestException(
        'BD Courier is not connected — add an API key in Integrations first',
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let raw: RawCheckResponse;
    try {
      const res = await fetch(`${BASE_URL}/courier-check`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ phone }),
        signal: controller.signal,
      });
      const text = await res.text();
      let parsed: unknown;
      try {
        parsed = text ? JSON.parse(text) : undefined;
      } catch {
        parsed = undefined;
      }
      if (!res.ok) {
        const message =
          (parsed as { message?: string } | undefined)?.message ??
          `BD Courier returned ${res.status}`;
        throw new BadGatewayException(message);
      }
      raw = (parsed as RawCheckResponse) ?? {};
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      const timedOut = (err as Error)?.name === 'AbortError';
      throw new BadGatewayException(
        timedOut
          ? `BD Courier did not respond within ${REQUEST_TIMEOUT_MS / 1000}s`
          : 'Could not reach BD Courier',
      );
    } finally {
      clearTimeout(timeout);
    }

    const result = this.toCheckResult(phone, raw);
    this.cache.set(phone, { expiresAt: Date.now() + CACHE_TTL_MS, result });
    return result;
  }

  private async getDecryptedKey(): Promise<string | null> {
    const row = await this.prisma.setting.findUnique({
      where: { key: SETTING_KEY },
    });
    const encrypted = (row?.value as { apiKeyEncrypted?: string | null })
      ?.apiKeyEncrypted;
    return encrypted ? this.encryption.decrypt(encrypted) : null;
  }

  private toCheckResult(
    phone: string,
    raw: RawCheckResponse,
  ): BdCourierCheckResult {
    const toStat = (key: string, s: RawCourierStat | undefined) => ({
      key,
      name: s?.name ?? key,
      logo: s?.logo ?? null,
      totalParcel: s?.total_parcel ?? 0,
      successParcel: s?.success_parcel ?? 0,
      cancelledParcel: s?.cancelled_parcel ?? 0,
      successRatio: s?.success_ratio ?? 0,
    });

    const data = raw.data ?? {};
    const { summary, ...perCourier } = data;
    const couriers = Object.entries(perCourier)
      .map(([key, s]) => toStat(key, s))
      // Only couriers that have actually handled a parcel for this
      // number — an all-zero card for every courier BD Courier merely
      // *supports* would just be noise.
      .filter((c) => c.totalParcel > 0)
      .sort((a, b) => b.totalParcel - a.totalParcel);

    return {
      phone,
      summary: toStat('summary', summary),
      couriers,
      reports: (raw.reports ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        details: r.details,
        createdAt: r.created_at,
        courierName: r.courierName ?? null,
        courierLogo: r.courierLogo ?? null,
      })),
    };
  }
}
