export type EndpointMode = "auto" | "vllm" | "sglang" | "custom";
export type ModelMode = "include" | "exclude" | "auto";
export type GenStatus = "idle" | "checking" | "generating" | "saved" | "failed";

export interface GenSettings {
  endpointMode: EndpointMode;
  customUrl: string;
  modelMode: ModelMode;
  temperature: number;
  top_k: number;
  max_new_tokens: number;
  filename: string;
  segmented: boolean;
  cloneVoice: boolean;
}

export const ENDPOINT_URLS: Record<Exclude<EndpointMode, "custom" | "auto">, string> = {
  vllm: "http://localhost:8095/v1/audio/speech",
  sglang: "http://localhost:9000/v1/audio/speech",
};

export function resolveEndpointUrl(s: GenSettings): string {
  if (s.endpointMode === "custom") return s.customUrl || "http://localhost:9000/v1/audio/speech";
  if (s.endpointMode === "vllm") return ENDPOINT_URLS.vllm;
  if (s.endpointMode === "sglang") return ENDPOINT_URLS.sglang;
  return ENDPOINT_URLS.vllm; // auto tries vLLM first
}

export function buildPayload(text: string, s: GenSettings): Record<string, unknown> {
  const includeModel = s.modelMode === "include" || (s.modelMode === "auto" && s.endpointMode !== "sglang");
  const payload: Record<string, unknown> = {
    input: text,
    temperature: s.temperature,
    top_k: s.top_k,
    max_new_tokens: s.max_new_tokens,
  };
  if (includeModel) {
    return { model: "bosonai/higgs-audio-v3-tts-4b", ...payload };
  }
  return payload;
}
