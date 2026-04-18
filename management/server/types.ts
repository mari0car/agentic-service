// Management server types - shared between server and UI

export interface ProjectMeta {
  name: string;
  path: string;
  description?: string;
  config: ProjectConfig | null;
  routes: RouteEntry[];
  specFiles: string[];
  globalSpecs: string[];
  migrationFiles: string[];
  hasPackageJson: boolean;
  hasStartScript: boolean;
}

export interface ProjectConfig {
  llm: {
    provider: string;
    model: string;
    temperature?: number;
  };
  server: {
    port: number;
  };
  database: {
    driver: string;
    url?: string;
  };
  specs: {
    directory: string;
    routes_file?: string;
    global_specs?: string[];
  };
  auth?: {
    jwt?: {
      algorithm?: string;
      expiry_seconds?: number;
    };
  };
  logging?: {
    level?: string;
    format?: string;
  };
  [key: string]: unknown;
}

export interface RouteEntry {
  method: string;
  path: string;
  specFile: string;
  handlerType: "llm" | "tool_handler";
  toolHandler?: string;
  specMissing?: boolean;
}

export interface ProjectStatus {
  name: string;
  running: boolean;
  pid?: number;
  port?: number;
  uptime?: number;
  health?: "healthy" | "unhealthy" | "unknown";
  startedAt?: string;
}

export interface SpecFile {
  path: string;
  name: string;
  content: string;
  frontmatter?: Record<string, unknown>;
}

export interface SpecTree {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: SpecTree[];
}

export interface MigrationFile {
  name: string;
  path: string;
  content: string;
}

// LLM Creation types
export interface CreationSession {
  id: string;
  projectName?: string;
  messages: ChatMessage[];
  proposedFiles: ProposedFile[];
  status: "active" | "applied" | "discarded";
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  toolCalls?: ToolCallInfo[];
}

export interface ToolCallInfo {
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
}

export interface ProposedFile {
  path: string;
  content: string;
  language: string;
  description?: string;
}

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  [key: string]: unknown;
}

// Route detail types
export interface RouteDetail {
  route: RouteEntry;
  specContent: string;
  specFrontmatter: Record<string, unknown>;
  handlerCode?: string;
  handlerHelpers?: string;
  handlerVariableName?: string;
  registryExists: boolean;
}

export interface AddRouteRequest {
  method: string;
  path: string;
  specFile: string;
  specContent: string;
  section?: string;
}

export interface GenerateHandlerRequest {
  routeIndex: number;
}

export interface GenerateSpecRequest {
  description: string;
  method: string;
  path: string;
}

// API Testing types
export interface ApiTestRequest {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface ApiTestResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  duration: number;
}
