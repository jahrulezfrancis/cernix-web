"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  FileSearch,
  PlusCircle,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Menu,
  GitBranch,
  GitCommitHorizontal,
  ClipboardList,
  Activity,
  FileText,
  User,
} from "lucide-react";
import type { Investigation } from "@/lib/types";

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  exact?: boolean;
}

const PRIMARY_NAV: NavItem[] = [
  { label: "Investigations", href: "/investigations", icon: FileSearch },
  { label: "New investigation", href: "/investigations/new", icon: PlusCircle },
  { label: "Sample report", href: "/sample-report", icon: BookOpen },
];

function getInvestigationNav(id: string): NavItem[] {
  return [
    { label: "Claims", href: `/investigations/${id}/claims`, icon: ClipboardList },
    { label: "Agent activity", href: `/investigations/${id}/live`, icon: Activity },
    { label: "Report", href: `/investigations/${id}/report`, icon: FileText },
  ];
}

interface AppShellProps {
  children: React.ReactNode;
  investigation?: Investigation | null;
  title?: string;
  lockScroll?: boolean;
}

export function AppShell({ children, investigation, title, lockScroll = false }: AppShellProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const investigationNav = investigation
    ? getInvestigationNav(investigation.id)
    : null;

  const NavLink = ({ item }: { item: NavItem }) => {
    const isActive = item.exact
      ? pathname === item.href
      : pathname.startsWith(item.href) && item.href !== "/";
    const Icon = item.icon;
    return (
      <Link
        href={item.href}
        onClick={() => setMobileOpen(false)}
        className={cn(
          "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors",
          isActive
            ? "bg-[#1E4560] text-[#FF6B1A]"
            : "text-[#86ADC2] hover:bg-[#1E4560]/50 hover:text-[#E9F3F8]",
          collapsed && "justify-center px-2"
        )}
        aria-current={isActive ? "page" : undefined}
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden />
        {!collapsed && <span>{item.label}</span>}
      </Link>
    );
  };

  const SidebarContent = () => (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div
        className={cn(
          "flex items-center border-b border-[#1E4560] py-3",
          collapsed ? "justify-center px-3" : "justify-between px-4"
        )}
      >
        {!collapsed && (
          <Link href="/" className="flex items-center gap-2">
            <span className="font-mono text-sm font-bold tracking-wider text-[#E9F3F8]">
              CERNIX
            </span>
          </Link>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="hidden rounded-lg p-1 text-[#86ADC2] transition-colors hover:bg-[#1E4560]/50 hover:text-[#E9F3F8] lg:flex"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" aria-hidden />
          ) : (
            <ChevronLeft className="h-4 w-4" aria-hidden />
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-2" aria-label="Main navigation">
        <div className="flex flex-col gap-0.5">
          {!collapsed && (
            <p className="px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-[#4F7590]">
              Platform
            </p>
          )}
          {PRIMARY_NAV.map((item) => (
            <NavLink key={item.href} item={item} />
          ))}
        </div>

        {investigation && investigationNav && (
          <div className="mt-4 flex flex-col gap-0.5">
            {!collapsed && (
              <>
                <p className="px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-[#4F7590]">
                  Investigation
                </p>
                <div className="mx-2.5 mb-2 rounded-lg border border-[#1E4560] bg-[#0D2436] px-2 py-1.5">
                  <p className="truncate font-mono text-xs font-medium text-[#E9F3F8]">
                    {investigation.project.owner}/{investigation.project.repo}
                  </p>
                  <div className="mt-0.5 flex items-center gap-1">
                    <GitBranch className="h-3 w-3 text-[#4F7590]" aria-hidden />
                    <span className="font-mono text-[10px] text-[#86ADC2]">
                      {investigation.repositorySnapshot.branch}
                    </span>
                    <GitCommitHorizontal className="ml-1 h-3 w-3 text-[#4F7590]" aria-hidden />
                    <span className="font-mono text-[10px] text-[#86ADC2]">
                      {investigation.repositorySnapshot.commitSha.slice(0, 7)}
                    </span>
                  </div>
                </div>
              </>
            )}
            {investigationNav.map((item) => (
              <NavLink key={item.href} item={item} />
            ))}
          </div>
        )}
      </nav>

      {/* User menu placeholder */}
      <div className={cn("border-t border-[#1E4560] p-2")}>
        <button
          className={cn(
            "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-[#86ADC2] transition-colors hover:bg-[#1E4560]/50 hover:text-[#E9F3F8]",
            collapsed && "justify-center"
          )}
          aria-label="User menu"
        >
          <User className="h-4 w-4 shrink-0" aria-hidden />
          {!collapsed && <span>Account</span>}
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-[#0D2436]">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden flex-shrink-0 border-r border-[#1E4560] bg-[#123049] transition-all duration-200 lg:flex lg:flex-col",
          collapsed ? "w-14" : "w-52"
        )}
        aria-label="Sidebar navigation"
      >
        <SidebarContent />
      </aside>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-50 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation menu"
        >
          <div
            className="fixed inset-0 bg-black/60"
            onClick={() => setMobileOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 w-64 border-r border-[#1E4560] bg-[#123049]">
            <SidebarContent />
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="flex h-11 shrink-0 items-center justify-between border-b border-[#1E4560] bg-[#123049] px-4">
          <div className="flex min-w-0 items-center gap-3">
            <button
              onClick={() => setMobileOpen(true)}
              className="rounded-lg p-1 text-[#86ADC2] hover:bg-[#1E4560]/50 hover:text-[#E9F3F8] lg:hidden"
              aria-label="Open navigation"
            >
              <Menu className="h-4 w-4" aria-hidden />
            </button>
            {title && (
              <h1 className="truncate text-sm font-medium text-[#E9F3F8]">
                {title}
              </h1>
            )}
            {investigation && (
              <div className="hidden items-center gap-2 md:flex">
                <span className="font-mono text-xs text-[#86ADC2]">
                  {investigation.project.owner}/{investigation.project.repo}
                </span>
                <span className="text-[#1E4560]">/</span>
                <span className="flex items-center gap-1 font-mono text-xs text-[#86ADC2]">
                  <GitBranch className="h-3 w-3" aria-hidden />
                  {investigation.repositorySnapshot.branch}
                </span>
                <span className="flex items-center gap-1 font-mono text-xs text-[#86ADC2]">
                  <GitCommitHorizontal className="h-3 w-3" aria-hidden />
                  {investigation.repositorySnapshot.commitSha.slice(0, 7)}
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {investigation && (
              <StatusBadge status={investigation.status} />
            )}
          </div>
        </header>

        {/* Page content */}
        <main className={cn("flex-1", lockScroll ? "overflow-hidden" : "overflow-y-auto")}>
          {children}
        </main>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; color: string; dot: string }> = {
    investigating: {
      label: "Investigating",
      color: "text-[#FF6B1A]",
      dot: "bg-[#FF6B1A] animate-pulse",
    },
    completed: {
      label: "Completed",
      color: "text-[#4FBF9A]",
      dot: "bg-[#4FBF9A]",
    },
    awaiting_claim_review: {
      label: "Awaiting review",
      color: "text-[#FFC94D]",
      dot: "bg-[#FFC94D]",
    },
    completed_with_limitations: {
      label: "Completed",
      color: "text-[#FFC94D]",
      dot: "bg-[#FFC94D]",
    },
    failed: {
      label: "Failed",
      color: "text-[#F2796B]",
      dot: "bg-[#F2796B]",
    },
  };

  const cfg = config[status] ?? {
    label: status.replace(/_/g, " "),
    color: "text-[#86ADC2]",
    dot: "bg-[#86ADC2]",
  };

  return (
    <span className={cn("flex items-center gap-1.5 font-mono text-xs", cfg.color)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", cfg.dot)} aria-hidden />
      {cfg.label}
    </span>
  );
}
