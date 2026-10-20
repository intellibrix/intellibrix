import { createRequire } from 'node:module'
import type { ProviderV4 as AiSdkVendorProvider } from '@ai-sdk/provider'
import { createProviderRegistry } from 'ai'
import type { Provider as IntellibrixProvider } from 'intellibrix'
import { type AiSdkProviderOptions, aiSdkProvider } from './provider.js'

const require = createRequire(import.meta.url)

type VendorId = 'anthropic' | 'openai' | 'google'

const VENDOR_PACKAGES: Record<VendorId, string> = {
  anthropic: '@ai-sdk/anthropic',
  openai: '@ai-sdk/openai',
  google: '@ai-sdk/google',
}

const VENDOR_FACTORIES: Record<VendorId, string> = {
  anthropic: 'anthropic',
  openai: 'openai',
  google: 'google',
}

let cachedRegistryProviders: Record<string, AiSdkVendorProvider> | undefined

/**
 * Lazily resolves whichever vendor adapters (`@ai-sdk/anthropic`,
 * `@ai-sdk/openai`, `@ai-sdk/google`) are actually installed, so that
 * `@intellibrix/ai-sdk` builds and typechecks with only `ai` present and no
 * vendor SDKs. Missing packages are silently skipped; only requesting a
 * model from a vendor whose package isn't installed throws.
 */
function resolveRegistryProviders(): Record<string, AiSdkVendorProvider> {
  if (cachedRegistryProviders) return cachedRegistryProviders

  const providers: Record<string, AiSdkVendorProvider> = {}
  for (const vendor of Object.keys(VENDOR_PACKAGES) as VendorId[]) {
    try {
      const mod = require(VENDOR_PACKAGES[vendor])
      const factory = mod[VENDOR_FACTORIES[vendor]]
      if (factory) providers[vendor] = factory
    } catch {
      // Optional peer not installed, so skip it. A subsequent `provider('<vendor>:...')`
      // call throws an actionable error rather than a generic module-not-found.
    }
  }

  cachedRegistryProviders = providers
  return providers
}

/**
 * Resolves an intellibrix {@link IntellibrixProvider} from a
 * `"<vendor>:<model>"` string (e.g. `"anthropic:claude-sonnet-5"`), backed by
 * whichever `@ai-sdk/*` vendor adapter is installed. Throws an actionable
 * error naming the missing package if the vendor's adapter isn't installed.
 */
export function provider(modelString: string, opts?: AiSdkProviderOptions): IntellibrixProvider {
  const [vendor] = modelString.split(':', 1)
  const providers = resolveRegistryProviders()

  if (vendor && !(vendor in providers) && vendor in VENDOR_PACKAGES) {
    throw new Error(
      `@intellibrix/ai-sdk: provider "${vendor}" requires "${VENDOR_PACKAGES[vendor as VendorId]}" to be installed.`,
    )
  }

  const registry = createProviderRegistry(providers)
  const languageModel = registry.languageModel(modelString as `${string}:${string}`)
  return aiSdkProvider(languageModel, opts)
}

/**
 * Resolves an intellibrix {@link IntellibrixProvider} against an
 * OpenAI-compatible HTTP endpoint (Ollama, OpenRouter, vLLM, etc.) via
 * `@ai-sdk/openai-compatible`, rather than string-hacking a non-registry URL
 * through {@link provider}.
 */
export function compatibleProvider(
  model: string,
  config: { baseURL: string; apiKey?: string; name?: string },
  opts?: AiSdkProviderOptions,
): IntellibrixProvider {
  let createOpenAICompatible: any
  try {
    createOpenAICompatible = require('@ai-sdk/openai-compatible').createOpenAICompatible
  } catch {
    throw new Error(
      '@intellibrix/ai-sdk: compatibleProvider() requires "@ai-sdk/openai-compatible" to be installed.',
    )
  }

  const vendor = createOpenAICompatible({
    name: config.name ?? 'compatible',
    baseURL: config.baseURL,
    apiKey: config.apiKey,
  })

  return aiSdkProvider(vendor.languageModel(model), opts)
}
