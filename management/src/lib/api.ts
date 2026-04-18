const API_BASE = "/api";

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    ...options,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }

  const json = await res.json();
  return json.data ?? json;
}

// Projects
export const api = {
  // Project listing
  listProjects: () => request<any[]>("/projects"),

  getProject: (name: string) => request<any>(`/projects/${name}`),

  // Specs
  getSpecTree: (name: string) => request<any[]>(`/projects/${name}/specs`),

  getSpec: (name: string, filePath: string) =>
    request<any>(`/projects/${name}/specs/${filePath}`),

  saveSpec: (name: string, filePath: string, content: string) =>
    request<any>(`/projects/${name}/specs/${filePath}`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    }),

  deleteSpec: (name: string, filePath: string) =>
    request<any>(`/projects/${name}/specs/${filePath}`, {
      method: "DELETE",
    }),

  // Config
  getConfig: (name: string) => request<any>(`/projects/${name}/config`),

  saveConfig: (name: string, content: string) =>
    request<any>(`/projects/${name}/config`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    }),

  // Migrations
  getMigrations: (name: string) =>
    request<any[]>(`/projects/${name}/migrations`),

  saveMigration: (name: string, filename: string, content: string) =>
    request<any>(`/projects/${name}/migrations/${encodeURIComponent(filename)}`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    }),

  createMigration: (name: string, filename: string, content: string) =>
    request<any>(`/projects/${name}/migrations`, {
      method: "POST",
      body: JSON.stringify({ filename, content }),
    }),

  deleteMigration: (name: string, filename: string) =>
    request<any>(`/projects/${name}/migrations/${encodeURIComponent(filename)}`, {
      method: "DELETE",
    }),

  // Runtime
  getStatus: (name: string) => request<any>(`/runtime/${name}/status`),

  startProject: (name: string) =>
    request<any>(`/runtime/${name}/start`, { method: "POST" }),

  stopProject: (name: string) =>
    request<any>(`/runtime/${name}/stop`, { method: "POST" }),

  getLogs: (name: string) => request<any>(`/runtime/${name}/logs`),

  getHealth: (name: string) => request<any>(`/runtime/${name}/health`),

  runMigrations: (name: string) =>
    request<any>(`/runtime/${name}/migrate`, { method: "POST" }),

  updatePort: (name: string, port: number) =>
    request<{ port: number; saved: boolean }>(`/runtime/${name}/port`, {
      method: "PUT",
      body: JSON.stringify({ port }),
    }),

  testEndpoint: (
    name: string,
    req: { method: string; path: string; headers?: Record<string, string>; body?: unknown }
  ) =>
    request<any>(`/runtime/${name}/test`, {
      method: "POST",
      body: JSON.stringify(req),
    }),

  // Creation
  createSession: () =>
    request<any>("/creation/sessions", { method: "POST" }),

  getSession: (id: string) => request<any>(`/creation/sessions/${id}`),

  applySession: (id: string) =>
    request<any>(`/creation/sessions/${id}/apply`, { method: "POST" }),

  deleteSession: (id: string) =>
    request<any>(`/creation/sessions/${id}`, { method: "DELETE" }),

  // Routes
  getRouteDetail: (name: string, routeIndex: number) =>
    request<any>(`/projects/${name}/routes/${routeIndex}`),

  saveHandler: (
    name: string,
    routeIndex: number,
    data: {
      code: string;
      variableName: string;
      handlerKey: string;
      activateInSpec?: boolean;
    }
  ) =>
    request<any>(`/projects/${name}/routes/${routeIndex}/handler`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  addRoute: (
    name: string,
    data: {
      method: string;
      path: string;
      specFile: string;
      specContent: string;
      section?: string;
    }
  ) =>
    request<any>(`/projects/${name}/routes`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  getRouteSections: (name: string) =>
    request<string[]>(`/projects/${name}/routes/sections`),

  toggleHandler: (name: string, routeIndex: number) =>
    request<{ toggled: boolean; active: boolean; handlerKey: string }>(
      `/projects/${name}/routes/${routeIndex}/handler/toggle`,
      { method: "PATCH" }
    ),
};

// SSE helpers
export function streamLogs(
  name: string,
  onLog: (line: string) => void,
  onError?: (err: Error) => void
): () => void {
  const eventSource = new EventSource(`${API_BASE}/runtime/${name}/logs/stream`);

  eventSource.addEventListener("log", (event) => {
    onLog(event.data);
  });

  eventSource.onerror = () => {
    onError?.(new Error("Log stream connection lost"));
  };

  return () => eventSource.close();
}

export function streamChat(
  sessionId: string,
  message: string,
  onText: (text: string) => void,
  onFiles: (files: any[], projectName?: string) => void,
  onDone: () => void,
  onError: (err: string) => void
): void {
  fetch(`${API_BASE}/creation/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: message }),
  }).then(async (res) => {
    if (!res.ok) {
      onError("Failed to send message");
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      onError("No response stream");
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data:")) {
          const data = line.slice(5).trim();
          if (!data) continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === "text") {
              onText(parsed.content);
            } else if (parsed.type === "files") {
              onFiles(parsed.files, parsed.projectName);
            } else if (parsed.type === "done") {
              onDone();
            } else if (parsed.type === "error") {
              onError(parsed.content);
            }
          } catch {
            // ignore unparseable lines
          }
        }
      }
    }
  }).catch((err) => {
    onError(err.message);
  });
}

// Generic SSE stream helper for LLM generation endpoints
function streamGeneration(
  url: string,
  body: Record<string, unknown>,
  onText: (text: string) => void,
  onDone: (data: Record<string, unknown>) => void,
  onError: (err: string) => void
): AbortController {
  const controller = new AbortController();

  fetch(`${API_BASE}${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: controller.signal,
  }).then(async (res) => {
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({ error: res.statusText }));
      onError(errBody.error || `HTTP ${res.status}`);
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      onError("No response stream");
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data:")) {
          const data = line.slice(5).trim();
          if (!data) continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === "text") {
              onText(parsed.content);
            } else if (parsed.type === "done") {
              onDone(parsed);
            } else if (parsed.type === "error") {
              onError(parsed.content);
            }
          } catch {
            // ignore
          }
        }
      }
    }
  }).catch((err) => {
    if (err.name !== "AbortError") {
      onError(err.message);
    }
  });

  return controller;
}

export function streamGenerateHandler(
  projectName: string,
  routeIndex: number,
  onText: (text: string) => void,
  onDone: (data: { handlerKey: string; variableName: string; fullText: string }) => void,
  onError: (err: string) => void
): AbortController {
  return streamGeneration(
    `/projects/${projectName}/routes/generate-handler`,
    { routeIndex },
    onText,
    onDone as (data: Record<string, unknown>) => void,
    onError
  );
}

export function streamGenerateMigration(
  projectName: string,
  description: string,
  onText: (text: string) => void,
  onDone: (data: { fullText: string; suggestedFilename: string }) => void,
  onError: (err: string) => void
): AbortController {
  return streamGeneration(
    `/projects/${projectName}/migrations/generate`,
    { description },
    onText,
    onDone as (data: Record<string, unknown>) => void,
    onError
  );
}

export function streamGenerateSpec(
  projectName: string,
  data: { description: string; method: string; path: string; specFile: string },
  onText: (text: string) => void,
  onDone: (data: { fullText: string }) => void,
  onError: (err: string) => void
): AbortController {
  return streamGeneration(
    `/projects/${projectName}/routes/generate-spec`,
    data,
    onText,
    onDone as (data: Record<string, unknown>) => void,
    onError
  );
}
