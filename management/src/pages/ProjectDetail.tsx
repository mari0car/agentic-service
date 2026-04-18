import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, Link, Routes, Route, useNavigate, useLocation } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, streamLogs, streamGenerateHandler, streamGenerateSpec, streamGenerateMigration } from "../lib/api";
import StatusBadge from "../components/StatusBadge";

export default function ProjectDetail() {
  const { name } = useParams<{ name: string }>();
  const location = useLocation();
  const queryClient = useQueryClient();

  const [portInput, setPortInput] = useState<string>("");
  const [showPortChange, setShowPortChange] = useState(false);

  const { data: project, isLoading } = useQuery({
    queryKey: ["project", name],
    queryFn: () => api.getProject(name!),
    enabled: !!name,
  });

  const { data: status, refetch: refetchStatus } = useQuery({
    queryKey: ["status", name],
    queryFn: () => api.getStatus(name!),
    enabled: !!name,
    refetchInterval: 5000,
  });

  const startMutation = useMutation({
    mutationFn: () => api.startProject(name!),
    onSuccess: () => {
      setShowPortChange(false);
      refetchStatus();
    },
    onError: (err: Error) => {
      if (err.message.match(/^Port \d+ is already in use/)) {
        const conflictPort = project?.config?.server?.port || 8080;
        setPortInput(String(conflictPort + 1));
        setShowPortChange(true);
      }
    },
  });

  const stopMutation = useMutation({
    mutationFn: () => api.stopProject(name!),
    onSuccess: () => {
      refetchStatus();
    },
  });

  const migrateMutation = useMutation({
    mutationFn: () => api.runMigrations(name!),
  });

  const updatePortMutation = useMutation({
    mutationFn: (port: number) => api.updatePort(name!, port),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project", name] });
      startMutation.reset();
      startMutation.mutate();
    },
  });

  if (isLoading || !project) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  const currentTab = location.pathname.split("/").pop() || "";
  const tabs = [
    { id: "", label: "Overview", path: `/projects/${name}` },
    { id: "specs", label: "Specs", path: `/projects/${name}/specs` },
    { id: "routes", label: "Routes", path: `/projects/${name}/routes` },
    { id: "migrations", label: "Migrations", path: `/projects/${name}/migrations` },
    { id: "logs", label: "Logs", path: `/projects/${name}/logs` },
    { id: "test", label: "API Test", path: `/projects/${name}/test` },
  ];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Link
            to="/"
            className="text-gray-400 hover:text-gray-200 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-white">{name}</h1>
            {project.description && (
              <p className="text-gray-400 text-sm mt-0.5">{project.description}</p>
            )}
          </div>
          <StatusBadge running={status?.running} health={status?.health} />
        </div>

        <div className="flex items-center gap-2">
          {migrateMutation.isPending ? (
            <button disabled className="px-3 py-1.5 text-sm bg-gray-800 text-gray-500 rounded-lg">
              Migrating...
            </button>
          ) : (
            <button
              onClick={() => migrateMutation.mutate()}
              className="px-3 py-1.5 text-sm bg-gray-800 text-gray-300 hover:bg-gray-700 rounded-lg transition-colors"
            >
              Run Migrations
            </button>
          )}
          {status?.running ? (
            <button
              onClick={() => stopMutation.mutate()}
              disabled={stopMutation.isPending}
              className="px-4 py-1.5 text-sm bg-red-600/20 text-red-400 hover:bg-red-600/30 border border-red-800/50 rounded-lg transition-colors"
            >
              {stopMutation.isPending ? "Stopping..." : "Stop"}
            </button>
          ) : (
            <button
              onClick={() => startMutation.mutate()}
              disabled={startMutation.isPending}
              className="px-4 py-1.5 text-sm bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 border border-emerald-800/50 rounded-lg transition-colors"
            >
              {startMutation.isPending ? "Starting..." : "Start"}
            </button>
          )}
        </div>
      </div>

      {/* Port conflict banner */}
      {showPortChange && startMutation.error && (
        <div className="mb-4 p-4 rounded-lg bg-amber-950/30 border border-amber-800/50 text-sm">
          <p className="text-amber-300 font-medium mb-1">
            Port {project?.config?.server?.port || 8080} is already in use
          </p>
          <p className="text-amber-400/70 mb-3">
            Another process is listening on that port. Choose a different port and try again.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={65535}
              value={portInput}
              onChange={(e) => setPortInput(e.target.value)}
              className="w-28 px-2 py-1 rounded bg-gray-900 border border-gray-700 text-white text-sm focus:outline-none focus:border-amber-600"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const p = parseInt(portInput, 10);
                  if (p >= 1 && p <= 65535) updatePortMutation.mutate(p);
                }
              }}
            />
            <button
              onClick={() => {
                const p = parseInt(portInput, 10);
                if (p >= 1 && p <= 65535) updatePortMutation.mutate(p);
              }}
              disabled={updatePortMutation.isPending || startMutation.isPending}
              className="px-3 py-1 text-sm bg-amber-700/40 text-amber-300 hover:bg-amber-700/60 border border-amber-700/50 rounded transition-colors disabled:opacity-50"
            >
              {updatePortMutation.isPending || startMutation.isPending ? "Saving…" : "Save & retry"}
            </button>
            <button
              onClick={() => { setShowPortChange(false); startMutation.reset(); }}
              className="px-3 py-1 text-sm text-gray-500 hover:text-gray-300 transition-colors"
            >
              Dismiss
            </button>
          </div>
          {updatePortMutation.error && (
            <p className="mt-2 text-red-400 text-xs">{(updatePortMutation.error as Error).message}</p>
          )}
        </div>
      )}

      {/* Generic error messages (stop / migrate, or non-port start errors) */}
      {((startMutation.error && !showPortChange) || stopMutation.error || migrateMutation.error) && (
        <div className="mb-4 p-3 rounded-lg bg-red-950/30 border border-red-900/50 text-red-400 text-sm">
          {(startMutation.error || stopMutation.error || migrateMutation.error)?.message}
        </div>
      )}
      {migrateMutation.data && (
        <div className={`mb-4 p-3 rounded-lg text-sm ${migrateMutation.data.success ? "bg-emerald-950/30 border border-emerald-900/50 text-emerald-400" : "bg-red-950/30 border border-red-900/50 text-red-400"}`}>
          <pre className="whitespace-pre-wrap font-mono text-xs">{migrateMutation.data.output || "Migrations completed"}</pre>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-800 mb-6">
        <nav className="flex gap-0 -mb-px">
          {tabs.map((tab) => {
            const isActive = tab.id === ""
              ? location.pathname === `/projects/${name}`
              : location.pathname.includes(`/projects/${name}/${tab.id}`);
            return (
              <Link
                key={tab.id}
                to={tab.path}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  isActive
                    ? "border-indigo-500 text-indigo-400"
                    : "border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-700"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Tab content */}
      <Routes>
        <Route index element={<OverviewTab project={project} status={status} />} />
        <Route path="specs/*" element={<SpecsTab name={name!} project={project} />} />
        <Route path="routes" element={<RoutesTab project={project} name={name!} />} />
        <Route path="migrations" element={<MigrationsTab name={name!} project={project} />} />
        <Route path="logs" element={<LogsTab name={name!} />} />
        <Route path="test" element={<ApiTestTab name={name!} project={project} status={status} />} />
      </Routes>
    </div>
  );
}

// ─── Overview Tab ──────────────────────────────────────────────────────────────

function OverviewTab({ project, status }: { project: any; status: any }) {
  const config = project.config;
  if (!config) {
    return <p className="text-gray-400">No config.yaml found</p>;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <InfoCard title="Server">
        <InfoRow label="Port" value={config.server?.port || 8080} />
        <InfoRow label="Status" value={status?.running ? "Running" : "Stopped"} />
        {status?.uptime && (
          <InfoRow label="Uptime" value={formatUptime(status.uptime)} />
        )}
        <InfoRow label="CORS" value={config.server?.cors?.enabled ? "Enabled" : "Disabled"} />
      </InfoCard>

      <InfoCard title="LLM">
        <InfoRow label="Provider" value={config.llm?.provider || "none"} />
        <InfoRow label="Model" value={config.llm?.model || "none"} />
        <InfoRow label="Temperature" value={config.llm?.temperature ?? "default"} />
        <InfoRow label="Max Tokens" value={config.llm?.max_output_tokens || "default"} />
      </InfoCard>

      <InfoCard title="Database">
        <InfoRow label="Driver" value={config.database?.driver || "none"} />
        <InfoRow label="URL" value={config.database?.url || "not set"} />
        <InfoRow label="Max Rows" value={config.database?.max_rows || "default"} />
        <InfoRow label="DDL Allowed" value={config.database?.allow_ddl ? "Yes" : "No"} />
      </InfoCard>

      <InfoCard title="Specs">
        <InfoRow label="Directory" value={config.specs?.directory || "./specs"} />
        <InfoRow label="Routes File" value={config.specs?.routes_file || "api-routes.md"} />
        <InfoRow label="Global Specs" value={`${project.globalSpecs?.length || 0} files`} />
        <InfoRow label="Total Specs" value={`${project.specFiles?.length || 0} files`} />
      </InfoCard>

      <InfoCard title="Authentication">
        <InfoRow label="JWT Algorithm" value={config.auth?.jwt?.algorithm || "none"} />
        <InfoRow label="Token Expiry" value={config.auth?.jwt?.expiry_seconds ? `${config.auth.jwt.expiry_seconds}s` : "not set"} />
      </InfoCard>

      <InfoCard title="Logging">
        <InfoRow label="Level" value={config.logging?.level || "info"} />
        <InfoRow label="Format" value={config.logging?.format || "json"} />
        <InfoRow label="Log Tool Calls" value={config.logging?.log_tool_calls ? "Yes" : "No"} />
      </InfoCard>
    </div>
  );
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-300 font-mono text-xs truncate ml-4 max-w-[60%] text-right">{String(value)}</span>
    </div>
  );
}

// ─── Specs Tab ─────────────────────────────────────────────────────────────────

function SpecsTab({ name, project }: { name: string; project: any }) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const queryClient = useQueryClient();

  const { data: specTree } = useQuery({
    queryKey: ["specTree", name],
    queryFn: () => api.getSpecTree(name),
  });

  const { data: specData } = useQuery({
    queryKey: ["spec", name, selectedFile],
    queryFn: () => api.getSpec(name, selectedFile!),
    enabled: !!selectedFile,
  });

  useEffect(() => {
    if (specData?.content) {
      setEditContent(specData.content);
      setIsDirty(false);
    }
  }, [specData]);

  const saveMutation = useMutation({
    mutationFn: () => api.saveSpec(name, selectedFile!, editContent),
    onSuccess: () => {
      setIsDirty(false);
      queryClient.invalidateQueries({ queryKey: ["spec", name, selectedFile] });
    },
  });

  return (
    <div className="flex gap-4 h-[calc(100vh-280px)]">
      {/* File tree */}
      <div className="w-64 shrink-0 rounded-lg border border-gray-800 bg-gray-900/50 overflow-auto">
        <div className="p-3 border-b border-gray-800">
          <h3 className="text-sm font-medium text-gray-300">Spec Files</h3>
        </div>
        <div className="p-2">
          {specTree ? (
            <FileTree
              items={specTree}
              selectedFile={selectedFile}
              onSelect={setSelectedFile}
            />
          ) : (
            <p className="text-gray-500 text-xs p-2">Loading...</p>
          )}
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 rounded-lg border border-gray-800 bg-gray-900/50 flex flex-col overflow-hidden">
        {selectedFile ? (
          <>
            <div className="flex items-center justify-between p-3 border-b border-gray-800">
              <span className="text-sm text-gray-300 font-mono">{selectedFile}</span>
              <div className="flex items-center gap-2">
                {isDirty && (
                  <span className="text-xs text-yellow-400">Unsaved changes</span>
                )}
                <button
                  onClick={() => saveMutation.mutate()}
                  disabled={!isDirty || saveMutation.isPending}
                  className="px-3 py-1 text-xs bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded transition-colors"
                >
                  {saveMutation.isPending ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
            <textarea
              value={editContent}
              onChange={(e) => {
                setEditContent(e.target.value);
                setIsDirty(true);
              }}
              className="flex-1 bg-transparent text-gray-200 font-mono text-sm p-4 resize-none outline-none"
              spellCheck={false}
            />
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            Select a spec file to view and edit
          </div>
        )}
      </div>
    </div>
  );
}

function FileTree({
  items,
  selectedFile,
  onSelect,
  depth = 0,
}: {
  items: any[];
  selectedFile: string | null;
  onSelect: (path: string) => void;
  depth?: number;
}) {
  return (
    <div>
      {items.map((item: any) => (
        <div key={item.path}>
          {item.type === "directory" ? (
            <div>
              <div
                className="flex items-center gap-1.5 px-2 py-1 text-xs text-gray-400 font-medium"
                style={{ paddingLeft: `${depth * 12 + 8}px` }}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                </svg>
                {item.name}
              </div>
              {item.children && (
                <FileTree
                  items={item.children}
                  selectedFile={selectedFile}
                  onSelect={onSelect}
                  depth={depth + 1}
                />
              )}
            </div>
          ) : (
            <button
              onClick={() => onSelect(item.path)}
              className={`w-full text-left flex items-center gap-1.5 px-2 py-1 text-xs rounded transition-colors ${
                selectedFile === item.path
                  ? "bg-indigo-600/20 text-indigo-300"
                  : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"
              }`}
              style={{ paddingLeft: `${depth * 12 + 8}px` }}
            >
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
              {item.name}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Routes Tab ────────────────────────────────────────────────────────────────

function RoutesTab({ project, name }: { project: any; name: string }) {
  const routes = project.routes || [];
  const [expandedRoute, setExpandedRoute] = useState<number | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const queryClient = useQueryClient();

  return (
    <div>
      {/* Header with Add Route button */}
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-gray-400">
          {routes.length} route{routes.length !== 1 ? "s" : ""} defined
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Add Route
        </button>
      </div>

      {/* Routes table */}
      <div className="rounded-lg border border-gray-800 bg-gray-900/50 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-800">
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Method</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Path</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Spec File</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Handler</th>
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody>
            {routes.map((route: any, i: number) => (
              <RouteRow
                key={i}
                route={route}
                index={i}
                isExpanded={expandedRoute === i}
                onToggle={() => setExpandedRoute(expandedRoute === i ? null : i)}
                projectName={name}
              />
            ))}
          </tbody>
        </table>
        {routes.length === 0 && (
          <div className="p-8 text-center text-gray-500 text-sm">
            No routes defined. Click "Add Route" to create one.
          </div>
        )}
      </div>

      {/* Add Route Modal */}
      {showAddModal && (
        <AddRouteModal
          projectName={name}
          onClose={() => setShowAddModal(false)}
          onCreated={() => {
            setShowAddModal(false);
            queryClient.invalidateQueries({ queryKey: ["project", name] });
          }}
        />
      )}
    </div>
  );
}

function RouteRow({
  route,
  index,
  isExpanded,
  onToggle,
  projectName,
}: {
  route: any;
  index: number;
  isExpanded: boolean;
  onToggle: () => void;
  projectName: string;
}) {
  const queryClient = useQueryClient();

  const toggleMutation = useMutation({
    mutationFn: () => api.toggleHandler(projectName, index),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project", projectName] });
      queryClient.invalidateQueries({ queryKey: ["routeDetail", projectName, index] });
    },
  });

  const isFast = route.handlerType === "tool_handler";
  const hasHandler = !!route.toolHandler;

  return (
    <>
      <tr
        className={`border-b border-gray-800/50 hover:bg-gray-800/30 cursor-pointer transition-colors ${
          isExpanded ? "bg-gray-800/20" : ""
        }`}
        onClick={onToggle}
      >
        <td className="px-4 py-3">
          <MethodBadge method={route.method} />
        </td>
        <td className="px-4 py-3 font-mono text-sm text-gray-300">{route.path}</td>
        <td className="px-4 py-3 font-mono text-sm">
          <span className={route.specMissing ? "text-red-400" : "text-gray-400"}>{route.specFile}</span>
          {route.specMissing && (
            <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-red-950/50 text-red-400 border border-red-900/50">
              missing
            </span>
          )}
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            {hasHandler ? (
              <>
                {/* Toggle switch */}
                <button
                  role="switch"
                  aria-checked={isFast}
                  onClick={() => toggleMutation.mutate()}
                  disabled={toggleMutation.isPending}
                  title={isFast ? "Switch to LLM handler" : "Switch to Fast Handler"}
                  className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 ${
                    isFast ? "bg-blue-600" : "bg-gray-600"
                  }`}
                >
                  <span
                    className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${
                      isFast ? "translate-x-3.5" : "translate-x-0.5"
                    }`}
                  />
                </button>
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                  isFast
                    ? "bg-blue-950/50 text-blue-400 border border-blue-900/50"
                    : "bg-purple-950/50 text-purple-400 border border-purple-900/50"
                }`}>
                  {isFast ? "Fast Handler" : "LLM"}
                </span>
              </>
            ) : (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-950/50 text-purple-400 border border-purple-900/50">
                LLM
              </span>
            )}
          </div>
        </td>
        <td className="px-4 py-3 text-gray-500">
          <svg
            className={`w-4 h-4 transition-transform ${isExpanded ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={5} className="p-0">
            <RouteDetailPanel
              projectName={projectName}
              routeIndex={index}
              route={route}
            />
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Delete Spec Button ───────────────────────────────────────────────────────

function DeleteSpecButton({
  projectName,
  specFile,
  onDeleted,
}: {
  projectName: string;
  specFile: string;
  onDeleted: () => void;
}) {
  const [confirm, setConfirm] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteSpec(projectName, specFile),
    onSuccess: () => {
      setConfirm(false);
      onDeleted();
    },
  });

  if (confirm) {
    return (
      <div className="flex items-center gap-1">
        <span className="text-xs text-red-400">Delete spec?</span>
        <button
          onClick={() => deleteMutation.mutate()}
          disabled={deleteMutation.isPending}
          className="px-2 py-0.5 text-xs bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white rounded transition-colors"
        >
          {deleteMutation.isPending ? "Deleting..." : "Yes, delete"}
        </button>
        <button
          onClick={() => setConfirm(false)}
          disabled={deleteMutation.isPending}
          className="px-2 py-0.5 text-xs text-gray-400 hover:bg-gray-700/50 rounded transition-colors"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirm(true)}
      className="px-2 py-0.5 text-xs text-gray-500 hover:text-red-400 hover:bg-red-950/30 rounded transition-colors"
      title="Delete spec file"
    >
      Delete
    </button>
  );
}

// ─── Route Detail Panel ────────────────────────────────────────────────────────

function RouteDetailPanel({
  projectName,
  routeIndex,
  route,
}: {
  projectName: string;
  routeIndex: number;
  route: any;
}) {
  const queryClient = useQueryClient();

  const { data: detail, isLoading } = useQuery({
    queryKey: ["routeDetail", projectName, routeIndex],
    queryFn: () => api.getRouteDetail(projectName, routeIndex),
  });

  // State for spec editing
  const [specContent, setSpecContent] = useState("");
  const [specDirty, setSpecDirty] = useState(false);

  // State for handler editing
  const [handlerCode, setHandlerCode] = useState("");
  const [handlerDirty, setHandlerDirty] = useState(false);
  const [handlerMeta, setHandlerMeta] = useState<{
    variableName: string;
    handlerKey: string;
  } | null>(null);

  // State for restart feedback after activating a new handler
  const [restartMessage, setRestartMessage] = useState<string | null>(null);

  // State for LLM handler generation
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedCode, setGeneratedCode] = useState("");
  const [generationError, setGenerationError] = useState("");
  const [generationMeta, setGenerationMeta] = useState<{
    handlerKey: string;
    variableName: string;
  } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // State for LLM spec generation (missing spec)
  const [specGenDescription, setSpecGenDescription] = useState("");
  const [isGeneratingSpec, setIsGeneratingSpec] = useState(false);
  const [specGenError, setSpecGenError] = useState("");
  const [generatedSpec, setGeneratedSpec] = useState("");
  const specAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (detail) {
      setSpecContent(detail.specContent || "");
      setSpecDirty(false);
      if (detail.handlerCode) {
        setHandlerCode(detail.handlerCode);
        setHandlerDirty(false);
        setHandlerMeta({
          variableName: detail.handlerVariableName || "",
          handlerKey: route.toolHandler || "",
        });
      }
    }
  }, [detail, route.toolHandler]);

  const saveSpecMutation = useMutation({
    mutationFn: () => api.saveSpec(projectName, route.specFile, specContent),
    onSuccess: () => {
      setSpecDirty(false);
      queryClient.invalidateQueries({
        queryKey: ["routeDetail", projectName, routeIndex],
      });
    },
  });

  const saveHandlerMutation = useMutation({
    mutationFn: (data: {
      code: string;
      variableName: string;
      handlerKey: string;
      activateInSpec?: boolean;
    }) => api.saveHandler(projectName, routeIndex, data),
    onSuccess: (result: { saved: boolean; handlerKey: string; restarted?: boolean; restartError?: string }) => {
      setHandlerDirty(false);
      setGeneratedCode("");
      setGenerationMeta(null);
      if (result.restarted) {
        setRestartMessage("Project restarted — fast handler is now active.");
        setTimeout(() => setRestartMessage(null), 4000);
      } else if (result.restartError) {
        setRestartMessage(result.restartError);
        setTimeout(() => setRestartMessage(null), 6000);
      }
      queryClient.invalidateQueries({
        queryKey: ["routeDetail", projectName, routeIndex],
      });
      queryClient.invalidateQueries({ queryKey: ["project", projectName] });
    },
  });

  const toggleHandlerMutation = useMutation({
    mutationFn: () => api.toggleHandler(projectName, routeIndex),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project", projectName] });
      queryClient.invalidateQueries({
        queryKey: ["routeDetail", projectName, routeIndex],
      });
    },
  });

  const startGeneration = useCallback(() => {
    setIsGenerating(true);
    setGeneratedCode("");
    setGenerationError("");
    setGenerationMeta(null);

    const controller = streamGenerateHandler(
      projectName,
      routeIndex,
      (text) => {
        setGeneratedCode((prev) => prev + text);
      },
      (data) => {
        setIsGenerating(false);
        setGenerationMeta({
          handlerKey: data.handlerKey,
          variableName: data.variableName,
        });
      },
      (err) => {
        setIsGenerating(false);
        setGenerationError(err);
      }
    );

    abortRef.current = controller;
  }, [projectName, routeIndex]);

  const cancelGeneration = useCallback(() => {
    abortRef.current?.abort();
    setIsGenerating(false);
  }, []);

  const acceptGenerated = useCallback(() => {
    if (!generationMeta) return;
    const isNew = route.handlerType !== "tool_handler";
    saveHandlerMutation.mutate({
      code: generatedCode,
      variableName: generationMeta.variableName,
      handlerKey: generationMeta.handlerKey,
      activateInSpec: isNew,
    });
  }, [generatedCode, generationMeta, route.handlerType, saveHandlerMutation]);

  const startSpecGeneration = useCallback(() => {
    setIsGeneratingSpec(true);
    setSpecGenError("");
    setGeneratedSpec("");

    const controller = streamGenerateSpec(
      projectName,
      { description: specGenDescription, method: route.method, path: route.path, specFile: route.specFile },
      (text) => setGeneratedSpec((prev) => prev + text),
      () => setIsGeneratingSpec(false),
      (err) => { setIsGeneratingSpec(false); setSpecGenError(err); }
    );
    specAbortRef.current = controller;
  }, [projectName, specGenDescription, route.method, route.path, route.specFile]);

  const acceptGeneratedSpec = useCallback(() => {
    const content = generatedSpec;
    setSpecContent(content);
    setGeneratedSpec("");
    setSpecGenDescription("");
    // Save immediately
    api.saveSpec(projectName, route.specFile, content).then(() => {
      setSpecDirty(false);
      queryClient.invalidateQueries({ queryKey: ["routeDetail", projectName, routeIndex] });
      queryClient.invalidateQueries({ queryKey: ["project", projectName] });
    });
  }, [generatedSpec, projectName, route.specFile, routeIndex, queryClient]);

  if (isLoading) {
    return (
      <div className="p-6 border-t border-gray-800 bg-gray-950/50">
        <div className="flex items-center gap-2 text-gray-400 text-sm">
          <div className="animate-spin w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full" />
          Loading route details...
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="p-6 border-t border-gray-800 bg-gray-950/50 text-gray-500 text-sm">
        Failed to load route details
      </div>
    );
  }

  const hasFastHandler = route.handlerType === "tool_handler" && detail.handlerCode;
  const showGeneration = generatedCode || isGenerating;
  const isFastActive = route.handlerType === "tool_handler";
  const hasHandlerKey = !!route.toolHandler;

  return (
    <div className="border-t border-gray-800 bg-gray-950/50">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800/50 bg-gray-900/30">
        <div className="flex items-center gap-3 text-xs text-gray-400">
          <span className="font-mono">{route.method} {route.path}</span>
          {route.toolHandler && (
            <>
              <span className="text-gray-600">|</span>
              <span>handler key: <span className="font-mono text-gray-300">{route.toolHandler}</span></span>
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          {/* Handler toggle — only shown when a handler key exists */}
          {hasHandlerKey && (
            <div className="flex items-center gap-2">
              <span className={`text-xs ${isFastActive ? "text-blue-400" : "text-purple-400"}`}>
                {isFastActive ? "Fast Handler" : "LLM"}
              </span>
              <button
                role="switch"
                aria-checked={isFastActive}
                onClick={() => toggleHandlerMutation.mutate()}
                disabled={toggleHandlerMutation.isPending}
                title={isFastActive ? "Switch to LLM handler" : "Switch to Fast Handler"}
                className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 ${
                  isFastActive ? "bg-blue-600" : "bg-gray-600"
                }`}
              >
                <span
                  className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${
                    isFastActive ? "translate-x-3.5" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
          )}
          {!hasFastHandler && !showGeneration && !!specContent && (
            <button
              onClick={startGeneration}
              className="flex items-center gap-1.5 px-3 py-1 text-xs bg-amber-600/20 text-amber-400 hover:bg-amber-600/30 border border-amber-800/50 rounded transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
              Generate Fast Handler
            </button>
          )}
        </div>
      </div>

      {/* Restart / save feedback banner */}
      {(saveHandlerMutation.isPending && !hasFastHandler) && (
        <div className="px-4 py-1.5 bg-blue-950/40 border-b border-blue-800/40 text-blue-300 text-xs flex items-center gap-2">
          <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          Saving handler and restarting project...
        </div>
      )}
      {restartMessage && (
        <div className={`px-4 py-1.5 border-b text-xs ${restartMessage.includes("failed") || restartMessage.includes("manually") ? "bg-yellow-950/40 border-yellow-800/40 text-yellow-300" : "bg-emerald-950/40 border-emerald-800/40 text-emerald-300"}`}>
          {restartMessage}
        </div>
      )}

      {/* Content area */}
      <div className={`grid ${hasFastHandler || showGeneration ? "grid-cols-2" : "grid-cols-1"} divide-x divide-gray-800`}>
        {/* Spec editor (always shown) */}
        <div className="flex flex-col">
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800/50">
            <span className={`text-xs font-medium uppercase tracking-wider ${route.specMissing && !specContent ? "text-red-400" : "text-gray-400"}`}>
              Spec: {route.specFile}
              {route.specMissing && !specContent && <span className="ml-2 normal-case font-normal text-red-400/70">(not created yet)</span>}
            </span>
            <div className="flex items-center gap-2">
              {specDirty && (
                <span className="text-xs text-yellow-400">Unsaved</span>
              )}
              {specContent && (
                <DeleteSpecButton
                  projectName={projectName}
                  specFile={route.specFile}
                  onDeleted={() => {
                    setSpecContent("");
                    setSpecDirty(false);
                    queryClient.invalidateQueries({ queryKey: ["routeDetail", projectName, routeIndex] });
                    queryClient.invalidateQueries({ queryKey: ["project", projectName] });
                  }}
                />
              )}
              <button
                onClick={() => saveSpecMutation.mutate()}
                disabled={!specDirty || saveSpecMutation.isPending}
                className="px-2 py-0.5 text-xs bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded transition-colors"
              >
                {saveSpecMutation.isPending ? "Saving..." : "Save Spec"}
              </button>
            </div>
          </div>

          {/* Missing spec — generation panel */}
          {route.specMissing && !specContent ? (
            <div className="flex flex-col flex-1">
              {!generatedSpec && !isGeneratingSpec ? (
                <div className="flex flex-col items-start gap-3 p-4">
                  <p className="text-xs text-gray-400">
                    This spec file doesn't exist yet. Describe what the endpoint should do and generate it with AI, or write it manually below.
                  </p>
                  <div className="flex gap-2 w-full">
                    <input
                      type="text"
                      value={specGenDescription}
                      onChange={(e) => setSpecGenDescription(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && specGenDescription.trim() && startSpecGeneration()}
                      placeholder={`Describe ${route.method} ${route.path}, e.g. "List all products with optional category filter"`}
                      className="flex-1 bg-gray-800 text-gray-300 text-xs rounded-lg px-3 py-2 border border-gray-700 font-mono"
                    />
                    <button
                      onClick={startSpecGeneration}
                      disabled={!specGenDescription.trim()}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-amber-600/20 text-amber-400 hover:bg-amber-600/30 border border-amber-800/50 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                      </svg>
                      Generate
                    </button>
                  </div>
                  <button
                    onClick={() => { setSpecContent("\n"); setSpecDirty(true); }}
                    className="text-xs text-gray-500 hover:text-gray-400 underline underline-offset-2 transition-colors"
                  >
                    Write manually instead
                  </button>
                  {specGenError && (
                    <p className="text-xs text-red-400">{specGenError}</p>
                  )}
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800/50">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-amber-400 uppercase tracking-wider">
                        {isGeneratingSpec ? "Generating Spec..." : "Generated Spec"}
                      </span>
                      {isGeneratingSpec && (
                        <div className="animate-spin w-3 h-3 border-2 border-amber-400 border-t-transparent rounded-full" />
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {isGeneratingSpec && (
                        <button
                          onClick={() => { specAbortRef.current?.abort(); setIsGeneratingSpec(false); }}
                          className="px-2 py-0.5 text-xs text-red-400 hover:bg-red-600/10 rounded transition-colors"
                        >
                          Cancel
                        </button>
                      )}
                      {!isGeneratingSpec && generatedSpec && (
                        <>
                          <button
                            onClick={() => { setGeneratedSpec(""); setSpecGenDescription(""); }}
                            className="px-2 py-0.5 text-xs text-gray-400 hover:bg-gray-700/50 rounded transition-colors"
                          >
                            Discard
                          </button>
                          <button
                            onClick={startSpecGeneration}
                            className="flex items-center gap-1 px-2 py-0.5 text-xs text-amber-400 hover:bg-amber-600/10 rounded transition-colors"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
                            </svg>
                            Retry
                          </button>
                          <button
                            onClick={acceptGeneratedSpec}
                            className="px-2 py-0.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white rounded transition-colors"
                          >
                            Save Spec
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <textarea
                    value={generatedSpec}
                    onChange={(e) => setGeneratedSpec(e.target.value)}
                    className="w-full h-96 bg-transparent text-gray-200 font-mono text-xs p-3 resize-none outline-none leading-relaxed"
                    spellCheck={false}
                    placeholder={isGeneratingSpec ? "Generating spec..." : ""}
                    readOnly={isGeneratingSpec}
                  />
                </>
              )}
            </div>
          ) : (
          <textarea
            value={specContent}
            onChange={(e) => {
              setSpecContent(e.target.value);
              setSpecDirty(true);
            }}
            className="w-full h-96 bg-transparent text-gray-200 font-mono text-xs p-3 resize-none outline-none leading-relaxed"
            spellCheck={false}
          />
          )}
        </div>

        {/* Handler code editor or generation panel */}
        {hasFastHandler && !showGeneration && (
          <div className="flex flex-col">
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800/50">
              <span className="text-xs font-medium text-blue-400 uppercase tracking-wider">
                Fast Handler: {route.toolHandler}
              </span>
              <div className="flex items-center gap-2">
                {!!specContent && <button
                  onClick={startGeneration}
                  className="flex items-center gap-1 px-2 py-0.5 text-xs text-amber-400 hover:bg-amber-600/10 rounded transition-colors"
                  title="Regenerate handler from spec"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
                  </svg>
                  Regenerate
                </button>}
                {handlerDirty && (
                  <span className="text-xs text-yellow-400">Unsaved</span>
                )}
                <button
                  onClick={() =>
                    handlerMeta &&
                    saveHandlerMutation.mutate({
                      code: handlerCode,
                      variableName: handlerMeta.variableName,
                      handlerKey: handlerMeta.handlerKey,
                    })
                  }
                  disabled={!handlerDirty || saveHandlerMutation.isPending || !handlerMeta}
                  className="px-2 py-0.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded transition-colors"
                >
                  {saveHandlerMutation.isPending ? "Saving..." : "Save Handler"}
                </button>
              </div>
            </div>
            <textarea
              value={handlerCode}
              onChange={(e) => {
                setHandlerCode(e.target.value);
                setHandlerDirty(true);
              }}
              className="w-full h-96 bg-transparent text-gray-200 font-mono text-xs p-3 resize-none outline-none leading-relaxed"
              spellCheck={false}
            />
          </div>
        )}

        {/* LLM Generation panel */}
        {showGeneration && (
          <div className="flex flex-col">
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800/50">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-amber-400 uppercase tracking-wider">
                  {isGenerating ? "Generating Fast Handler..." : "Generated Fast Handler"}
                </span>
                {isGenerating && (
                  <div className="animate-spin w-3 h-3 border-2 border-amber-400 border-t-transparent rounded-full" />
                )}
              </div>
              <div className="flex items-center gap-2">
                {isGenerating && (
                  <button
                    onClick={cancelGeneration}
                    className="px-2 py-0.5 text-xs text-red-400 hover:bg-red-600/10 rounded transition-colors"
                  >
                    Cancel
                  </button>
                )}
                {!isGenerating && generatedCode && (
                  <>
                    <button
                      onClick={() => {
                        setGeneratedCode("");
                        setGenerationMeta(null);
                        setGenerationError("");
                      }}
                      className="px-2 py-0.5 text-xs text-gray-400 hover:bg-gray-700/50 rounded transition-colors"
                    >
                      Discard
                    </button>
                    <button
                      onClick={startGeneration}
                      className="flex items-center gap-1 px-2 py-0.5 text-xs text-amber-400 hover:bg-amber-600/10 rounded transition-colors"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
                      </svg>
                      Retry
                    </button>
                    <button
                      onClick={acceptGenerated}
                      disabled={saveHandlerMutation.isPending}
                      className="px-2 py-0.5 text-xs bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded transition-colors"
                    >
                      {saveHandlerMutation.isPending
                        ? route.handlerType === "tool_handler" ? "Saving..." : "Saving & Restarting..."
                        : route.handlerType === "tool_handler"
                          ? "Save Handler"
                          : "Save & Activate"}
                    </button>
                  </>
                )}
              </div>
            </div>
            {generationError && (
              <div className="px-3 py-2 bg-red-950/30 border-b border-red-900/50 text-red-400 text-xs">
                {generationError}
              </div>
            )}
            <textarea
              value={generatedCode}
              onChange={(e) => setGeneratedCode(e.target.value)}
              className="w-full h-96 bg-transparent text-gray-200 font-mono text-xs p-3 resize-none outline-none leading-relaxed"
              spellCheck={false}
              placeholder={isGenerating ? "Generating handler code..." : ""}
              readOnly={isGenerating}
            />
          </div>
        )}
      </div>

      {/* Shared helpers info (collapsed) */}
      {detail.handlerHelpers && (
        <SharedHelpersInfo helpers={detail.handlerHelpers} />
      )}
    </div>
  );
}

function SharedHelpersInfo({ helpers }: { helpers: string }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="border-t border-gray-800/50">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 w-full px-4 py-2 text-xs text-gray-500 hover:text-gray-400 transition-colors"
      >
        <svg
          className={`w-3 h-3 transition-transform ${isOpen ? "rotate-90" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
        Shared helpers from tool-registry.ts
      </button>
      {isOpen && (
        <pre className="px-4 pb-3 text-xs text-gray-500 font-mono whitespace-pre-wrap max-h-48 overflow-auto">
          {helpers}
        </pre>
      )}
    </div>
  );
}

// ─── Add Route Modal ───────────────────────────────────────────────────────────

function AddRouteModal({
  projectName,
  onClose,
  onCreated,
}: {
  projectName: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [method, setMethod] = useState("GET");
  const [routePath, setRoutePath] = useState("/api/");
  const [specFile, setSpecFile] = useState("");
  const [section, setSection] = useState("");
  const [specContent, setSpecContent] = useState("");
  const [description, setDescription] = useState("");
  const [isGeneratingSpec, setIsGeneratingSpec] = useState(false);
  const [generationError, setGenerationError] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const { data: sections } = useQuery({
    queryKey: ["routeSections", projectName],
    queryFn: () => api.getRouteSections(projectName),
  });

  // Auto-suggest spec file from path
  useEffect(() => {
    if (!routePath || routePath === "/api/") {
      setSpecFile("");
      return;
    }
    // Convert /api/users/:id -> users/get.md (for GET), users/create.md (for POST), etc.
    const pathWithoutApi = routePath.replace(/^\/api\//, "");
    const parts = pathWithoutApi.split("/").filter((p) => !p.startsWith(":"));
    const actionMap: Record<string, string> = {
      GET: parts.length > 0 && routePath.includes(":") ? "get" : "list",
      POST: "create",
      PUT: "update",
      PATCH: "update",
      DELETE: "delete",
    };
    const action = actionMap[method] || "handler";

    if (parts.length === 0) {
      setSpecFile("");
    } else if (parts.length === 1) {
      setSpecFile(`${parts[0]}/${action}.md`);
    } else {
      // e.g., /api/projects/:id/tasks -> tasks/list.md
      const lastResource = parts[parts.length - 1];
      setSpecFile(`${lastResource}/${action}.md`);
    }
  }, [routePath, method]);

  // Generate default spec template
  useEffect(() => {
    if (!specContent && !isGeneratingSpec && specFile) {
      const template = `---
route: ${method} ${routePath}
auth: required
---

# ${specFile.replace(/\.md$/, "").split("/").pop()?.replace(/^\w/, (c) => c.toUpperCase()) || "Endpoint"}

## Endpoint
${method} ${routePath}

## Authentication
Required.

## Logic

1. TODO: Describe the business logic

## Response (200)
\`\`\`json
{
  "data": {}
}
\`\`\`
`;
      setSpecContent(template);
    }
  }, [specFile, method, routePath]);

  const addRouteMutation = useMutation({
    mutationFn: () =>
      api.addRoute(projectName, {
        method,
        path: routePath,
        specFile,
        specContent,
        section: section || undefined,
      }),
    onSuccess: () => onCreated(),
  });

  const handleGenerateSpec = useCallback(() => {
    if (!description.trim()) return;
    setIsGeneratingSpec(true);
    setGenerationError("");
    setSpecContent("");

    const controller = streamGenerateSpec(
      projectName,
      { description, method, path: routePath, specFile },
      (text) => {
        setSpecContent((prev) => prev + text);
      },
      () => {
        setIsGeneratingSpec(false);
      },
      (err) => {
        setIsGeneratingSpec(false);
        setGenerationError(err);
      }
    );
    abortRef.current = controller;
  }, [description, method, routePath, specFile, projectName]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-[900px] max-h-[85vh] flex flex-col">
        {/* Modal header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <h2 className="text-lg font-semibold text-white">Add New Route</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-200 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Modal body */}
        <div className="flex-1 overflow-auto p-6 space-y-5">
          {/* Route definition row */}
          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-2">
              <label className="text-xs text-gray-400 mb-1 block">Method</label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="w-full bg-gray-800 text-gray-300 text-sm rounded-lg px-3 py-2 border border-gray-700"
              >
                {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </div>
            <div className="col-span-5">
              <label className="text-xs text-gray-400 mb-1 block">Path</label>
              <input
                type="text"
                value={routePath}
                onChange={(e) => setRoutePath(e.target.value)}
                placeholder="/api/resource/:id"
                className="w-full bg-gray-800 text-gray-300 text-sm rounded-lg px-3 py-2 border border-gray-700 font-mono"
              />
            </div>
            <div className="col-span-3">
              <label className="text-xs text-gray-400 mb-1 block">Spec File</label>
              <input
                type="text"
                value={specFile}
                onChange={(e) => setSpecFile(e.target.value)}
                placeholder="resource/action.md"
                className="w-full bg-gray-800 text-gray-300 text-sm rounded-lg px-3 py-2 border border-gray-700 font-mono"
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-gray-400 mb-1 block">Section</label>
              <select
                value={section}
                onChange={(e) => setSection(e.target.value)}
                className="w-full bg-gray-800 text-gray-300 text-sm rounded-lg px-3 py-2 border border-gray-700"
              >
                <option value="">(end of file)</option>
                {sections?.map((s: string) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>

          {/* LLM spec generation */}
          <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-4">
            <div className="flex items-center gap-2 mb-3">
              <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
              <span className="text-sm font-medium text-gray-300">Generate spec with AI</span>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe what this endpoint does, e.g. 'Create a new user with email and password, hash the password, return the user profile'"
                className="flex-1 bg-gray-900 text-gray-300 text-sm rounded-lg px-3 py-2 border border-gray-700"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleGenerateSpec();
                  }
                }}
              />
              <button
                onClick={handleGenerateSpec}
                disabled={!description.trim() || isGeneratingSpec}
                className="px-4 py-2 text-sm bg-amber-600/20 text-amber-400 hover:bg-amber-600/30 disabled:bg-gray-700 disabled:text-gray-500 border border-amber-800/50 disabled:border-gray-700 rounded-lg transition-colors whitespace-nowrap"
              >
                {isGeneratingSpec ? (
                  <span className="flex items-center gap-1.5">
                    <div className="animate-spin w-3 h-3 border-2 border-amber-400 border-t-transparent rounded-full" />
                    Generating...
                  </span>
                ) : (
                  "Generate"
                )}
              </button>
            </div>
            {generationError && (
              <div className="mt-2 text-xs text-red-400">{generationError}</div>
            )}
          </div>

          {/* Spec content editor */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-gray-400 font-medium uppercase tracking-wider">
                Spec Content
              </label>
              {isGeneratingSpec && (
                <button
                  onClick={() => {
                    abortRef.current?.abort();
                    setIsGeneratingSpec(false);
                  }}
                  className="text-xs text-red-400 hover:text-red-300"
                >
                  Cancel generation
                </button>
              )}
            </div>
            <textarea
              value={specContent}
              onChange={(e) => setSpecContent(e.target.value)}
              className="w-full h-64 bg-gray-800 text-gray-200 font-mono text-xs rounded-lg p-3 border border-gray-700 resize-none outline-none focus:border-indigo-600 leading-relaxed"
              spellCheck={false}
              readOnly={isGeneratingSpec}
              placeholder="Spec content will appear here..."
            />
          </div>
        </div>

        {/* Modal footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-800">
          {addRouteMutation.error && (
            <div className="text-sm text-red-400">
              {(addRouteMutation.error as Error).message}
            </div>
          )}
          <div className="flex items-center gap-3 ml-auto">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => addRouteMutation.mutate()}
              disabled={
                !method ||
                !routePath ||
                !specFile ||
                !specContent ||
                addRouteMutation.isPending ||
                isGeneratingSpec
              }
              className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg transition-colors font-medium"
            >
              {addRouteMutation.isPending ? "Creating..." : "Create Route"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MethodBadge({ method }: { method: string }) {
  const colors: Record<string, string> = {
    GET: "bg-emerald-950/50 text-emerald-400 border-emerald-900/50",
    POST: "bg-blue-950/50 text-blue-400 border-blue-900/50",
    PUT: "bg-yellow-950/50 text-yellow-400 border-yellow-900/50",
    DELETE: "bg-red-950/50 text-red-400 border-red-900/50",
    PATCH: "bg-orange-950/50 text-orange-400 border-orange-900/50",
  };

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold font-mono border ${colors[method] || "bg-gray-800 text-gray-400 border-gray-700"}`}>
      {method}
    </span>
  );
}

// ─── Migrations Tab ────────────────────────────────────────────────────────────

function MigrationsTab({ name, project }: { name: string; project: any }) {
  const queryClient = useQueryClient();
  const [selectedMigration, setSelectedMigration] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newFilename, setNewFilename] = useState("");
  const [newContent, setNewContent] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // LLM generation state
  const [genDescription, setGenDescription] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedSQL, setGeneratedSQL] = useState("");
  const [genError, setGenError] = useState("");
  const genAbortRef = useRef<AbortController | null>(null);

  const { data: migrations } = useQuery({
    queryKey: ["migrations", name],
    queryFn: () => api.getMigrations(name),
  });

  const selected = migrations?.find((m: any) => m.name === selectedMigration);

  // Sync editor when selection changes
  useEffect(() => {
    if (selected) {
      setEditContent(selected.content);
      setIsDirty(false);
    }
  }, [selected?.name]);

  const saveMutation = useMutation({
    mutationFn: () => api.saveMigration(name, selectedMigration!, editContent),
    onSuccess: () => {
      setIsDirty(false);
      queryClient.invalidateQueries({ queryKey: ["migrations", name] });
    },
  });

  const createMutation = useMutation({
    mutationFn: () => {
      const filename = newFilename.endsWith(".sql") ? newFilename : `${newFilename}.sql`;
      return api.createMigration(name, filename, newContent);
    },
    onSuccess: () => {
      const filename = newFilename.endsWith(".sql") ? newFilename : `${newFilename}.sql`;
      setShowNewForm(false);
      setNewFilename("");
      setNewContent("");
      setGeneratedSQL("");
      setGenDescription("");
      queryClient.invalidateQueries({ queryKey: ["migrations", name] });
      setSelectedMigration(filename);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (filename: string) => api.deleteMigration(name, filename),
    onSuccess: () => {
      setDeleteConfirm(null);
      if (selectedMigration === deleteConfirm) {
        setSelectedMigration(null);
        setEditContent("");
        setIsDirty(false);
      }
      queryClient.invalidateQueries({ queryKey: ["migrations", name] });
    },
  });

  const startGeneration = useCallback(() => {
    if (!genDescription.trim()) return;
    setIsGenerating(true);
    setGenError("");
    setGeneratedSQL("");
    const controller = streamGenerateMigration(
      name,
      genDescription,
      (text) => setGeneratedSQL((prev) => prev + text),
      (data) => {
        setIsGenerating(false);
        // Pre-fill filename from LLM suggestion if not already set
        if (data.suggestedFilename && !newFilename) {
          setNewFilename(data.suggestedFilename);
        }
      },
      (err) => { setIsGenerating(false); setGenError(err); }
    );
    genAbortRef.current = controller;
  }, [name, genDescription, newFilename]);

  const acceptGenerated = useCallback(() => {
    // Strip the filename comment line from the SQL before accepting
    const lines = generatedSQL.split("\n");
    const withoutFilenameComment = lines
      .filter((l) => !l.match(/^--\s*filename:/i))
      .join("\n")
      .trimStart();
    setNewContent(withoutFilenameComment);
    setGeneratedSQL("");
  }, [generatedSQL]);

  return (
    <div className="flex gap-4 h-[calc(100vh-280px)]">
      {/* Left sidebar */}
      <div className="w-64 shrink-0 rounded-lg border border-gray-800 bg-gray-900/50 flex flex-col overflow-hidden">
        <div className="p-3 border-b border-gray-800 flex items-center justify-between">
          <h3 className="text-sm font-medium text-gray-300">Migrations</h3>
          <button
            onClick={() => { setShowNewForm(true); setSelectedMigration(null); }}
            className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
            title="New migration file"
          >
            + New
          </button>
        </div>
        <div className="p-2 overflow-auto flex-1">
          {migrations?.map((m: any) => (
            <button
              key={m.name}
              onClick={() => { setSelectedMigration(m.name); setShowNewForm(false); }}
              className={`w-full text-left px-3 py-2 text-xs rounded transition-colors ${
                selectedMigration === m.name
                  ? "bg-indigo-600/20 text-indigo-300"
                  : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"
              }`}
            >
              <span className="font-mono">{m.name}</span>
            </button>
          ))}
          {(!migrations || migrations.length === 0) && (
            <p className="text-gray-500 text-xs p-2">No migrations found</p>
          )}
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 rounded-lg border border-gray-800 bg-gray-900/50 flex flex-col overflow-hidden">
        {showNewForm ? (
          <>
            <div className="p-3 border-b border-gray-800 flex items-center gap-3">
              <span className="text-sm text-gray-300 font-medium">New migration</span>
            </div>
            <div className="p-4 flex flex-col gap-3 flex-1 overflow-auto">
              {/* AI generation row */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={genDescription}
                  onChange={(e) => setGenDescription(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && genDescription.trim() && startGeneration()}
                  placeholder={`Describe the migration, e.g. "create users table with email and role"`}
                  className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-xs text-gray-200 font-mono focus:outline-none focus:border-amber-500"
                />
                <button
                  onClick={startGeneration}
                  disabled={!genDescription.trim() || isGenerating}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-amber-600/20 text-amber-400 hover:bg-amber-600/30 border border-amber-800/50 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
                  </svg>
                  {isGenerating ? "Generating..." : "Generate"}
                </button>
              </div>

              {/* Generation panel */}
              {(isGenerating || generatedSQL) && (
                <div className="rounded-lg border border-amber-800/40 bg-amber-950/10 flex flex-col overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-amber-800/30">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-amber-400 uppercase tracking-wider">
                        {isGenerating ? "Generating..." : "Generated SQL"}
                      </span>
                      {isGenerating && (
                        <div className="animate-spin w-3 h-3 border-2 border-amber-400 border-t-transparent rounded-full" />
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {isGenerating && (
                        <button
                          onClick={() => { genAbortRef.current?.abort(); setIsGenerating(false); }}
                          className="px-2 py-0.5 text-xs text-red-400 hover:bg-red-600/10 rounded transition-colors"
                        >
                          Cancel
                        </button>
                      )}
                      {!isGenerating && generatedSQL && (
                        <>
                          <button
                            onClick={() => setGeneratedSQL("")}
                            className="px-2 py-0.5 text-xs text-gray-400 hover:bg-gray-700/50 rounded transition-colors"
                          >
                            Discard
                          </button>
                          <button
                            onClick={startGeneration}
                            className="flex items-center gap-1 px-2 py-0.5 text-xs text-amber-400 hover:bg-amber-600/10 rounded transition-colors"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                            </svg>
                            Retry
                          </button>
                          <button
                            onClick={acceptGenerated}
                            className="px-2 py-0.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white rounded transition-colors"
                          >
                            Use SQL
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <textarea
                    value={generatedSQL}
                    onChange={(e) => setGeneratedSQL(e.target.value)}
                    className="w-full h-40 bg-transparent text-gray-200 font-mono text-xs p-3 resize-none outline-none leading-relaxed"
                    spellCheck={false}
                  />
                  {genError && (
                    <div className="mx-3 mb-2 p-2 rounded bg-red-950/40 border border-red-800/50 text-xs text-red-400">{genError}</div>
                  )}
                </div>
              )}

              <div>
                <label className="block text-xs text-gray-400 mb-1">Filename</label>
                <input
                  type="text"
                  value={newFilename}
                  onChange={(e) => setNewFilename(e.target.value)}
                  placeholder="e.g. 001_create_users.sql"
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 font-mono focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div className="flex-1 flex flex-col">
                <label className="block text-xs text-gray-400 mb-1">SQL content</label>
                <textarea
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  placeholder="-- SQL here"
                  className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 font-mono resize-none focus:outline-none focus:border-indigo-500 min-h-40"
                  spellCheck={false}
                />
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => createMutation.mutate()}
                  disabled={!newFilename.trim() || createMutation.isPending}
                  className="px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded transition-colors"
                >
                  {createMutation.isPending ? "Creating..." : "Create"}
                </button>
                <button
                  onClick={() => {
                    setShowNewForm(false);
                    setNewFilename("");
                    setNewContent("");
                    setGeneratedSQL("");
                    setGenDescription("");
                    genAbortRef.current?.abort();
                  }}
                  className="px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200 transition-colors"
                >
                  Cancel
                </button>
                {createMutation.isError && (
                  <span className="text-xs text-red-400">{(createMutation.error as Error).message}</span>
                )}
              </div>
            </div>
          </>
        ) : selected ? (
          <>
            <div className="p-3 border-b border-gray-800 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm text-gray-300 font-mono truncate">{selected.name}</span>
                {isDirty && <span className="text-xs text-yellow-400 shrink-0">unsaved</span>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => saveMutation.mutate()}
                  disabled={!isDirty || saveMutation.isPending}
                  className="px-2 py-0.5 text-xs bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded transition-colors"
                >
                  {saveMutation.isPending ? "Saving..." : "Save"}
                </button>
                {deleteConfirm === selected.name ? (
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-red-400">Delete?</span>
                    <button
                      onClick={() => deleteMutation.mutate(selected.name)}
                      disabled={deleteMutation.isPending}
                      className="px-2 py-0.5 text-xs bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white rounded transition-colors"
                    >
                      {deleteMutation.isPending ? "Deleting..." : "Yes, delete"}
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(null)}
                      disabled={deleteMutation.isPending}
                      className="px-2 py-0.5 text-xs text-gray-400 hover:bg-gray-700/50 rounded transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setDeleteConfirm(selected.name)}
                    className="px-2 py-0.5 text-xs text-gray-500 hover:text-red-400 hover:bg-red-950/30 rounded transition-colors"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
            <textarea
              value={editContent}
              onChange={(e) => { setEditContent(e.target.value); setIsDirty(true); }}
              className="flex-1 bg-transparent p-4 text-sm text-gray-200 font-mono resize-none focus:outline-none"
              spellCheck={false}
            />
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            Select a migration to edit, or create a new one
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Logs Tab ──────────────────────────────────────────────────────────────────

function LogsTab({ name }: { name: string }) {
  const [logs, setLogs] = useState<string[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsubscribe = streamLogs(name, (line) => {
      setLogs((prev) => [...prev.slice(-4999), line]);
    });
    return unsubscribe;
  }, [name]);

  useEffect(() => {
    if (autoScroll) {
      logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll]);

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/50 h-[calc(100vh-280px)] flex flex-col">
      <div className="flex items-center justify-between p-3 border-b border-gray-800">
        <h3 className="text-sm font-medium text-gray-300">
          Live Logs ({logs.length} lines)
        </h3>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="rounded bg-gray-800 border-gray-700"
            />
            Auto-scroll
          </label>
          <button
            onClick={() => setLogs([])}
            className="text-xs text-gray-400 hover:text-gray-200"
          >
            Clear
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-4 font-mono text-xs">
        {logs.length === 0 ? (
          <p className="text-gray-500">No logs yet. Start the project to see output.</p>
        ) : (
          logs.map((line, i) => (
            <div key={i} className="text-gray-300 py-0.5 leading-5 whitespace-pre-wrap break-all">
              {line}
            </div>
          ))
        )}
        <div ref={logsEndRef} />
      </div>
    </div>
  );
}

// ─── API Test Tab ──────────────────────────────────────────────────────────────

// Variable names we track automatically
type VarStore = {
  token: string;
  userId: string;
  projectId: string;
  taskId: string;
};

const EMPTY_VARS: VarStore = { token: "", userId: "", projectId: "", taskId: "" };

// Substitute {{varName}} placeholders in a string using the variable store
function substituteVars(text: string, vars: VarStore): string {
  return text
    .replace(/\{\{token\}\}/g, vars.token)
    .replace(/\{\{userId\}\}/g, vars.userId)
    .replace(/\{\{projectId\}\}/g, vars.projectId)
    .replace(/\{\{taskId\}\}/g, vars.taskId);
}

// Build the default path for a route, replacing Express-style params with {{var}} placeholders
function buildDefaultPath(routePath: string): string {
  return routePath
    .replace(/:project_id/g, "{{projectId}}")
    .replace(/:id\b/g, (_, offset, str) => {
      // Guess which ID based on surrounding path context
      const before = str.slice(0, offset);
      if (/\/tasks\//.test(before) || /\/tasks$/.test(before)) return "{{taskId}}";
      if (/\/projects\//.test(before)) return "{{projectId}}";
      return "{{projectId}}";
    });
}

// Map of specFile → default request body with realistic sample values
// Derived from reading the spec files
const SPEC_DEFAULT_BODIES: Record<string, Record<string, unknown>> = {
  "auth/register.md": {
    email: "alice@example.com",
    name: "Alice",
    password: "password123",
  },
  "auth/login.md": {
    email: "alice@example.com",
    password: "password123",
  },
  "projects/create.md": {
    name: "Alpha Project",
    description: "My first project",
  },
  "projects/update.md": {
    name: "Alpha Project (updated)",
    description: "Updated description",
  },
  "tasks/create.md": {
    title: "Build the UI",
    description: "Create all frontend components",
    priority: "high",
  },
  "tasks/update.md": {
    status: "in_progress",
  },
};

// Determine if a route requires auth based on spec content keywords
function specRequiresAuth(specContent: string): boolean {
  // Check frontmatter `auth: none` → no auth
  if (/^auth:\s*none/m.test(specContent)) return false;
  if (/^auth:\s*required/m.test(specContent)) return true;
  // Fallback: look for "Authentication" section saying "Required"
  return /##\s+Authentication[\s\S]*?Required/i.test(specContent);
}

// Try to extract a JSON request body template from the spec markdown
// Looks for a JSON block under ## Input or ## Request
function extractBodyFromSpec(specContent: string, specFile: string): Record<string, unknown> | null {
  // First use our hardcoded samples (most accurate)
  const known = SPEC_DEFAULT_BODIES[specFile];
  if (known) return known;

  // Fallback: parse field list from "## Input" or "## Request Body" section
  const inputSection = specContent.match(/##\s+Input([\s\S]*?)(?=\n##|\n---|\n```|$)/i)?.[1] ?? "";
  const fields: Record<string, unknown> = {};
  const fieldPattern = /[-*]\s+`(\w+)`\s+\([^)]*(?:required)/gi;
  let match;
  while ((match = fieldPattern.exec(inputSection)) !== null) {
    const fieldName = match[1];
    // Apply sensible sample values by field name
    if (fieldName === "email") fields[fieldName] = "user@example.com";
    else if (fieldName === "password") fields[fieldName] = "password123";
    else if (fieldName === "name") fields[fieldName] = "Sample Name";
    else if (fieldName === "title") fields[fieldName] = "Sample Task";
    else if (fieldName === "description") fields[fieldName] = "Description here";
    else if (fieldName === "priority") fields[fieldName] = "medium";
    else if (fieldName === "status") fields[fieldName] = "todo";
    else fields[fieldName] = "";
  }
  return Object.keys(fields).length > 0 ? fields : null;
}

// Detect which variables a response body captures
function detectCaptures(
  responseBody: unknown,
  routeMethod: string,
  routePath: string
): Partial<VarStore> {
  if (!responseBody || typeof responseBody !== "object") return {};
  const data = (responseBody as any).data ?? responseBody;
  const captured: Partial<VarStore> = {};

  // Token from login/register
  if (typeof data?.token === "string" && data.token) {
    captured.token = data.token;
  }
  // userId from register response
  if (typeof data?.user?.id === "string" && data.user.id) {
    captured.userId = data.user.id;
  }
  // projectId from POST /projects
  if (routeMethod === "POST" && /^\/api\/projects\/?$/.test(routePath) && typeof data?.id === "string") {
    captured.projectId = data.id;
  }
  // taskId from POST /tasks
  if (routeMethod === "POST" && /\/tasks\/?$/.test(routePath) && typeof data?.id === "string") {
    captured.taskId = data.id;
  }
  return captured;
}

function ApiTestTab({ name, project, status }: { name: string; project: any; status: any }) {
  const routes: any[] = project.routes || [];

  // ── Variable store ─────────────────────────────────────────────────────────
  const [vars, setVars] = useState<VarStore>(EMPTY_VARS);

  // ── Selected route & editable request fields ───────────────────────────────
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [editMethod, setEditMethod] = useState("GET");
  const [editPath, setEditPath] = useState("");
  const [editHeaders, setEditHeaders] = useState("{}");
  const [editBody, setEditBody] = useState("");
  const [loadingPreset, setLoadingPreset] = useState(false);

  // ── Response state ─────────────────────────────────────────────────────────
  const [response, setResponse] = useState<any>(null);
  const [lastCaptures, setLastCaptures] = useState<string[]>([]);

  // ── Load preset when a route is selected ──────────────────────────────────
  const loadPreset = useCallback(async (index: number) => {
    const route = routes[index];
    if (!route) return;

    setSelectedIndex(index);
    setEditMethod(route.method);
    setEditPath(buildDefaultPath(route.path));
    setResponse(null);
    setLastCaptures([]);
    setLoadingPreset(true);

    // Fetch spec to determine auth requirement and body template
    try {
      const specData = await api.getSpec(name, route.specFile);
      const specContent: string = specData?.content ?? "";
      const needsAuth = specRequiresAuth(specContent);

      // Build headers
      const hdrs: Record<string, string> = {};
      if (needsAuth) hdrs["Authorization"] = "Bearer {{token}}";
      setEditHeaders(JSON.stringify(hdrs, null, 2));

      // Build body for mutation methods
      if (!["GET", "HEAD"].includes(route.method)) {
        const bodyTemplate = extractBodyFromSpec(specContent, route.specFile);
        setEditBody(bodyTemplate ? JSON.stringify(bodyTemplate, null, 2) : "");
      } else {
        setEditBody("");
      }
    } catch {
      // Fallback if spec fetch fails
      setEditHeaders("{}");
      setEditBody("");
    } finally {
      setLoadingPreset(false);
    }
  }, [routes, name]);

  // ── Send request ───────────────────────────────────────────────────────────
  const testMutation = useMutation({
    mutationFn: () => {
      const resolvedPath = substituteVars(editPath, vars);
      const resolvedHeaderStr = substituteVars(editHeaders, vars);
      const resolvedBodyStr = substituteVars(editBody, vars);

      let parsedHeaders: Record<string, string> = {};
      let parsedBody: unknown = undefined;
      try { parsedHeaders = JSON.parse(resolvedHeaderStr); } catch { /* ignore */ }
      try { if (resolvedBodyStr.trim()) parsedBody = JSON.parse(resolvedBodyStr); } catch { /* ignore */ }

      return api.testEndpoint(name, {
        method: editMethod,
        path: resolvedPath,
        headers: parsedHeaders,
        body: parsedBody,
      });
    },
    onSuccess: (data) => {
      setResponse(data);
      // Auto-capture variables from response
      const caps = detectCaptures(data.body, editMethod, substituteVars(editPath, vars));
      if (Object.keys(caps).length > 0) {
        setVars((prev) => ({ ...prev, ...caps }));
        setLastCaptures(Object.keys(caps));
      } else {
        setLastCaptures([]);
      }
    },
  });

  // ── Group routes by section heuristic (path prefix) ───────────────────────
  const groupedRoutes = (() => {
    const groups: { label: string; routes: { route: any; index: number }[] }[] = [];
    let currentGroup: { label: string; routes: { route: any; index: number }[] } | null = null;

    routes.forEach((route, index) => {
      // Derive group label from second path segment: /api/auth/* → "Auth"
      const segments = route.path.split("/").filter(Boolean);
      const groupKey = segments[1] ?? "Other";
      const groupLabel = groupKey.charAt(0).toUpperCase() + groupKey.slice(1);

      if (!currentGroup || currentGroup.label !== groupLabel) {
        currentGroup = { label: groupLabel, routes: [] };
        groups.push(currentGroup);
      }
      currentGroup.routes.push({ route, index });
    });

    return groups;
  })();

  // ── Resolve display path (substitute vars for preview) ────────────────────
  const displayPath = substituteVars(editPath, vars);
  const hasUnresolved = editPath.includes("{{") && displayPath.includes("{{");

  // ── Variable pills ─────────────────────────────────────────────────────────
  const varEntries: { key: keyof VarStore; label: string }[] = [
    { key: "token", label: "token" },
    { key: "userId", label: "userId" },
    { key: "projectId", label: "projectId" },
    { key: "taskId", label: "taskId" },
  ];

  return (
    <div className="flex flex-col gap-3 h-[calc(100vh-280px)]">
      {/* ── Variable bar ───────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-800 bg-gray-900/50">
        <span className="text-xs text-gray-500 shrink-0">Variables:</span>
        <div className="flex items-center gap-1.5 flex-1 flex-wrap">
          {varEntries.map(({ key, label }) => {
            const hasValue = !!vars[key];
            return (
              <span
                key={key}
                title={hasValue ? vars[key] : "Not captured yet"}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-mono border cursor-default select-none ${
                  hasValue
                    ? "bg-emerald-950/40 text-emerald-400 border-emerald-800/50"
                    : "bg-gray-800/50 text-gray-600 border-gray-700/50"
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${hasValue ? "bg-emerald-400" : "bg-gray-600"}`} />
                {label}
                {hasValue && (
                  <span className="text-emerald-600 max-w-[80px] truncate">
                    ={vars[key].length > 12 ? `${vars[key].slice(0, 12)}…` : vars[key]}
                  </span>
                )}
              </span>
            );
          })}
        </div>
        {Object.values(vars).some(Boolean) && (
          <button
            onClick={() => { setVars(EMPTY_VARS); setLastCaptures([]); }}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors shrink-0"
          >
            Clear
          </button>
        )}
      </div>

      {/* ── Main layout: route list | request editor | response ──────────── */}
      <div className="flex gap-3 flex-1 min-h-0">

        {/* Route list */}
        <div className="w-52 shrink-0 rounded-lg border border-gray-800 bg-gray-900/50 flex flex-col overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-800">
            <span className="text-xs font-medium text-gray-400">Routes</span>
          </div>
          <div className="flex-1 overflow-auto py-1">
            {groupedRoutes.map((group) => (
              <div key={group.label}>
                <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  {group.label}
                </div>
                {group.routes.map(({ route, index }) => (
                  <button
                    key={index}
                    onClick={() => loadPreset(index)}
                    className={`w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs transition-colors ${
                      selectedIndex === index
                        ? "bg-indigo-600/20 text-indigo-300"
                        : "text-gray-400 hover:bg-gray-800/60 hover:text-gray-200"
                    }`}
                  >
                    <MethodBadge method={route.method} />
                    <span className="font-mono truncate text-[11px]">{route.path.replace("/api", "")}</span>
                  </button>
                ))}
              </div>
            ))}
            {routes.length === 0 && (
              <p className="text-gray-600 text-xs p-3">No routes defined</p>
            )}
          </div>
        </div>

        {/* Request + Response columns */}
        <div className="flex-1 grid grid-cols-2 gap-3 min-h-0">

          {/* Request editor */}
          <div className="rounded-lg border border-gray-800 bg-gray-900/50 flex flex-col overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-800 flex items-center justify-between">
              <span className="text-xs font-medium text-gray-400">Request</span>
              {loadingPreset && (
                <div className="animate-spin w-3 h-3 border border-indigo-500 border-t-transparent rounded-full" />
              )}
            </div>

            <div className="p-3 space-y-3 flex-1 overflow-auto">
              {/* Method + Path */}
              <div className="flex gap-2">
                <select
                  value={editMethod}
                  onChange={(e) => setEditMethod(e.target.value)}
                  className="bg-gray-800 text-gray-300 text-sm rounded-lg px-2 py-1.5 border border-gray-700"
                >
                  {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
                <input
                  type="text"
                  value={editPath}
                  onChange={(e) => setEditPath(e.target.value)}
                  placeholder="/api/..."
                  className={`flex-1 bg-gray-800 text-gray-300 text-xs rounded-lg px-3 py-1.5 border font-mono ${
                    hasUnresolved ? "border-yellow-700/60" : "border-gray-700"
                  }`}
                />
              </div>
              {hasUnresolved && (
                <p className="text-xs text-yellow-500">
                  Unresolved variables in path — send a request that captures the required IDs first.
                </p>
              )}

              {/* Headers */}
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Headers</label>
                <textarea
                  value={editHeaders}
                  onChange={(e) => setEditHeaders(e.target.value)}
                  className="w-full bg-gray-800 text-gray-300 text-xs rounded-lg px-3 py-2 border border-gray-700 font-mono resize-none"
                  style={{ height: "72px" }}
                  spellCheck={false}
                />
              </div>

              {/* Body */}
              {!["GET", "HEAD"].includes(editMethod) && (
                <div className="flex-1 flex flex-col">
                  <label className="text-xs text-gray-500 mb-1 block">Body (JSON)</label>
                  <textarea
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    className="w-full bg-gray-800 text-gray-300 text-xs rounded-lg px-3 py-2 border border-gray-700 font-mono resize-none flex-1"
                    style={{ minHeight: "120px" }}
                    spellCheck={false}
                    placeholder="{}"
                  />
                </div>
              )}
            </div>

            <div className="p-3 border-t border-gray-800">
              <button
                onClick={() => testMutation.mutate()}
                disabled={!status?.running || testMutation.isPending || !editPath}
                className="w-full px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg transition-colors font-medium"
              >
                {!status?.running
                  ? "Start project first"
                  : testMutation.isPending
                    ? "Sending..."
                    : "Send Request"}
              </button>
            </div>
          </div>

          {/* Response */}
          <div className="rounded-lg border border-gray-800 bg-gray-900/50 flex flex-col overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-800 flex items-center justify-between">
              <span className="text-xs font-medium text-gray-400">Response</span>
              {response && (
                <div className="flex items-center gap-2 text-xs">
                  <StatusCode code={response.status} />
                  <span className="text-gray-500">{response.duration}ms</span>
                  {response.executionMode === "handler" ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-950/50 border border-sky-700/50 text-sky-300 font-medium">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                      </svg>
                      Fast handler
                    </span>
                  ) : response.executionMode === "llm" ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-950/50 border border-violet-700/50 text-violet-300 font-medium">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                      </svg>
                      LLM
                    </span>
                  ) : null}
                  {response.executionMode === "llm" && response.tokenInput !== null && (
                    <span className="text-gray-500 font-mono">
                      {(response.tokenInput + response.tokenOutput).toLocaleString()} tok
                      <span className="text-gray-600 ml-1">({response.tokenInput.toLocaleString()}↑ {response.tokenOutput.toLocaleString()}↓)</span>
                    </span>
                  )}
                  {response.executionMode === "handler" && (
                    <span className="text-gray-600 font-mono">0 tok</span>
                  )}
                  {lastCaptures.length > 0 && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-950/40 border border-emerald-800/50 text-emerald-400">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                      Captured: {lastCaptures.join(", ")}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="flex-1 overflow-auto p-3">
              {testMutation.isPending ? (
                <div className="flex items-center gap-2 text-gray-500 text-xs p-1">
                  <div className="animate-spin w-3 h-3 border border-indigo-500 border-t-transparent rounded-full" />
                  Waiting for response...
                </div>
              ) : response ? (
                <pre className="text-xs text-gray-200 font-mono whitespace-pre-wrap leading-relaxed">
                  {JSON.stringify(response.body, null, 2)}
                </pre>
              ) : (
                <div className="flex items-center justify-center h-full text-gray-600 text-xs text-center px-4">
                  {selectedIndex !== null
                    ? "Click Send Request to test this route"
                    : "Select a route on the left to get started"}
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

function StatusCode({ code }: { code: number }) {
  const color = code >= 200 && code < 300
    ? "text-emerald-400"
    : code >= 400
      ? "text-red-400"
      : "text-yellow-400";

  return <span className={`font-mono font-bold ${color}`}>{code}</span>;
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
