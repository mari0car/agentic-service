import { z } from "zod";

// ─── Sub-schemas ───────────────────────────────────────────────────────────────

const CorsSchema = z.object({
  enabled: z.boolean().default(true),
  allowed_origins: z.array(z.string()).default(["*"]),
  allowed_methods: z
    .array(z.string())
    .default(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]),
  allowed_headers: z.array(z.string()).default(["Authorization", "Content-Type"]),
  expose_headers: z.array(z.string()).default(["X-Request-Id"]),
  max_age: z.number().default(86400),
});

const RateLimitSchema = z.object({
  enabled: z.boolean().default(false),
  requests_per_window: z.number().default(100),
  window_seconds: z.number().default(60),
  by: z.enum(["ip", "user"]).default("ip"),
});

const TlsSchema = z.object({
  enabled: z.boolean().default(false),
  cert_file: z.string().default(""),
  key_file: z.string().default(""),
});

const ServerSchema = z.object({
  host: z.string().default("0.0.0.0"),
  port: z.coerce.number().default(8080),
  admin_port: z.coerce.number().default(0),
  max_request_size: z.string().default("1mb"),
  request_timeout: z.string().default("30s"),
  max_concurrent_requests: z.coerce.number().default(20),
  cors: CorsSchema.default({}),
  rate_limit: RateLimitSchema.default({}),
  tls: TlsSchema.default({}),
});

const LlmRetrySchema = z.object({
  max_retries: z.number().default(3),
  initial_backoff_ms: z.number().default(500),
  max_backoff_ms: z.number().default(5000),
});

const LlmBedrockSchema = z.object({
  region: z.string().default("us-east-1"),
  profile: z.string().optional(),
  access_key_id: z.string().optional(),
  secret_access_key: z.string().optional(),
});

const LlmSchema = z.object({
  provider: z
    .enum(["openai", "anthropic", "bedrock", "azure", "ollama", "custom"])
    .default("bedrock"),
  api_key: z.string().optional(),
  base_url: z.string().optional(),
  model: z.string().default("eu.anthropic.claude-sonnet-4-6"),
  temperature: z.number().default(0.0),
  max_output_tokens: z.number().default(4096),
  max_input_tokens: z.number().default(8000),
  max_tool_calls: z.number().default(20),
  retry: LlmRetrySchema.default({}),
  bedrock: LlmBedrockSchema.default({}),
  openai: z.object({ organization: z.string().optional() }).default({}),
  anthropic: z.object({ version: z.string().default("2024-01-01") }).default({}),
  azure: z
    .object({ deployment_name: z.string().optional(), api_version: z.string().optional() })
    .default({}),
  ollama: z.object({ host: z.string().default("http://localhost:11434") }).default({}),
});

const SpecsSchema = z.object({
  directory: z.string().default("./specs"),
  routes_file: z.string().default("api-routes.md"),
  global_specs: z
    .array(z.string())
    .default(["service.md", "domain.md", "error-handling.md"]),
  watch: z.boolean().default(false),
  watch_debounce_ms: z.number().default(500),
  validate_on_startup: z.boolean().default(true),
  strict_validation: z.boolean().default(false),
});

const DatabaseMigrationsSchema = z.object({
  directory: z.string().default("./migrations"),
  auto_migrate: z.boolean().default(false),
});

const DatabaseSchema = z.object({
  driver: z.enum(["postgres", "sqlite", "mysql"]).default("postgres"),
  url: z.string().optional(),
  host: z.string().default("localhost"),
  port: z.coerce.number().default(5432),
  name: z.string().default("agentic-service"),
  user: z.string().optional(),
  password: z.string().optional(),
  ssl_mode: z.enum(["disable", "prefer", "require", "verify-full"]).default("prefer"),
  max_connections: z.number().default(20),
  min_connections: z.number().default(2),
  connection_timeout_ms: z.number().default(5000),
  idle_timeout_ms: z.number().default(300000),
  query_timeout_ms: z.number().default(5000),
  max_rows: z.number().default(1000),
  allow_ddl: z.boolean().default(false),
  read_only: z.boolean().default(false),
  migrations: DatabaseMigrationsSchema.default({}),
});

const CacheRedisSchema = z.object({
  url: z.string().optional(),
  host: z.string().default("localhost"),
  port: z.number().default(6379),
  password: z.string().optional(),
  db: z.number().default(0),
  tls: z.boolean().default(false),
});

const CacheSchema = z.object({
  driver: z.enum(["memory", "redis"]).default("memory"),
  redis: CacheRedisSchema.default({}),
  max_entries: z.number().default(10000),
  default_ttl_seconds: z.number().default(3600),
});

const FilesystemSchema = z.object({
  sandbox_directory: z.string().default("./data"),
  max_file_size: z.string().default("10mb"),
  allowed_extensions: z.array(z.string()).default([]),
});

const HttpClientSchema = z.object({
  allowed_urls: z.array(z.string()).default([]),
  default_timeout_ms: z.number().default(10000),
  max_timeout_ms: z.number().default(30000),
  max_response_size: z.string().default("5mb"),
  insecure_skip_verify: z.boolean().default(false),
  default_headers: z.record(z.string()).default({ "User-Agent": "Agentic Service/1.0" }),
});

const JwtSchema = z.object({
  secret: z.string().optional(),
  algorithm: z.enum(["HS256", "RS256", "ES256"]).default("HS256"),
  public_key_file: z.string().optional(),
  issuer: z.string().default("agentic-service"),
  expiry_seconds: z.number().default(3600),
});

const ApiKeysSchema = z.object({
  enabled: z.boolean().default(false),
  header: z.string().default("X-API-Key"),
  keys: z.array(z.string()).default([]),
});

const AdminAuthSchema = z.object({
  enabled: z.boolean().default(true),
  api_key: z.string().optional(),
  localhost_only: z.boolean().default(true),
});

const AuthSchema = z.object({
  jwt: JwtSchema.default({}),
  api_keys: ApiKeysSchema.default({}),
  admin: AdminAuthSchema.default({}),
});

const LoggingSchema = z.object({
  level: z.enum(["debug", "info", "warn", "error"]).default("info"),
  format: z.enum(["json", "text"]).default("json"),
  log_agent_traces: z.boolean().default(false),
  log_tool_calls: z.boolean().default(true),
  log_request_bodies: z.boolean().default(false),
  log_response_bodies: z.boolean().default(false),
});

const MetricsSchema = z.object({
  enabled: z.boolean().default(true),
  path: z.string().default("/metrics"),
});

const TracingSchema = z.object({
  enabled: z.boolean().default(false),
  exporter: z.enum(["otlp", "jaeger", "zipkin"]).default("otlp"),
  endpoint: z.string().default("http://localhost:4317"),
  sample_rate: z.number().default(0.1),
});

const ObservabilitySchema = z.object({
  metrics: MetricsSchema.default({}),
  tracing: TracingSchema.default({}),
});

// ─── Tool registry / static handler config ────────────────────────────────────
//
// Controls the behaviour of hand-authored (or JIT-compiled) route handlers
// that bypass the LLM for simple CRUD operations.
//
// Shadow mode: run both the handler AND the LLM for the same request (in
// parallel), compare outputs, and log any divergence. This gives confidence
// that the handler is correct before fully switching off the LLM.
//
// shadow_sample_rate: fraction of handler-served requests that are also
//   shadow-verified against the LLM. 1.0 = always, 0.05 = 5% of requests.
//   Set to 0 to disable shadow verification entirely.

const ToolRegistrySchema = z.object({
  shadow_mode: z.boolean().default(false),
  shadow_sample_rate: z.number().min(0).max(1).default(1.0),
  shadow_log_divergences: z.boolean().default(true),
});

// ─── Root config schema ────────────────────────────────────────────────────────

export const ConfigSchema = z.object({
  server: ServerSchema.default({}),
  llm: LlmSchema.default({}),
  specs: SpecsSchema.default({}),
  database: DatabaseSchema.default({}),
  cache: CacheSchema.default({}),
  filesystem: FilesystemSchema.default({}),
  http_client: HttpClientSchema.default({}),
  auth: AuthSchema.default({}),
  logging: LoggingSchema.default({}),
  observability: ObservabilitySchema.default({}),
  tool_registry: ToolRegistrySchema.default({}),
});

export type Config = z.infer<typeof ConfigSchema>;
export type LlmConfig = z.infer<typeof LlmSchema>;
export type DatabaseConfig = z.infer<typeof DatabaseSchema>;
export type SpecsConfig = z.infer<typeof SpecsSchema>;
export type AuthConfig = z.infer<typeof AuthSchema>;
export type LoggingConfig = z.infer<typeof LoggingSchema>;
export type ToolRegistryConfig = z.infer<typeof ToolRegistrySchema>;
