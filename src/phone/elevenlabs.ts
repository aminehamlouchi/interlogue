/**
 * ElevenLabs Agents REST client for the phone path. Native fetch only.
 *
 * Endpoints verified against the ElevenLabs API reference on Sep 12 2026:
 *   POST /v1/convai/twilio/outbound-call
 *        body: agent_id, agent_phone_number_id, to_number,
 *              conversation_initiation_client_data.dynamic_variables
 *        response: success, message, conversation_id, callSid
 *   GET  /v1/convai/conversations/{conversation_id}
 *        status: initiated | in-progress | processing | done | failed
 *        transcript[]: role (user|agent), message, time_in_call_secs
 *        metadata: start_time_unix_secs, call_duration_secs, cost, cost_fiat
 *   Auth header: xi-api-key
 *
 * Credentials come from process.env only, loaded by `node --env-file=.env`.
 * Nothing here reads a file, and nothing here logs.
 */

export const ENV_NAMES = {
  apiKey: "ELEVENLABS_API_KEY",
  agentId: "ELEVENLABS_AGENT_ID",
  phoneNumberId: "ELEVENLABS_PHONE_NUMBER_ID",
} as const;

export const DEFAULT_BASE_URL = "https://api.elevenlabs.io";

export interface PhoneConfig {
  apiKey: string;
  agentId: string;
  phoneNumberId: string;
  baseUrl: string;
}

export type PhoneConfigResult = { ok: true; config: PhoneConfig } | { ok: false; missing: string[] };

/** Read the three values from the environment. Reports missing NAMES only. */
export function getPhoneConfig(env: NodeJS.ProcessEnv = process.env): PhoneConfigResult {
  const missing: string[] = [];
  const apiKey = env[ENV_NAMES.apiKey] ?? "";
  const agentId = env[ENV_NAMES.agentId] ?? "";
  const phoneNumberId = env[ENV_NAMES.phoneNumberId] ?? "";
  if (!apiKey) missing.push(ENV_NAMES.apiKey);
  if (!agentId) missing.push(ENV_NAMES.agentId);
  if (!phoneNumberId) missing.push(ENV_NAMES.phoneNumberId);
  if (missing.length) return { ok: false, missing };
  // The base URL is fixed on purpose: no environment value may redirect a request carrying the key.
  return { ok: true, config: { apiKey, agentId, phoneNumberId, baseUrl: DEFAULT_BASE_URL } };
}

export class ElevenLabsError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly detail: string,
  ) {
    super(message);
    this.name = "ElevenLabsError";
  }
}

export interface OutboundCallResponse {
  success: boolean;
  message: string;
  conversation_id: string | null;
  callSid: string | null;
}

export type ConversationStatus = "initiated" | "in-progress" | "processing" | "done" | "failed";

export interface TranscriptEntry {
  role: "user" | "agent";
  message?: string | null;
  time_in_call_secs: number;
}

export interface ConversationDetails {
  conversation_id: string;
  agent_id?: string;
  status: ConversationStatus;
  transcript: TranscriptEntry[];
  metadata?: {
    start_time_unix_secs?: number;
    call_duration_secs?: number;
    cost?: number | null;
    cost_fiat?: number | null;
    charging?: unknown;
  };
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Strip anything that looks like a phone number from text we might surface. */
function scrub(text: string): string {
  return text.replace(/\+?\d[\d\s().-]{5,}\d/g, (m) => `…${m.replace(/\D/g, "").slice(-4)}`);
}

async function request<T>(config: PhoneConfig, method: "GET" | "POST", pathname: string, body: unknown, fetchImpl: FetchLike): Promise<T> {
  const res = await fetchImpl(`${config.baseUrl}${pathname}`, {
    method,
    headers: {
      "xi-api-key": config.apiKey,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      accept: "application/json",
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) {
    const detail = scrub(text.length > 600 ? `${text.slice(0, 600)}…` : text);
    throw new ElevenLabsError(`ElevenLabs ${method} ${pathname} returned HTTP ${res.status}`, res.status, detail);
  }
  return JSON.parse(text) as T;
}

export interface OutboundCallParams {
  toNumber: string;
  dynamicVariables: Record<string, string>;
}

/** Trigger one outbound call through the ElevenLabs native Twilio integration. */
export async function placeOutboundCall(config: PhoneConfig, params: OutboundCallParams, fetchImpl: FetchLike = fetch): Promise<OutboundCallResponse> {
  return request<OutboundCallResponse>(
    config,
    "POST",
    "/v1/convai/twilio/outbound-call",
    {
      agent_id: config.agentId,
      agent_phone_number_id: config.phoneNumberId,
      to_number: params.toNumber,
      conversation_initiation_client_data: { dynamic_variables: params.dynamicVariables },
    },
    fetchImpl,
  );
}

export async function getConversation(config: PhoneConfig, conversationId: string, fetchImpl: FetchLike = fetch): Promise<ConversationDetails> {
  return request<ConversationDetails>(config, "GET", `/v1/convai/conversations/${encodeURIComponent(conversationId)}`, undefined, fetchImpl);
}

export const TERMINAL_STATUSES: ReadonlySet<ConversationStatus> = new Set(["done", "failed"]);
