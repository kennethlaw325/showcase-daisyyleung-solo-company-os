// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { IntakeSnapshotPanel } from "../src/components/portal/intake-snapshot-panel";

afterEach(cleanup);

describe("initial input snapshot cards", () => {
  it("leads with the case title and keeps reconstruction status secondary", () => {
    render(<IntakeSnapshotPanel
      locale="en"
      caseId="case-1"
      caseTitle="Bean & Bloom website review"
      snapshot={{ payload: { title: "Ignored fallback" }, snapshot_status: "partial_legacy" }}
    />);

    expect(screen.getByRole("heading", { name: "Bean & Bloom website review" })).toBeTruthy();
    expect(screen.getByText("Legacy reconstruction")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /reconstruction/i })).toBeNull();
    const open = screen.getByRole("link", { name: "Open case" });
    expect(open.getAttribute("href")).toBe("/app/cases/case-1");
    expect(open.className).toContain("case-open-button");
  });

  it("keeps the snapshot readable without raw payload details or fingerprints", () => {
    render(<IntakeSnapshotPanel
      locale="en"
      caseId="case-2"
      caseTitle="Launch review"
      createdAt="2026-01-01T20:00:00.000Z"
      snapshot={{ payload: { title: "Launch review", moduleContext: { secret: "internal" } }, snapshot_status: "exact", semantic_payload_hash: "b".repeat(64) }}
    />);

    expect(screen.getByText("02/01/2026, 04:00")).toBeTruthy();
    expect(screen.getByText("02/01/2026, 04:00").tagName).toBe("TIME");
    expect(screen.queryByText(/Expand intake details/i)).toBeNull();
    expect(screen.queryByText(/Semantic fingerprint/i)).toBeNull();
    expect(screen.queryByText(/internal/i)).toBeNull();
    expect(screen.getByRole("link", { name: "Open case" })).toBeTruthy();
  });

  it("omits invalid timestamps instead of exposing an invalid date", () => {
    render(<IntakeSnapshotPanel
      locale="en"
      caseId="case-3"
      caseTitle="Invalid timestamp case"
      createdAt="not-a-date"
      snapshot={{ payload: { title: "Invalid timestamp case" }, snapshot_status: "exact" }}
    />);

    expect(screen.queryByText(/Invalid Date/i)).toBeNull();
    expect(screen.queryByText(/Captured:/i)).toBeNull();
  });
});
