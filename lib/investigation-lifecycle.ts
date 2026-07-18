import type { InvestigationStatus } from "./types";

export const TERMINAL_STATUSES = new Set<InvestigationStatus>(["completed", "completed_with_limitations", "failed"]);

const ALLOWED_TRANSITIONS: Record<InvestigationStatus, readonly InvestigationStatus[]> = {
  draft: ["extracting_claims", "awaiting_claim_review", "failed"],
  extracting_claims: ["awaiting_claim_review", "failed"],
  awaiting_claim_review: ["investigating", "failed"],
  investigating: ["challenged", "reinvestigating", "judging", "completed", "completed_with_limitations", "failed"],
  challenged: ["reinvestigating", "judging", "failed"],
  reinvestigating: ["judging", "completed", "completed_with_limitations", "failed"],
  judging: ["completed", "completed_with_limitations", "failed", "awaiting_review"],
  awaiting_review: ["completed", "completed_with_limitations", "failed"],
  completed: [], completed_with_limitations: [], failed: [],
};

export function canTransitionStatus(from: InvestigationStatus, to: InvestigationStatus) {
  return from === to || ALLOWED_TRANSITIONS[from].includes(to);
}
export function isClaimReviewEditable(status: InvestigationStatus) {
  return status === "draft" || status === "extracting_claims" || status === "awaiting_claim_review";
}
export function canUseLiveControls(status: InvestigationStatus) { return status === "investigating"; }
export function continuationRoute(id: string, status: InvestigationStatus, hasReport = false) {
  if ((status === "completed" || status === "completed_with_limitations") && hasReport) return `/investigations/${id}/report`;
  if (status === "awaiting_claim_review" || status === "draft" || status === "extracting_claims") return `/investigations/${id}/claims`;
  return `/investigations/${id}/live`;
}
