import { Injectable } from '@nestjs/common';
import {
  CourierAdapter,
  CourierCredentialField,
  CourierCredentials,
  CreateShipmentInput,
  CreateShipmentResult,
  TestConnectionResult,
  TrackShipmentResult,
} from './courier-provider.interface';

// Steadfast Courier (packzy.com). Base URL, header names and endpoint
// paths below are corroborated across several independent third-party
// SDKs/plugins (steadfast-python, the WordPress "SteadFast API" plugin),
// not Steadfast's own developer portal directly — I couldn't reach that in
// search. If a field name here is actually wrong, testConnection/
// createShipment will surface a real HTTP error from Steadfast, not a
// false "success" — see IntegrationsService, which never marks an
// integration Connected except from an actual API response.
const BASE_URL = 'https://portal.packzy.com/api/v1';
const REQUEST_TIMEOUT_MS = 10_000;

interface SteadfastErrorBody {
  message?: string;
  errors?: Record<string, string[]>;
}

// A single flat shape rather than a discriminated union — this project
// builds with strictNullChecks off, which weakens literal-type narrowing
// on `{ ok: true } | { ok: false; errorMessage }`-style unions, so
// `errorMessage` is just always-present-but-possibly-undefined instead.
interface AdapterRequestResult {
  ok: boolean;
  body?: unknown;
  errorMessage?: string;
}

@Injectable()
export class SteadfastAdapter implements CourierAdapter {
  readonly credentialFields: CourierCredentialField[] = [
    { key: 'apiKey', label: 'API Key', secret: false },
    { key: 'secretKey', label: 'Secret Key', secret: true },
  ];

  async testConnection(
    credentials: CourierCredentials,
  ): Promise<TestConnectionResult> {
    const res = await this.request(credentials, 'GET', '/get_balance');
    if (!res.ok) {
      return { success: false, message: res.errorMessage };
    }
    const balance = (res.body as { current_balance?: number })?.current_balance;
    return {
      success: true,
      message:
        balance !== undefined
          ? `Connected — account balance ৳${balance}`
          : 'Connected',
    };
  }

  async createShipment(
    credentials: CourierCredentials,
    input: CreateShipmentInput,
  ): Promise<CreateShipmentResult> {
    const res = await this.request(credentials, 'POST', '/create_order', {
      invoice: input.invoice,
      recipient_name: input.recipientName,
      recipient_phone: input.recipientPhone,
      recipient_address: input.recipientAddress,
      cod_amount: input.codAmount,
      note: input.note,
    });
    if (!res.ok) {
      return { success: false, message: res.errorMessage, raw: res.body };
    }
    const consignment = (
      res.body as {
        consignment?: { consignment_id?: number; tracking_code?: string };
      }
    )?.consignment;
    if (!consignment?.consignment_id) {
      return {
        success: false,
        message:
          'Steadfast accepted the request but returned no consignment id',
        raw: res.body,
      };
    }
    return {
      success: true,
      message: 'Shipment created',
      externalConsignmentId: String(consignment.consignment_id),
      externalTrackingCode: consignment.tracking_code,
      raw: res.body,
    };
  }

  async trackShipment(
    credentials: CourierCredentials,
    externalConsignmentId: string,
  ): Promise<TrackShipmentResult> {
    const res = await this.request(
      credentials,
      'GET',
      `/status_by_cid/${encodeURIComponent(externalConsignmentId)}`,
    );
    if (!res.ok) {
      return { success: false, message: res.errorMessage, raw: res.body };
    }
    const status = (res.body as { delivery_status?: string })?.delivery_status;
    return {
      success: true,
      message: 'Tracking fetched',
      providerStatus: status,
      raw: res.body,
    };
  }

  // No cancelShipment: not corroborated as a supported Steadfast
  // operation in any of the sources checked, so it's omitted rather than
  // guessed — see CourierAdapter's optional cancelShipment?.

  private async request(
    credentials: CourierCredentials,
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<AdapterRequestResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: {
          'Api-Key': credentials.apiKey ?? '',
          'Secret-Key': credentials.secretKey ?? '',
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const text = await res.text();
      let parsed: unknown = undefined;
      try {
        parsed = text ? JSON.parse(text) : undefined;
      } catch {
        // Non-JSON response (e.g. an HTML error page) — fall through with
        // parsed left undefined, the status code still drives ok/not-ok.
      }
      if (!res.ok) {
        const errBody = parsed as SteadfastErrorBody | undefined;
        return {
          ok: false,
          errorMessage:
            errBody?.message ??
            `Steadfast returned HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`,
          body: parsed,
        };
      }
      return { ok: true, body: parsed };
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError';
      return {
        ok: false,
        errorMessage: isAbort
          ? `Steadfast did not respond within ${REQUEST_TIMEOUT_MS / 1000}s`
          : `Could not reach Steadfast: ${err instanceof Error ? err.message : String(err)}`,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
