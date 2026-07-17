import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DASHBOARD_INVESTIGATIONS } from "@/lib/mock-data";
import { InvestigationRow } from "./page";

describe("InvestigationRow", () => {
  it("renders demo rows as clearly labelled and non-interactive", () => {
    const markup = renderToStaticMarkup(
      <InvestigationRow inv={DASHBOARD_INVESTIGATIONS[0]} demo />
    );

    expect(markup).toContain("Demo");
    expect(markup).toContain("Demo only");
    expect(markup).not.toContain("href=");
  });
});
