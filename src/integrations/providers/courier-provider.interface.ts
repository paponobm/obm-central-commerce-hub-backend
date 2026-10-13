// The contract every courier adapter implements. Credentials are always a
// flat string map keyed by that provider's own CREDENTIAL_FIELDS — this
// file (and IntegrationsService) never assumes any particular provider's
// field names, so adding a new courier never touches this interface.
export interface CourierCredentialField {
  key: string;
  label: string;
  secret: boolean;
  placeholder?: string;
}

export type CourierCredentials = Record<string, string>;

export interface TestConnectionResult {
  success: boolean;
  message: string;
}

export interface CreateShipmentInput {
  // The order's own human-readable number — used as the courier's
  // "invoice"/merchant reference so a retried request can be recognized
  // as the same shipment rather than booked twice.
  invoice: string;
  recipientName: string;
  recipientPhone: string;
  recipientAddress: string;
  codAmount: number;
  note?: string;
}

export interface CreateShipmentResult {
  success: boolean;
  message: string;
  externalConsignmentId?: string;
  externalTrackingCode?: string;
  raw: unknown;
}

export interface TrackShipmentResult {
  success: boolean;
  message: string;
  // The provider's own status string, unmapped — callers decide whether/how
  // to fold this into our internal ShipmentStatus enum, since couriers
  // don't share a common status vocabulary.
  providerStatus?: string;
  raw: unknown;
}

export interface CancelShipmentResult {
  success: boolean;
  message: string;
  raw: unknown;
}

export interface CourierAdapter {
  readonly credentialFields: CourierCredentialField[];
  testConnection(
    credentials: CourierCredentials,
  ): Promise<TestConnectionResult>;
  createShipment(
    credentials: CourierCredentials,
    input: CreateShipmentInput,
  ): Promise<CreateShipmentResult>;
  trackShipment(
    credentials: CourierCredentials,
    externalConsignmentId: string,
  ): Promise<TrackShipmentResult>;
  // Omitted entirely by adapters whose provider doesn't support it —
  // callers must check for presence, never assume it exists.
  cancelShipment?(
    credentials: CourierCredentials,
    externalConsignmentId: string,
  ): Promise<CancelShipmentResult>;
}
