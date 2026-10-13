import { Injectable, NotFoundException } from '@nestjs/common';
import { Integration, IntegrationProvider, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EncryptionService } from '../common/crypto/encryption.service';
import { ProviderRegistry } from './providers/provider-registry';
import { CreateIntegrationDto } from './dto/create-integration.dto';
import { UpdateIntegrationDto } from './dto/update-integration.dto';

export type IntegrationStatus =
  'CONNECTED' | 'DISCONNECTED' | 'ERROR' | 'DISABLED';

@Injectable()
export class IntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly registry: ProviderRegistry,
  ) {}

  providersMeta() {
    return this.registry.list();
  }

  async findAll() {
    const rows = await this.prisma.integration.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => this.toListItem(r));
  }

  async findOne(id: string) {
    const row = await this.findRowOrThrow(id);
    return this.toListItem(row);
  }

  async create(dto: CreateIntegrationDto, actorUserId: string) {
    const credentials = this.encryption.encrypt(
      JSON.stringify(dto.credentials ?? {}),
    );
    const created = await this.prisma.integration.create({
      data: {
        provider: dto.provider,
        label: dto.label,
        credentials,
        isEnabled: dto.isEnabled ?? true,
        createdById: actorUserId,
        updatedById: actorUserId,
      },
    });
    await this.audit(actorUserId, 'integration.created', created.id, {
      provider: created.provider,
      label: created.label,
    });
    return this.toListItem(created);
  }

  async update(id: string, dto: UpdateIntegrationDto, actorUserId: string) {
    const existing = await this.findRowOrThrow(id);

    let credentials = existing.credentials as string;
    if (dto.credentials) {
      const current = JSON.parse(
        this.encryption.decrypt(credentials),
      ) as Record<string, string>;
      const merged = { ...current };
      // Only a non-empty value overwrites — an omitted or blank secret
      // field means "leave this credential as it is".
      for (const [key, value] of Object.entries(dto.credentials)) {
        if (value) merged[key] = value;
      }
      credentials = this.encryption.encrypt(JSON.stringify(merged));
    }

    const updated = await this.prisma.integration.update({
      where: { id },
      data: {
        label: dto.label,
        isEnabled: dto.isEnabled,
        credentials,
        updatedById: actorUserId,
      },
    });
    const action = dto.credentials
      ? 'integration.credentials_updated'
      : dto.isEnabled !== undefined
        ? dto.isEnabled
          ? 'integration.enabled'
          : 'integration.disabled'
        : 'integration.updated';
    await this.audit(actorUserId, action, id, {
      provider: updated.provider,
      label: updated.label,
    });
    return this.toListItem(updated);
  }

  async remove(id: string, actorUserId: string) {
    const existing = await this.findRowOrThrow(id);
    await this.prisma.integration.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.audit(actorUserId, 'integration.deleted', id, {
      provider: existing.provider,
      label: existing.label,
    });
    return { id };
  }

  async setDefault(id: string, actorUserId: string) {
    const existing = await this.findRowOrThrow(id);
    await this.prisma.$transaction([
      this.prisma.integration.updateMany({
        where: {
          provider: existing.provider,
          deletedAt: null,
          NOT: { id },
        },
        data: { isDefault: false },
      }),
      this.prisma.integration.update({
        where: { id },
        data: { isDefault: true, updatedById: actorUserId },
      }),
    ]);
    await this.audit(actorUserId, 'integration.set_default', id, {
      provider: existing.provider,
      label: existing.label,
    });
    return this.findOne(id);
  }

  // Always a real network call — never short-circuits to a stored
  // "it worked last time" result. This is the only place lastTestSuccess
  // is ever written.
  async testConnection(id: string, actorUserId: string) {
    const existing = await this.findRowOrThrow(id);
    const adapter = this.registry.get(existing.provider);
    const credentials = JSON.parse(
      this.encryption.decrypt(existing.credentials as string),
    ) as Record<string, string>;

    const result = await adapter.testConnection(credentials);

    const updated = await this.prisma.integration.update({
      where: { id },
      data: {
        lastTestedAt: new Date(),
        lastTestSuccess: result.success,
        lastTestMessage: result.message,
      },
    });
    await this.audit(actorUserId, 'integration.tested', id, {
      provider: updated.provider,
      success: result.success,
    });
    return this.toListItem(updated);
  }

  // Decrypts credentials for internal callers (e.g. the order→shipment
  // hook) — never exposed through a controller route.
  async getDecryptedCredentials(id: string): Promise<{
    provider: IntegrationProvider;
    credentials: Record<string, string>;
  }> {
    const existing = await this.findRowOrThrow(id);
    return {
      provider: existing.provider,
      credentials: JSON.parse(
        this.encryption.decrypt(existing.credentials as string),
      ) as Record<string, string>,
    };
  }

  private async findRowOrThrow(id: string): Promise<Integration> {
    const row = await this.prisma.integration.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) {
      throw new NotFoundException(`Integration ${id} not found`);
    }
    return row;
  }

  private async audit(
    userId: string,
    action: string,
    entityId: string,
    after: Record<string, unknown>,
  ) {
    await this.prisma.auditLog.create({
      data: {
        userId,
        action,
        entityType: 'Integration',
        entityId,
        after: after as Prisma.InputJsonValue,
      },
    });
  }

  private toListItem(row: Integration) {
    const status: IntegrationStatus = !row.isEnabled
      ? 'DISABLED'
      : row.lastTestSuccess === true
        ? 'CONNECTED'
        : row.lastTestSuccess === false
          ? 'ERROR'
          : 'DISCONNECTED';

    const adapter = this.registry.get(row.provider);
    const credentials = JSON.parse(
      this.encryption.decrypt(row.credentials as string),
    ) as Record<string, string>;
    const maskedCredentials: Record<string, string> = {};
    for (const field of adapter.credentialFields) {
      const value = credentials[field.key] ?? '';
      maskedCredentials[field.key] = field.secret ? this.mask(value) : value;
    }

    return {
      id: row.id,
      provider: row.provider,
      label: row.label,
      isEnabled: row.isEnabled,
      isDefault: row.isDefault,
      status,
      lastTestedAt: row.lastTestedAt,
      lastTestSuccess: row.lastTestSuccess,
      lastTestMessage: row.lastTestMessage,
      credentials: maskedCredentials,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private mask(value: string): string {
    if (!value) return '';
    return `••••${value.slice(-4)}`;
  }
}
