import { BackendLiveClient } from "./backend-live-client";

export default async function LivePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <BackendLiveClient id={id} />;
}
