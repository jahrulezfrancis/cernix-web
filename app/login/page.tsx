import { Suspense } from "react";
import { LoginClient } from "./login-client";

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-[#0D2436] text-sm text-[#86ADC2]">Loading…</div>}>
      <LoginClient />
    </Suspense>
  );
}
