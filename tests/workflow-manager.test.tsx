// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkflowManager } from "../src/components/portal/workflow-manager";
import type { WorkflowStream } from "../src/lib/domain/types";

vi.mock("@/src/components/locale-provider", () => ({
  useLocale: () => ({ locale: "en", localeSaving: false }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function streamFixture(overrides: Partial<WorkflowStream> = {}): WorkflowStream {
  return {
    id: "workflow-1",
    workspace_id: "workspace-1",
    group_id: "group-1",
    version: 1,
    base_module: "growth",
    name: "Existing workflow",
    description: "Existing description",
    goal_mode: "outcome",
    intake_defaults: { schemaVersion: 1, flowKey: "general", successCriteria: "One decision" },
    checklist: [],
    stage_visibility: { intake: true, artifact: true, approval: true, gmail: true, outcome: true },
    status: "active",
    content_hash: "hash",
    created_by: "user-1",
    created_at: "2026-08-27T00:00:00.000Z",
    updated_at: "2026-08-27T00:00:00.000Z",
    ...overrides,
  };
}

describe("WorkflowManager custom workflow defaults", () => {
  it("keeps internal flow fields out of the editor and injects them when creating", async () => {
    const created = streamFixture({ id: "workflow-created", base_module: "operations", goal_mode: "decision", name: "Client review" });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ workflow: created }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkflowManager demo={false} initialWorkflows={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "New workflow" }));

    const defaults = screen.getByRole("textbox", { name: "Information to prefill when a case starts" });
    expect((defaults as HTMLTextAreaElement).value).toBe("{}");
    expect(defaults.textContent).not.toMatch(/flowKey|schemaVersion/);
    fireEvent.change(screen.getByRole("textbox", { name: "Workflow name" }), { target: { value: "Client review" } });
    fireEvent.click(screen.getByRole("button", { name: "Save new version" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const payload = JSON.parse(String(init.body));
    expect(payload).toMatchObject({
      baseModule: "operations",
      goalMode: "decision",
      intakeDefaults: { schemaVersion: 1, flowKey: "general" },
    });
  });

  it("preserves hidden legacy fields and the stored module when editing", async () => {
    const existing = streamFixture();
    const revised = streamFixture({ id: "workflow-2", version: 2 });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ workflow: revised }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkflowManager demo={false} initialWorkflows={[existing]} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit workflow" }));

    const defaults = screen.getByRole("textbox", { name: "Information to prefill when a case starts" }) as HTMLTextAreaElement;
    expect(defaults.value).toContain("successCriteria");
    expect(defaults.value).not.toMatch(/flowKey|schemaVersion/);
    fireEvent.click(screen.getByRole("button", { name: "Save new version" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const payload = JSON.parse(String(init.body));
    expect(payload).toMatchObject({
      baseModule: "growth",
      goalMode: "outcome",
      intakeDefaults: { schemaVersion: 1, flowKey: "general", successCriteria: "One decision" },
      expectedVersion: 1,
    });
  });
});
