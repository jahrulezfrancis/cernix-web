import Link from "next/link";
import {
  CheckCircle,
  CircleDashed,
  GitCommitHorizontal,
  ArrowRight,
  ShieldAlert,
} from "lucide-react";

export function Hero() {
  return (
    <section className="border-b border-[#1E4560] px-6 py-16 md:px-12 lg:py-20">
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
          <div>
            <p className="mb-4 font-mono text-xs uppercase tracking-widest text-[#FF6B1A]">
              Technical verification infrastructure
            </p>
            <h1 className="text-balance text-3xl font-semibold leading-tight tracking-tight text-[#E9F3F8] md:text-4xl">
              Verify the build behind the claim.
            </h1>
            <p className="mt-5 text-base leading-relaxed text-[#86ADC2]">
              Cernix investigates one technical claim against a public GitHub
              repository at an exact commit. Durable workers snapshot the repo,
              plan with Qwen, retrieve admitted evidence, challenge weak
              conclusions, and produce a traceable report.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/investigations/new"
                className="inline-flex items-center gap-2 rounded-lg bg-[#FF6B1A] px-4 py-2 text-sm font-medium text-[#0B1E2E] transition-colors hover:bg-[#FF8540]"
              >
                Investigate a project
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
              <Link
                href="/sample-report"
                className="inline-flex items-center gap-2 rounded-lg border border-[#1E4560] bg-[#123049] px-4 py-2 text-sm font-medium text-[#E9F3F8] transition-colors hover:border-[#FF6B1A]/50 hover:bg-[#1E4560]"
              >
                View sample report
              </Link>
            </div>
            <p className="mt-4 text-xs text-[#4F7590]">
              The sample report is illustrative static data, not a live investigation.
            </p>
          </div>

          <EvidenceCasePreview />
        </div>
      </div>
    </section>
  );
}

function EvidenceCasePreview() {
  return (
    <div className="rounded-lg border border-[#1E4560] bg-[#123049] text-sm">
      <div className="flex items-center justify-between border-b border-[#1E4560] px-4 py-2.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-[#4F7590]">
          Illustrative evidence case
        </span>
        <span className="flex items-center gap-1.5 font-mono text-[10px] text-[#4FBF9A]">
          <CheckCircle className="h-3 w-3" aria-hidden />
          Partially verified
        </span>
      </div>

      <div className="border-b border-[#1E4560] px-4 py-3">
        <p className="mb-0.5 font-mono text-[10px] uppercase tracking-wider text-[#4F7590]">
          Claim
        </p>
        <p className="text-sm text-[#E9F3F8]">
          The service validates payment signatures using Ed25519.
        </p>
        <p className="mt-1.5 text-xs text-[#86ADC2]">
          User-defined claim reviewed before the automated investigation begins.
        </p>
      </div>

      <div className="border-b border-[#1E4560] bg-[#082031] px-4 py-3">
        <div className="mb-2 flex items-center gap-2">
          <span className="font-mono text-[10px] text-[#4F7590]">
            src/payments/validator.ts
          </span>
          <span className="font-mono text-[10px] text-[#4F7590]">L42–67</span>
        </div>
        <pre className="overflow-x-auto font-mono text-[11px] leading-5 text-[#BFE0EC]">
          <code>{`export class PaymentValidator {
  async verify(payload, signature) {
    const valid = verify(message, sig, publicKey);
    if (!valid) throw new SignatureError();
    return true;
  }
}`}</code>
        </pre>
      </div>

      <div className="border-b border-[#1E4560] px-4 py-3">
        <div className="flex items-start gap-2">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#FFC94D]" aria-hidden />
          <div>
            <p className="font-mono text-[10px] text-[#FFC94D]">
              Skeptic · challenge resolved
            </p>
            <p className="mt-0.5 text-xs text-[#86ADC2]">
              Validator is applied at the middleware layer, not left to individual
              handlers. Confirmed via auth.ts L88–102.
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 px-4 py-2.5">
        <span className="flex items-center gap-1 font-mono text-[10px] text-[#4F7590]">
          <GitCommitHorizontal className="h-3 w-3" aria-hidden />
          a84c9f1
        </span>
        <span className="font-mono text-[10px] text-[#4F7590]">
          acme/stellar-service
        </span>
        <span className="ml-auto flex items-center gap-1 font-mono text-[10px] text-[#4FBF9A]">
          <CircleDashed className="h-3 w-3" aria-hidden />4 evidence items
        </span>
      </div>
    </div>
  );
}
