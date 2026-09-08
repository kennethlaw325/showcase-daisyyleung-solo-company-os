// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApprovalPanel } from "../src/components/portal/approval-panel";

const routerState = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => routerState,
}));

vi.mock("@/src/components/locale-provider", () => ({
  useLocale: () => ({ locale: "en" }),
}));

const approvalDetails = {
  caseId: "case-approval-panel",
  artifactRevision: 7,
  artifactHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  actionPayloadHash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  actionId: "11111111-1111-4111-8111-111111111111",
  idempotencyKey: "approval-panel-idempotency-7",
  to: "client@example.com",
  subject: "Exact approved subject",
  body: "Exact approved body",
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  routerState.refresh.mockReset();
});

describe("ApprovalPanel approval and draft gates", () => {
  it("posts the exact approval binding and renders the approved manual-send state", async () => {
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      void args;
      return new Response(JSON.stringify({ approved: true, approvalId: "approval-1" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ApprovalPanel {...approvalDetails} />);
    fireEvent.click(screen.getByRole("button", { name: /Approve exact draft/i }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("Draft approved.");
    expect(status.textContent).toContain("Sending remains manual.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/cases/case-approval-panel/approval");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        artifactRevision: 7,
        artifactHash: approvalDetails.artifactHash,
        actionPayloadHash: approvalDetails.actionPayloadHash,
      }),
    });
    await waitFor(() => expect(routerState.refresh).toHaveBeenCalledTimes(1));
  });

  it("shows a bounded recoverable stale alert while preserving approval details and retry", async () => {
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      void args;
      return new Response(JSON.stringify({ error: "Approval is stale" }), { status: 409 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ApprovalPanel {...approvalDetails} />);
    fireEvent.click(screen.getByRole("button", { name: /Approve exact draft/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Approval is stale");
    expect(alert.textContent).not.toContain(approvalDetails.artifactHash);
    const retry = screen.getByRole("button", { name: /Approve exact draft/i }) as HTMLButtonElement;
    expect(retry.disabled).toBe(false);
    expect(screen.getByText(approvalDetails.to)).toBeTruthy();
    expect(screen.getByText(approvalDetails.subject)).toBeTruthy();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/cases/case-approval-panel/approval");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      body: JSON.stringify({
        artifactRevision: 7,
        artifactHash: approvalDetails.artifactHash,
        actionPayloadHash: approvalDetails.actionPayloadHash,
      }),
    });
    expect(routerState.refresh).not.toHaveBeenCalled();
  });

  it("creates an approved Gmail draft from action_pending without calling a send endpoint", async () => {
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      void args;
      return new Response(JSON.stringify({ executed: true, providerReference: "draft-1" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ApprovalPanel {...approvalDetails} caseStatus="action_pending" actionStatus="pending" />);
    fireEvent.click(screen.getByRole("button", { name: /Create approved Gmail draft/i }));

    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Gmail draft created."));
    expect(screen.getByRole("status").textContent).toContain("Open Gmail to review and send it manually.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/cases/case-approval-panel/action");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actionId: approvalDetails.actionId, idempotencyKey: approvalDetails.idempotencyKey }),
    });
    expect(fetchMock.mock.calls.map(([url]) => String(url)).some((url) => /\/send(?:$|\/)/.test(url))).toBe(false);
  });
});
