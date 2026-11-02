/**
 * Model providers that take one pasted API key, from OpenClaw's bundled plugins
 * and the official `@openclaw/*-provider` packages this app ships. Ids, plugins
 * and variables come from each plugin's manifest (`providerAuthChoices`,
 * `setup.providers[].envVars`); a provider shows only when its plugin is
 * allowed in `openclaw.json`. Alphabetical by label.
 */
export interface ProviderEntry {
  /** OpenClaw's provider id, as in model refs. */
  readonly id: string;
  readonly plugin: string;
  readonly label: string;
  readonly hint?: string;
  readonly keysUrl?: string;
  /** Where Kazusa stores the key, and the variable OpenClaw reads first. */
  readonly keyName: string;
  /** Every variable the plugin reads a key from, `keyName` included. */
  readonly envVars: readonly string[];
  /**
   * Where its reference to the store sits: `models.providers.<id>.apiKey` for a
   * model provider, Kazusa's own config for TypeSafe, whose Jev only Kazusa
   * calls (`decisions/jev.ts`).
   */
  readonly keyIn: "provider" | "kazusa";
}

const entry = (
  id: string,
  label: string,
  rest: Partial<ProviderEntry> & { readonly keyName: string },
): ProviderEntry => ({
  id,
  plugin: id,
  label,
  envVars: [rest.keyName],
  keyIn: "provider",
  ...rest,
});

export const PROVIDERS: readonly ProviderEntry[] = [
  entry("anthropic", "Anthropic", {
    hint: "Claude models",
    keysUrl: "https://console.anthropic.com/settings/keys",
    keyName: "ANTHROPIC_API_KEY",
  }),
  entry("byteplus", "BytePlus", {
    hint: "ByteDance's models, outside China",
    keyName: "BYTEPLUS_API_KEY",
  }),
  entry("cerebras", "Cerebras", {
    hint: "Very fast open models",
    keysUrl: "https://cloud.cerebras.ai",
    keyName: "CEREBRAS_API_KEY",
  }),
  entry("chutes", "Chutes", {
    hint: "Hosted open models",
    keysUrl: "https://chutes.ai/app/settings/api-keys",
    keyName: "CHUTES_API_KEY",
  }),
  entry("deepinfra", "DeepInfra", {
    hint: "Hosted open models",
    keysUrl: "https://deepinfra.com/dash/api_keys",
    keyName: "DEEPINFRA_API_KEY",
  }),
  entry("deepseek", "DeepSeek", {
    hint: "DeepSeek's own models",
    keysUrl: "https://platform.deepseek.com/api_keys",
    keyName: "DEEPSEEK_API_KEY",
  }),
  entry("fireworks", "Fireworks", {
    hint: "Hosted open models",
    keysUrl: "https://fireworks.ai/account/api-keys",
    keyName: "FIREWORKS_API_KEY",
  }),
  entry("google", "Google Gemini", {
    hint: "Gemini models",
    keysUrl: "https://aistudio.google.com/apikey",
    keyName: "GEMINI_API_KEY",
    envVars: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  }),
  entry("groq", "Groq", {
    hint: "Very fast open models",
    keysUrl: "https://console.groq.com/keys",
    keyName: "GROQ_API_KEY",
  }),
  entry("huggingface", "Hugging Face", {
    hint: "Open models through Inference Providers",
    keysUrl: "https://huggingface.co/settings/tokens",
    keyName: "HF_TOKEN",
    envVars: ["HUGGINGFACE_HUB_TOKEN", "HF_TOKEN"],
  }),
  entry("mistral", "Mistral AI", {
    hint: "Mistral's own models",
    keysUrl: "https://console.mistral.ai/api-keys",
    keyName: "MISTRAL_API_KEY",
  }),
  entry("moonshot", "Moonshot AI", {
    hint: "Kimi models",
    keysUrl: "https://platform.kimi.ai",
    keyName: "MOONSHOT_API_KEY",
    envVars: ["MOONSHOT_API_KEY", "KIMI_API_KEY"],
  }),
  entry("novita", "Novita AI", {
    hint: "Hosted open models",
    keysUrl: "https://novita.ai/settings/key-management",
    keyName: "NOVITA_API_KEY",
  }),
  entry("nvidia", "NVIDIA", {
    hint: "Open models on NVIDIA's servers",
    keysUrl: "https://build.nvidia.com/settings/api-keys",
    keyName: "NVIDIA_API_KEY",
  }),
  entry("ollama-cloud", "Ollama Cloud", {
    plugin: "ollama",
    hint: "Open models on Ollama's servers",
    keysUrl: "https://ollama.com/settings/keys",
    keyName: "OLLAMA_API_KEY",
  }),
  entry("openai", "OpenAI", {
    hint: "GPT models",
    keysUrl: "https://platform.openai.com/api-keys",
    keyName: "OPENAI_API_KEY",
  }),
  entry("opencode-go", "OpenCode", {
    hint: "OpenCode Zen and Go models",
    keyName: "OPENCODE_API_KEY",
    envVars: ["OPENCODE_API_KEY", "OPENCODE_ZEN_API_KEY"],
  }),
  entry("openrouter", "OpenRouter", {
    hint: "Hundreds of models behind one key",
    keysUrl: "https://openrouter.ai/keys",
    keyName: "OPENROUTER_API_KEY",
  }),
  entry("qwen", "Qwen Cloud", {
    hint: "Alibaba's Qwen models",
    keysUrl: "https://home.qwencloud.com/api-keys",
    keyName: "QWEN_API_KEY",
    envVars: ["QWEN_API_KEY", "MODELSTUDIO_API_KEY", "DASHSCOPE_API_KEY"],
  }),
  entry("synthetic", "Synthetic", {
    hint: "Hosted open models",
    keyName: "SYNTHETIC_API_KEY",
  }),
  entry("typesafe", "TypeSafe", {
    plugin: "kazusa",
    hint: "Jev decisions, billed by TypeSafe",
    keyName: "TYPESAFE_API_KEY",
    // A plugin secret input is read from its reference only, never the environment.
    envVars: [],
    keyIn: "kazusa",
  }),
  entry("together", "Together AI", {
    hint: "Hosted open models",
    keysUrl: "https://api.together.ai/settings/api-keys",
    keyName: "TOGETHER_API_KEY",
  }),
  entry("venice", "Venice AI", {
    hint: "Private and uncensored models",
    keysUrl: "https://venice.ai/settings/api",
    keyName: "VENICE_API_KEY",
  }),
  entry("volcengine", "Volcano Engine", {
    hint: "ByteDance's models, in China",
    keyName: "VOLCANO_ENGINE_API_KEY",
  }),
  entry("xai", "xAI", {
    hint: "Grok models",
    keysUrl: "https://console.x.ai",
    keyName: "XAI_API_KEY",
  }),
  entry("zai", "Z.AI", {
    hint: "GLM models",
    keysUrl: "https://z.ai/manage-apikey/apikey-list",
    keyName: "ZAI_API_KEY",
    envVars: ["ZAI_API_KEY", "Z_AI_API_KEY"],
  }),
];
