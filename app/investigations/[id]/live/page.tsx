import { LiveClient } from "./live-client";
import { BackendLiveClient } from "./backend-live-client";
import { isBackendInvestigationId } from "@/lib/api/investigation-client";

export default async function LivePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (isBackendInvestigationId(id)) return <BackendLiveClient id={id} />;
  return <LiveClient id={id} />;
}
