import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const envPath = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envPath)) loadEnvFile(envPath);
const integer = (name, fallback, min, max) => {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be between ${min} and ${max}`);
  return value;
};
const choice = (name, fallback, options) => {
  const value = process.env[name] || fallback;
  if (!options.includes(value)) throw new Error(`Invalid ${name}`);
  return value;
};
export const config = {
  port: integer('PORT', 4173, 1, 65535),
  cloud: process.env.EDEN_ALLOW_CLOUD === 'true',
  fallback: process.env.EDEN_ENABLE_FALLBACK !== 'false',
  ai: choice('EDEN_AI_PROVIDER', 'auto', ['auto', 'ollama', 'azure_openai']),
  retrieval: choice('EDEN_RETRIEVAL_PROVIDER', 'auto', ['auto', 'chroma', 'local', 'azure_search']),
  speech: choice('EDEN_SPEECH_PROVIDER', 'auto', ['auto', 'browser', 'azure_speech']),
  runtime: choice('EDEN_AGENT_RUNTIME', 'framework', ['framework', 'direct']),
  python: process.env.EDEN_PYTHON_PATH || fileURLToPath(new URL(process.platform === 'win32' ? '../.venv/Scripts/python.exe' : '../.venv/bin/python', import.meta.url)),
  ollama: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
  model: process.env.OLLAMA_MODEL || 'qwen3:4b',
  context: integer('EDEN_AI_CONTEXT_TOKENS', 4096, 2048, 32768),
  output: integer('EDEN_AI_MAX_OUTPUT_TOKENS', 650, 128, 2048),
  timeout: integer('EDEN_AI_TIMEOUT_MS', 60000, 1000, 180000),
  cloudTimeout: integer('EDEN_CLOUD_TIMEOUT_MS', 12000, 1000, 60000),
  semantic: {
    enabled:process.env.EDEN_SEMANTIC_ENABLED!=='false',
    model:process.env.EDEN_EMBEDDING_MODEL||'BAAI/bge-small-en-v1.5',
    revision:process.env.EDEN_EMBEDDING_REVISION||'5c38ec7c405ec4b44b94cc5a9bb96e735b38267a',
    path:resolve(projectRoot,process.env.EDEN_CHROMA_PATH||'.data/chroma'),
    cache:resolve(projectRoot,process.env.EDEN_EMBEDDING_CACHE||'.data/models'),
    topK:integer('EDEN_RETRIEVAL_TOP_K',6,1,12),
    threads:integer('EDEN_EMBEDDING_THREADS',2,1,8),
    retain:integer('EDEN_RETRIEVAL_RETAIN_MATCHES',20,1,100),
    timeout:integer('EDEN_EMBEDDING_TIMEOUT_MS',120000,1000,300000),
  },
  azure: {
    endpoint: process.env.AZURE_OPENAI_ENDPOINT || '',
    deployment: process.env.AZURE_OPENAI_DEPLOYMENT || '',
    key: process.env.AZURE_OPENAI_API_KEY || '',
    search: process.env.AZURE_SEARCH_ENDPOINT || '',
    index: process.env.AZURE_SEARCH_INDEX || 'eden-events',
    searchKey: process.env.AZURE_SEARCH_API_KEY || '',
    searchVersion: process.env.AZURE_SEARCH_API_VERSION || '2024-07-01',
    speechRegion: process.env.AZURE_SPEECH_REGION || '',
    speechKey: process.env.AZURE_SPEECH_KEY || '',
    voice: process.env.AZURE_SPEECH_VOICE || '',
    insights: process.env.APPLICATIONINSIGHTS_CONNECTION_STRING || '',
  },
};

export function configured(service, c = config) {
  if (!c.cloud) return false;
  if (service === 'ai') return Boolean(c.azure.endpoint && c.azure.deployment && c.azure.key);
  if (service === 'search') return Boolean(c.azure.search && c.azure.index && c.azure.searchKey);
  if (service === 'speech') return Boolean(c.azure.speechRegion && c.azure.speechKey);
  return false;
}

// Return only non-secret setup information. Never serialize config or process.env.
export function publicConfig() {
  return { cloudEnabled: config.cloud, fallbackEnabled: config.fallback,
    ai: config.ai, model: config.model, runtime: config.runtime,
    retrieval: config.retrieval, semanticEnabled:config.semantic.enabled, embeddingModel:config.semantic.model, speech: config.speech,
    configured: { ai: configured('ai'), search: configured('search'), speech: configured('speech') } };
}
