import { ClaimsClient } from "./claims-client";

export default async function ClaimsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ClaimsClient id={id} />;
}
