export interface GenerateParams {
  text: string;
  endpointMode: "auto" | "vllm" | "sglang" | "custom";
  customUrl?: string;
  includeModel: boolean;
  autoRetry: boolean;
  temperature: number;
  top_k: number;
  max_new_tokens: number;
  filename: string;
  segmented?: boolean;
  cloneVoice?: boolean;
}

export interface HistoryItem {
  id: string;
  timestamp: string;
  filename: string;
  endpointUsed: string;
  text: string;
  cleanText: string;
  parameters: {
    temperature: number;
    top_k: number;
    max_new_tokens: number;
    endpointMode: string;
  };
  fileSize: number;
  status: "saved" | "failed";
  elapsed?: number;
  error?: string;
  mirrored?: boolean;
}

export interface GenerateResponse {
  ok: boolean;
  filename?: string;
  url?: string;
  endpointUsed?: string;
  fileSize?: number;
  elapsed?: number;
  segments?: number;
  historyItem?: HistoryItem;
  error?: string;
}

export interface HealthResponse {
  ok: boolean;
  backend: string;
  endpoints: {
    vllm: { url: string; reachable: boolean };
    sglang: { url: string; reachable: boolean };
  };
}

export interface ValidationWarning {
  level: "error" | "warn" | "fix";
  code: string;
  message: string;
}

const BASE = "/api";

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  return data as T;
}

export async function health(): Promise<HealthResponse> {
  const res = await fetch(`${BASE}/health`);
  return jsonOrThrow<HealthResponse>(res);
}

export async function generate(
  params: GenerateParams,
  signal?: AbortSignal,
): Promise<GenerateResponse> {
  const res = await fetch(`${BASE}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    signal,
  });
  return jsonOrThrow<GenerateResponse>(res);
}

export async function getHistory(): Promise<HistoryItem[]> {
  const res = await fetch(`${BASE}/history`);
  return jsonOrThrow<HistoryItem[]>(res);
}

export async function deleteHistory(id: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${BASE}/history/${id}`, { method: "DELETE" });
  return jsonOrThrow<{ ok: boolean }>(res);
}

export async function validateText(text: string): Promise<ValidationWarning[]> {
  const res = await fetch(`${BASE}/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const data = await jsonOrThrow<{ warnings: ValidationWarning[] }>(res);
  return data.warnings ?? [];
}

export function audioUrl(filename: string): string {
  return `${BASE}/audio/${encodeURIComponent(filename)}`;
}
