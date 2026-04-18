import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import StatusBadge from "../components/StatusBadge";

export default function Dashboard() {
  const { data: projects, isLoading, error } = useQuery({
    queryKey: ["projects"],
    queryFn: api.listProjects,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-900/50 bg-red-950/30 p-6">
        <h3 className="text-red-400 font-medium">Failed to load projects</h3>
        <p className="text-red-400/70 text-sm mt-1">{(error as Error).message}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Projects</h1>
          <p className="text-gray-400 mt-1">
            Manage your Agentic Service projects
          </p>
        </div>
        <Link
          to="/create"
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          + Create Project
        </Link>
      </div>

      {!projects || projects.length === 0 ? (
        <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-12 text-center">
          <div className="w-12 h-12 rounded-full bg-gray-800 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
            </svg>
          </div>
          <h3 className="text-gray-300 font-medium">No projects yet</h3>
          <p className="text-gray-500 text-sm mt-1">
            Create your first Agentic Service project to get started
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((project: any) => (
            <ProjectCard key={project.name} project={project} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectCard({ project }: { project: any }) {
  const { data: status } = useQuery({
    queryKey: ["status", project.name],
    queryFn: () => api.getStatus(project.name),
    refetchInterval: 5000,
  });

  const routeCount = project.routes?.length || 0;
  const llmRoutes = project.routes?.filter(
    (r: any) => r.handlerType === "llm"
  ).length || 0;
  const handlerRoutes = routeCount - llmRoutes;

  return (
    <Link
      to={`/projects/${project.name}`}
      className="group rounded-lg border border-gray-800 bg-gray-900/50 p-5 hover:border-gray-700 hover:bg-gray-900/80 transition-all"
    >
      <div className="flex items-start justify-between mb-3">
        <h3 className="text-white font-semibold group-hover:text-indigo-400 transition-colors">
          {project.name}
        </h3>
        <StatusBadge running={status?.running} health={status?.health} />
      </div>

      {project.description && (
        <p className="text-gray-400 text-sm mb-4 line-clamp-2">
          {project.description}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 text-xs">
        <InfoItem label="Routes" value={`${routeCount} total`} />
        <InfoItem
          label="Handlers"
          value={`${handlerRoutes} fast / ${llmRoutes} LLM`}
        />
        <InfoItem
          label="Database"
          value={project.config?.database?.driver || "none"}
        />
        <InfoItem
          label="Port"
          value={project.config?.server?.port || "8080"}
        />
      </div>

      {project.config?.llm && (
        <div className="mt-3 pt-3 border-t border-gray-800">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
            </svg>
            <span className="truncate">
              {project.config.llm.provider} / {project.config.llm.model}
            </span>
          </div>
        </div>
      )}
    </Link>
  );
}

function InfoItem({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <span className="text-gray-500">{label}</span>
      <span className="ml-1.5 text-gray-300">{value}</span>
    </div>
  );
}
