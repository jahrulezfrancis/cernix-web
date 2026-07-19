import { ClaimsClient } from "./claims-client";
import { BackendClaimsClient } from "./backend-claims-client";
import { isBackendInvestigationId } from "@/lib/api/investigation-client";

export default async function ClaimsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (isBackendInvestigationId(id)) return <BackendClaimsClient id={id} />;
  return <ClaimsClient id={id} />;
}
