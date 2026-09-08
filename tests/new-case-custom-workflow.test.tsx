// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../src/components/locale-provider", () => ({ useLocale: () => ({ locale: "en", localeSaving: false }) }));
vi.mock("../src/components/portal/learning-picker", () => ({ LearningPicker: () => null }));
vi.mock("../src/components/portal/browser-speech-to-text-control", () => ({ SpeechToTextControl: () => null }));

import { NewCaseForm } from "../src/components/portal/new-case-form";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Custom reusable workflow", () => {
  it("saves a separately named stream without clearing the case title", async () => {
    const workflow = {
      id: "00000000-0000-4000-8000-000000000222",
      workspace_id: "00000000-0000-4000-8000-000000000111",
      group_id: "00000000-0000-4000-8000-000000000333",
      version: 1,
      base_module: "operations",
      name: "Client decision review",
      description: "A broadly useful setup for capturing context and the next decision.",
      goal_mode: "decision",
      intake_defaults: { flowKey: "general" },
      checklist: [],
      stage_visibility: { intake: true, artifact: true, approval: true, gmail: true, outcome: true },
      status: "active",
      content_hash: "a".repeat(64),
      created_by: "00000000-0000-4000-8000-000000000444",
      created_at: "2026-08-27T09:00:00.000Z",
      updated_at: "2026-08-27T09:00:00.000Z",
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ workflow }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<NewCaseForm demo={false} />);

    fireEvent.click(screen.getByRole("radio", { name: /Custom/i }));
    fireEvent.change(screen.getByLabelText("Case title"), { target: { value: "Bean & Bloom website review" } });
    fireEvent.change(screen.getByLabelText("Workflow name"), { target: { value: "Client decision review" } });
    fireEvent.change(screen.getByLabelText("Next step / decision needed"), { target: { value: "Confirm the next owner" } });
    fireEvent.click(screen.getByRole("button", { name: "Save to My Workflow" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/workflows");
    const payload = JSON.parse(String(init?.body));
    expect(payload).toMatchObject({
      baseModule: "operations",
      name: "Client decision review",
      goalMode: "decision",
      intakeDefaults: { flowKey: "general", decisionsNeeded: ["Confirm the next owner"] },
      stageVisibility: { intake: true, artifact: true, approval: true, gmail: true, outcome: true },
    });
    expect(screen.getByDisplayValue("Bean & Bloom website review")).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Client decision review/i })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save to My Workflow" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(/underlying engine/i)).toBeNull();
  });

  it("reopens a saved Custom workflow without clearing case inputs", () => {
    const workflow = {
      id: "00000000-0000-4000-8000-000000000222",
      workspace_id: "00000000-0000-4000-8000-000000000111",
      group_id: "00000000-0000-4000-8000-000000000333",
      version: 1,
      base_module: "operations" as const,
      name: "Client decision review",
      description: "A broadly useful setup for capturing context and the next decision.",
      goal_mode: "decision" as const,
      intake_defaults: { flowKey: "general", successCriteria: "A clear owner and date" },
      checklist: [],
      stage_visibility: { intake: true, artifact: true, approval: true, gmail: true, outcome: true },
      status: "active" as const,
      content_hash: "a".repeat(64),
      created_by: "00000000-0000-4000-8000-000000000444",
      created_at: "2026-08-27T09:00:00.000Z",
      updated_at: "2026-08-27T09:00:00.000Z",
    };
    render(<NewCaseForm demo={false} workflowStreams={[workflow]} />);

    fireEvent.change(screen.getByLabelText("Case title"), { target: { value: "Bean & Bloom website review" } });
    fireEvent.change(screen.getByLabelText("Paste text or notes"), { target: { value: "Client wants a recommendation by Friday." } });
    fireEvent.click(screen.getByRole("radio", { name: /Client decision review/i }));

    expect((screen.getByRole("radio", { name: /Custom/i }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByDisplayValue("Bean & Bloom website review")).toBeTruthy();
    expect(screen.getByDisplayValue("Client wants a recommendation by Friday.")).toBeTruthy();
    expect(screen.getByLabelText("Next step / decision needed")).toBeTruthy();
  });

  it("reuses an unchanged workflow request key and rotates it after an edit", async () => {
    const workflow = {
      id: "00000000-0000-4000-8000-000000000222",
      workspace_id: "00000000-0000-4000-8000-000000000111",
      group_id: "00000000-0000-4000-8000-000000000333",
      version: 1,
      base_module: "operations",
      name: "Edited decision review",
      description: "A broadly useful setup for capturing context and the next decision.",
      goal_mode: "decision",
      intake_defaults: { flowKey: "general" },
      checklist: [],
      stage_visibility: { intake: true, artifact: true, approval: true, gmail: true, outcome: true },
      status: "active",
      content_hash: "a".repeat(64),
      created_by: "00000000-0000-4000-8000-000000000444",
      created_at: "2026-08-27T09:00:00.000Z",
      updated_at: "2026-08-27T09:00:00.000Z",
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Temporary failure" }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Temporary failure" }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ workflow }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<NewCaseForm demo={false} />);

    fireEvent.click(screen.getByRole("radio", { name: /Custom/i }));
    const nameInput = screen.getByLabelText("Workflow name");
    const saveButton = screen.getByRole("button", { name: "Save to My Workflow" });
    fireEvent.change(nameInput, { target: { value: "Client decision review" } });
    fireEvent.click(saveButton);
    await waitFor(() => expect((saveButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(saveButton);
    await waitFor(() => expect((saveButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.change(nameInput, { target: { value: "Edited decision review" } });
    fireEvent.click(saveButton);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    const requestBodies = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)) as { idempotencyKey: string });
    expect(requestBodies[0].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/i);
    expect(requestBodies[1].idempotencyKey).toBe(requestBodies[0].idempotencyKey);
    expect(requestBodies[2].idempotencyKey).not.toBe(requestBodies[1].idempotencyKey);
  });
});
