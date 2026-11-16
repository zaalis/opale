"use strict";
const ide = require("./accounts/model-catalog");
const compat = require("./accounts/compat-providers");
const BUILTIN = {
  codex: ["OpenAI", "https://api.openai.com/v1", "openai"],
  claude: ["Anthropic", "https://api.anthropic.com/v1", "anthropic"],
  gemini: [
    "Google Gemini",
    "https://generativelanguage.googleapis.com/v1beta",
    "gemini",
  ],
  grok: ["Grok / xAI", "https://api.x.ai/v1", "openai"],
  mistral: ["Mistral", "https://api.mistral.ai/v1", "openai"],
  kimi: ["Kimi", "https://api.moonshot.ai/v1", "openai"],
  local: ["Ollama · local", "http://127.0.0.1:11434/v1", "openai"],
  gguf: ["GGUF · serveur local", "http://127.0.0.1:8080/v1", "openai"],
};
const IMAGE_MODELS = {
  codex: [
    "gpt-image-2.6-flare",
    "gpt-image-2.6-sunburst",
    "gpt-image-2.5-flare",
    "gpt-image-2.5-sunburst",
    "gpt-image-2",
    "gpt-image-1.5",
    "gpt-image-1",
  ],
  gemini: ["gemini-3-pro-image-preview", "gemini-2.5-flash-image"],
  grok: ["grok-imagine-image-quality", "grok-imagine-image"],
};
const PROVIDERS = [
  ...Object.entries(BUILTIN).map(([id, [label, baseUrl, protocol]]) => ({
    id,
    label,
    baseUrl,
    protocol,
    models: [
      ...new Set([...(ide.SUBMODELS[id] || []), ...(IMAGE_MODELS[id] || [])]),
    ],
    keyless: ["local", "gguf"].includes(id),
    local: ["local", "gguf"].includes(id),
    editableUrl: ["local", "gguf"].includes(id),
  })),
  ...compat.PROVIDERS.map((p) => ({
    ...p,
    protocol: p.oauth ? "subscription" : "openai",
  })),
];
// Only expose modalities for which Design has a request adapter.
function modes(id, provider, explicit = []) {
  const image =
    explicit.includes(id) ||
    /(^gpt-image|^chatgpt-image|grok-imagine-image|gemini.*image|imagen-|flux|stable.diffusion|sdxl|qwen.*image)/i.test(
      id,
    );
  // Local servers can expose their own image routes and arbitrary model IDs.
  if (provider.local || provider.id === "custom")
    return image ? ["image"] : ["text"];
  // Retired OpenAI API models; keep arbitrary IDs on local/custom servers.
  if (
    ["codex", "chatgpt"].includes(provider.id) &&
    /^(gpt-3\.5-turbo(?:-|$)|gpt-4(?:$|-0|-turbo|-32k|-vision))/.test(id)
  )
    return [];
  if (
    /(embed|rerank|moderation|whisper|transcri|tts|text-to-speech|realtime|sora|veo[-_]|video|music|audio|3d)/i.test(
      id,
    )
  )
    return [];
  if (image)
    return !provider.oauth &&
      ["codex", "gemini", "grok"].includes(provider.id) &&
      !/^imagen-/i.test(id)
      ? ["image"]
      : [];
  return ["text"];
}

function get(id) {
  return PROVIDERS.find((p) => p.id === id);
}
module.exports = {
  PROVIDERS,
  get,
  modes,
  modelLabel: ide.modelLabel,
  normalizeBaseUrl: compat.normalizeBaseUrl,
};
