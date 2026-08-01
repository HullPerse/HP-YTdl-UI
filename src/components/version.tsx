import { useQuery } from "@tanstack/react-query";

interface AppVersionInfo {
  current: string;
  latest: string | null;
  release_url: string | null;
  update_available: boolean;
}

function AppVersionBadge() {
  const { data } = useQuery<AppVersionInfo>({
    queryKey: ["app-version"],
    queryFn: () => fetch("/api/app/version").then((r) => r.json()),
    staleTime: 60_000,
  });

  if (!data) return null;

  if (data.update_available && data.latest && data.release_url) {
    return (
      <a
        href={data.release_url}
        target="_blank"
        rel="noreferrer"
        className="text-xs text-error hover:underline shrink-0"
        title={`Update available: v${data.latest}`}
      >
        Update: v{data.latest}
      </a>
    );
  }

  return (
    <span className="text-xs text-muted shrink-0" title="App version">
      v{data.current}
    </span>
  );
}

export default AppVersionBadge;
