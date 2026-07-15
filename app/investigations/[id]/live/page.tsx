import { LiveClient } from "./live-client";

export default async function LivePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <LiveClient id={id} />;
}
