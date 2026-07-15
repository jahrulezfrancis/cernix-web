import { LandingNav } from "@/components/landing/nav";
import { Hero } from "@/components/landing/hero";
import {
  ProblemSection,
  WorkflowSection,
  ExampleClaimSection,
  AgentWorkflowSection,
  AudienceSection,
  CtaSection,
} from "@/components/landing/sections";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[#0D2436]">
      <LandingNav />
      <main>
        <Hero />
        <ProblemSection />
        <WorkflowSection />
        <ExampleClaimSection />
        <AgentWorkflowSection />
        <AudienceSection />
        <CtaSection />
      </main>
      <footer className="border-t border-[#1E4560] px-6 py-6 md:px-12">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <span className="font-mono text-xs text-[#4F7590]">
            CERNIX · Technical verification infrastructure
          </span>
          <span className="font-mono text-xs text-[#4F7590]">
            Verify the build behind the claim.
          </span>
        </div>
      </footer>
    </div>
  );
}
