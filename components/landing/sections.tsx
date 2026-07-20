import Link from "next/link";
import {
  ArrowRight,
  GitFork,
  Search,
  FileText,
  CircleDashed,
  XCircle,
  Users,
  ShieldAlert,
  Scale,
  Camera,
  ListTree,
  Microscope,
} from "lucide-react";

export function ProblemSection() {
  const types = [
    "Grant applications",
    "Milestone reports",
    "Hackathon submissions",
    "Technical due diligence",
    "Project documentation",
  ];
  return (
    <section className="border-b border-[#1E4560] px-6 py-14 md:px-12">
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-[#4F7590]">
              The problem
            </p>
            <h2 className="text-balance text-2xl font-semibold text-[#E9F3F8]">
              Technical claims are difficult to verify manually.
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-[#86ADC2]">
              Reviewers reading project descriptions, grant applications, and
              milestone reports must take technical claims at face value.
              Manually tracing a claim through source code requires expert time
              and still leaves gaps.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-[#86ADC2]">
              Cernix automates investigation over admitted repository evidence
              and makes conclusions traceable, challengeable, and auditable.
            </p>
          </div>
          <div className="flex flex-col justify-center gap-2">
            {types.map((t) => (
              <div
                key={t}
                className="flex items-center gap-3 rounded-lg border border-[#1E4560] bg-[#123049] px-3 py-2.5"
              >
                <FileText className="h-4 w-4 shrink-0 text-[#4F7590]" aria-hidden />
                <span className="text-sm text-[#86ADC2]">{t}</span>
                <XCircle className="ml-auto h-4 w-4 shrink-0 text-[#F2796B]/60" aria-label="Difficult to verify" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export function WorkflowSection() {
  const steps = [
    {
      num: "01",
      icon: GitFork,
      title: "Submit repository + claim",
      description:
        "Provide a public GitHub URL and one focus claim to verify. Add submission context so reviewers understand what is being asserted.",
    },
    {
      num: "02",
      icon: Search,
      title: "Approve and investigate",
      description:
        "Review the claim wording, approve it, and start the investigation. Five durable workers snapshot the repo and run the agent pipeline.",
    },
    {
      num: "03",
      icon: FileText,
      title: "Inspect the evidence",
      description:
        "Every verdict links to specific files and lines from an immutable snapshot. Limitations and skeptic challenges are shown explicitly.",
    },
  ];

  return (
    <section className="border-b border-[#1E4560] px-6 py-14 md:px-12">
      <div className="mx-auto max-w-6xl">
        <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-[#4F7590]">
          How it works
        </p>
        <h2 className="mb-10 text-balance text-2xl font-semibold text-[#E9F3F8]">
          From claim to evidence-backed report.
        </h2>
        <div className="grid gap-6 md:grid-cols-3">
          {steps.map((step) => {
            const Icon = step.icon;
            return (
              <div
                key={step.num}
                className="rounded-lg border border-[#1E4560] bg-[#123049] p-5"
              >
                <div className="mb-4 flex items-center gap-3">
                  <span className="font-mono text-xs text-[#FF6B1A]">
                    {step.num}
                  </span>
                  <Icon className="h-4 w-4 text-[#FF6B1A]" aria-hidden />
                </div>
                <h3 className="mb-2 text-sm font-semibold text-[#E9F3F8]">
                  {step.title}
                </h3>
                <p className="text-xs leading-relaxed text-[#86ADC2]">
                  {step.description}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function ExampleClaimSection() {
  return (
    <section className="border-b border-[#1E4560] px-6 py-14 md:px-12">
      <div className="mx-auto max-w-6xl">
        <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-[#4F7590]">
          Example
        </p>
        <h2 className="mb-8 text-balance text-2xl font-semibold text-[#E9F3F8]">
          Claim to evidence in one case.
        </h2>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-lg border border-[#1E4560] bg-[#123049] p-4">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-[#4F7590]">
              User claim
            </p>
            <p className="text-sm italic text-[#E9F3F8]">
              &ldquo;Refund operations are idempotent per transaction and user.&rdquo;
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <span className="rounded-lg border border-[#1E4560] bg-[#1E4560]/40 px-1.5 py-0.5 font-mono text-[10px] text-[#86ADC2]">
                Implementation
              </span>
              <span className="rounded-lg border border-[#F2796B]/30 bg-[#3A1414] px-1.5 py-0.5 font-mono text-[10px] text-[#F2796B]">
                Critical
              </span>
            </div>
          </div>

          <div className="rounded-lg border border-[#1E4560] bg-[#123049] p-4">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-[#4F7590]">
              Reviewed interpretation
            </p>
            <p className="text-sm leading-relaxed text-[#E9F3F8]">
              Refund operations may be safely retried. Duplicate requests are
              detected and deduplicated per (transaction_id, user_id) pair.
            </p>
            <p className="mt-2 font-mono text-[10px] text-[#4F7590]">
              Preserved qualifiers: per transaction and user · idempotent
            </p>
          </div>

          <div className="rounded-lg border border-[#FFC94D]/30 bg-[#123049] p-4">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-[#4F7590]">
              Verdict
            </p>
            <div className="flex items-center gap-2">
              <CircleDashed className="h-4 w-4 text-[#FFC94D]" aria-hidden />
              <span className="font-mono text-sm font-medium text-[#FFC94D]">
                Partially verified
              </span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-[#86ADC2]">
              Sequential idempotency confirmed. Concurrent duplicate requests
              unprotected — distributed lock absent.
            </p>
            <div className="mt-3 flex items-start gap-1.5 rounded-lg border border-[#FFC94D]/20 bg-[#3A2A0E] px-2 py-1.5">
              <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0 text-[#FFC94D]" aria-hidden />
              <p className="font-mono text-[10px] text-[#FFC94D]">
                Skeptic challenge accepted · verdict reduced
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function AgentWorkflowSection() {
  const agents = [
    {
      icon: Camera,
      role: "Snapshot ingest",
      description:
        "Resolves an exact commit and builds an immutable manifest of admitted public repository files. No clone, build, or execution.",
    },
    {
      icon: ListTree,
      role: "Investigation planner",
      description:
        "Uses Qwen to decompose the approved claim into obligation tasks scoped to the snapshot manifest.",
    },
    {
      icon: Microscope,
      role: "Repository investigator",
      description:
        "Runs lexical search over admitted files and uses Qwen only on retrieved excerpts to collect evidence candidates.",
    },
    {
      icon: ShieldAlert,
      role: "Skeptic agent",
      description:
        "Challenges provisional conclusions, records severity, and can trigger bounded reinvestigation when support is weak.",
    },
    {
      icon: Scale,
      role: "Evidence judge",
      description:
        "Reconciles evidence, challenges, and gaps into a final verdict with explicit limitations and maintainer actions.",
    },
  ];

  return (
    <section className="border-b border-[#1E4560] px-6 py-14 md:px-12">
      <div className="mx-auto max-w-6xl">
        <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-[#4F7590]">
          Durable worker pipeline
        </p>
        <h2 className="mb-2 text-balance text-2xl font-semibold text-[#E9F3F8]">
          Five workers. Adversarial validation.
        </h2>
        <p className="mb-10 max-w-2xl text-sm leading-relaxed text-[#86ADC2]">
          Each stage is a separate PostgreSQL-backed worker process. Qwen
          (Alibaba DashScope) powers planning, investigation, skeptic review,
          and judgment. Human approval happens before automation starts.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => {
            const Icon = agent.icon;
            return (
              <div
                key={agent.role}
                className="rounded-lg border border-[#1E4560] bg-[#123049] p-4"
              >
                <div className="mb-3 flex items-center gap-2">
                  <div className="rounded-lg border border-[#FF6B1A]/30 bg-[#FF6B1A]/10 p-1.5">
                    <Icon className="h-3.5 w-3.5 text-[#FF6B1A]" aria-hidden />
                  </div>
                  <span className="text-xs font-semibold text-[#E9F3F8]">
                    {agent.role}
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-[#86ADC2]">
                  {agent.description}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function AudienceSection() {
  const audiences = [
    "Hackathon judges",
    "Grant reviewers",
    "Milestone verifiers",
    "Due-diligence teams",
    "Accelerators and incubators",
    "Open-source funding platforms",
    "Engineering leads",
    "Project maintainers",
  ];

  return (
    <section className="border-b border-[#1E4560] px-6 py-14 md:px-12">
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-10 lg:grid-cols-2 lg:items-center lg:gap-16">
          <div>
            <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-[#4F7590]">
              Who uses Cernix
            </p>
            <h2 className="mb-4 text-balance text-2xl font-semibold text-[#E9F3F8]">
              For everyone who needs to trust a technical claim.
            </h2>
            <p className="text-sm leading-relaxed text-[#86ADC2]">
              Reviewers use Cernix to examine assertions in submissions.
              Maintainers use it to see where repository evidence is strong or
              thin. Scope is public source at a fixed commit — not runtime
              behavior or private infrastructure.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {audiences.map((a) => (
              <div
                key={a}
                className="flex items-center gap-2 rounded-lg border border-[#1E4560] bg-[#123049] px-3 py-2"
              >
                <Users className="h-3 w-3 shrink-0 text-[#FF6B1A]" aria-hidden />
                <span className="text-xs text-[#86ADC2]">{a}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export function CtaSection() {
  return (
    <section className="px-6 py-16 md:px-12">
      <div className="mx-auto max-w-6xl">
        <div className="rounded-lg border border-[#1E4560] bg-[#123049] p-10 text-center">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-[#FF6B1A]">
            Ready to investigate
          </p>
          <h2 className="mb-4 text-balance text-2xl font-semibold text-[#E9F3F8]">
            Trace the evidence. Not the claim.
          </h2>
          <p className="mb-8 text-sm text-[#86ADC2]">
            Sign in, submit a public repository with one focus claim, and follow
            the investigation through to a durable evidence report.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link
              href="/investigations/new"
              className="inline-flex items-center gap-2 rounded-lg bg-[#FF6B1A] px-5 py-2.5 text-sm font-medium text-[#0B1E2E] transition-colors hover:bg-[#FF8540]"
            >
              Investigate a project
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            <Link
              href="/sample-report"
              className="inline-flex items-center gap-2 rounded-lg border border-[#1E4560] bg-[#1E4560]/40 px-5 py-2.5 text-sm font-medium text-[#E9F3F8] transition-colors hover:border-[#FF6B1A]/50"
            >
              Explore sample report
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
