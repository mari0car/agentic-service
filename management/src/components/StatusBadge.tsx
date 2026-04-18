export default function StatusBadge({
  running,
  health,
}: {
  running?: boolean;
  health?: string;
}) {
  if (!running) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-800 text-gray-400">
        <span className="w-1.5 h-1.5 rounded-full bg-gray-500" />
        Stopped
      </span>
    );
  }

  if (health === "healthy") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-950/50 text-emerald-400 border border-emerald-900/50">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        Running
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-950/50 text-yellow-400 border border-yellow-900/50">
      <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
      Starting
    </span>
  );
}
