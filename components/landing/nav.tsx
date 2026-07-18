import Link from "next/link";

export function LandingNav() {
  return (
    <nav
      className="flex h-11 items-center justify-between border-b border-[#1E4560] bg-[#123049] px-6 md:px-12"
      aria-label="Site navigation"
    >
      <Link href="/" className="font-mono text-sm font-bold tracking-wider text-[#E9F3F8]">
        CERNIX
      </Link>
      <div className="flex items-center gap-5">
        <Link
          href="/investigations"
          className="text-xs text-[#86ADC2] transition-colors hover:text-[#E9F3F8]"
        >
          Investigations
        </Link>
        <Link
          href="/sample-report"
          className="text-xs text-[#86ADC2] transition-colors hover:text-[#E9F3F8]"
        >
          Sample report
        </Link>
        <Link
          href="/investigations/new"
          className="rounded-lg bg-[#FF6B1A] px-3 py-1.5 text-xs font-medium text-[#0B1E2E] transition-colors hover:bg-[#FF8540]"
        >
          Investigate
        </Link>
      </div>
    </nav>
  );
}
