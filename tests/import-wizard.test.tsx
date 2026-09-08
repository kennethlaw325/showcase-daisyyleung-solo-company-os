// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/components/portal/browser-speech-to-text-control", () => ({
  SpeechToTextControl: () => <div data-testid="speech-control" />,
}));

import { ImportWizard } from "../src/components/portal/import-wizard";

const source = {
  kind: "pasted",
  filename: "pasted-intake.txt",
  mimeType: "text/plain",
  byteSize: 24,
  sha256: "a".repeat(64),
  extractedText: "Review the client handoff",
  truncated: false,
};

const proposal = {
  flow: "operations",
  module: "operations",
  title: "Client handoff",
  objective: "Decide the next owner",
  intakeContext: {
    schemaVersion: 1,
    successCriteria: "One confirmed owner",
    workflowGuidance: "",
    decisionsNeeded: ["Decide the next owner"],
    owners: [],
    deadlines: [],
    sopContext: "",
    blockers: [],
    crossFunctionalSignals: [],
  },
  gaps: ["Confirm the deadline"],
  conflicts: [],
  risks: ["The source may be incomplete"],
  checklist: [{ id: "confirm-owner", label: "Confirm the next owner", required: true }],
  confidence: 0.72,
};

const growthProposal = {
  ...proposal,
  flow: "growth",
  module: "growth",
  intakeContext: {
    schemaVersion: 1,
    successCriteria: "15 qualified consultations",
    workflowGuidance: "",
    offer: "",
    leadProfile: "",
    pipelineContext: "80 places",
    campaignContext: "",
    conversionTarget: "",
  },
};

const intelligenceProposal = {
  ...proposal,
  flow: "intelligence",
  module: "intelligence",
  intakeContext: {
    schemaVersion: 1,
    successCriteria: "A source-led brief for the intended audience",
    workflowGuidance: "",
  },
  audience: {
    preset: "custom",
    knowledgeLevel: "Informed generalist",
    goal: "Understand the decision and implications",
    tone: "Clear, grounded, and concise",
    format: "Structured brief with recommendations",
    disclosureBoundaries: [],
  },
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ImportWizard review boundary", () => {
  it("shows the four existing work flows before analysis", () => {
    render(<ImportWizard locale="en" />);

    expect(screen.getAllByRole("radio")).toHaveLength(4);
    expect(screen.getByRole("radio", { name: /Growth & Revenue/ })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Business Insights/ })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Brand Communications & PR/ })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Custom/ })).toBeTruthy();
    expect(screen.getByText("Choose a work flow, then paste text, add a speech transcript, or choose up to three files.")).toBeTruthy();
    expect(screen.getAllByText("No case is created before your confirmation.")).toHaveLength(1);
  });

  it("analyses first and creates a case only after the explicit confirmation", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ proposal, sources: [source], failures: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "00000000-0000-4000-8000-000000000123", generated: false }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ revision: 1 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ImportWizard locale="en" clients={[{ id: "00000000-0000-4000-8000-000000000001", name: "Northstar" }]} />);

    fireEvent.click(screen.getByRole("radio", { name: /Business Insights/i }));
    fireEvent.change(screen.getByLabelText(/Source text or speech transcript/i), { target: { value: "Review the client handoff" } });
    fireEvent.click(screen.getByRole("button", { name: "Analyse and propose draft" }));

    await screen.findByRole("button", { name: "Confirm and generate first draft" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/imports/classify");
    expect((fetchMock.mock.calls[0][1]?.body as FormData).get("flow")).toBe("operations");
    expect(screen.getByText("Pasted or dictated notes")).toBeTruthy();
    expect(screen.getByText("Fully read")).toBeTruthy();
    expect(screen.queryByText(/pasted-intake\.txt|24 bytes|aaaaaaaaaaaa/)).toBeNull();
    expect(screen.getByRole("heading", { name: "Gaps to confirm" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Risks" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Checklist" })).toBeTruthy();
    expect(screen.getByLabelText(/Decisions needed/i)).toBeTruthy();
    expect(screen.queryByLabelText(/Case details \(complete required fields\)/i)).toBeNull();

    fireEvent.change(screen.getByLabelText(/Link client/i), { target: { value: "00000000-0000-4000-8000-000000000001" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm and generate first draft" }));

    await screen.findByRole("link", { name: "Open case" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    await screen.findByText("The case and its first draft are ready.");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/imports/confirm");
    expect(fetchMock.mock.calls[2][0]).toBe("/api/cases/00000000-0000-4000-8000-000000000123/generate-revision");
    const confirmPayload = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(confirmPayload.flow).toBe("operations");
    expect(confirmPayload).not.toHaveProperty("module");
    expect(confirmPayload.clientId).toBe("00000000-0000-4000-8000-000000000001");
    expect(screen.getByRole("link", { name: "View initial inputs" }).getAttribute("href")).toBe("/app/intakes?case=00000000-0000-4000-8000-000000000123#initial-intake-00000000-0000-4000-8000-000000000123");
  });

  it("invalidates a stale proposal whenever the source input changes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ proposal, sources: [source], failures: [] }), { status: 200 })));
    render(<ImportWizard locale="en" />);

    const sourceInput = screen.getByLabelText(/Source text or speech transcript/i);
    fireEvent.click(screen.getByRole("radio", { name: /Business Insights/i }));
    fireEvent.change(sourceInput, { target: { value: "First source" } });
    fireEvent.click(screen.getByRole("button", { name: "Analyse and propose draft" }));
    await screen.findByRole("button", { name: "Confirm and generate first draft" });

    fireEvent.change(sourceInput, { target: { value: "Changed after analysis" } });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Confirm and generate first draft" })).toBeNull());
    expect((screen.getByRole("button", { name: "Analyse and propose draft" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("blocks incomplete Growth details locally before any case request", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ proposal: growthProposal, sources: [source], failures: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ImportWizard locale="en" />);

    fireEvent.click(screen.getByRole("radio", { name: /Growth & Revenue/i }));
    fireEvent.change(screen.getByLabelText(/Source text or speech transcript/i), { target: { value: "Recruit 80 places with a 30,000 budget" } });
    fireEvent.click(screen.getByRole("button", { name: "Analyse and propose draft" }));
    const confirmButton = await screen.findByRole("button", { name: "Confirm and generate first draft" });
    fireEvent.click(confirmButton);

    await screen.findByText(/Complete “Offer · product or service”/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(screen.getByLabelText(/Offer · product or service/i));
  });

  it("shows the existing audience fields for the communications flow", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ proposal: intelligenceProposal, sources: [source], failures: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ImportWizard locale="en" />);

    fireEvent.click(screen.getByRole("radio", { name: /Brand Communications & PR/i }));
    fireEvent.change(screen.getByLabelText(/Source text or speech transcript/i), { target: { value: "Prepare a client-facing source brief" } });
    fireEvent.click(screen.getByRole("button", { name: "Analyse and propose draft" }));

    expect(await screen.findByLabelText("Knowledge level")).toBeTruthy();
    expect(screen.getByLabelText("Audience goal")).toBeTruthy();
    expect(screen.getByLabelText("Tone")).toBeTruthy();
    expect(screen.getByLabelText("Format")).toBeTruthy();
    expect(screen.getByLabelText(/Disclosure boundaries/)).toBeTruthy();
    expect((fetchMock.mock.calls[0][1]?.body as FormData).get("flow")).toBe("intelligence");
  });

  it("reuses an unchanged confirmation key and rotates it after draft edits", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ proposal, sources: [source], failures: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Temporary failure" }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Temporary failure" }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "00000000-0000-4000-8000-000000000123", generated: false }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ revision: 1 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ImportWizard locale="en" />);

    fireEvent.click(screen.getByRole("radio", { name: /Business Insights/i }));
    fireEvent.change(screen.getByLabelText(/Source text or speech transcript/i), { target: { value: "Review the client handoff" } });
    fireEvent.click(screen.getByRole("button", { name: "Analyse and propose draft" }));
    const confirmButton = await screen.findByRole("button", { name: "Confirm and generate first draft" });
    fireEvent.click(confirmButton);
    await waitFor(() => expect((confirmButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(confirmButton);
    await waitFor(() => expect((confirmButton as HTMLButtonElement).disabled).toBe(false));

    const guidance = screen.getByLabelText(/Generation guidance/i);
    fireEvent.change(guidance, { target: { value: "Use the updated facts" } });
    fireEvent.click(confirmButton);
    await screen.findByRole("link", { name: "Open case" });

    const confirmationBodies = fetchMock.mock.calls
      .filter((call) => call[0] === "/api/imports/confirm")
      .map((call) => JSON.parse(String(call[1]?.body)) as { idempotencyKey: string });
    expect(confirmationBodies[0].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/i);
    expect(confirmationBodies[1].idempotencyKey).toBe(confirmationBodies[0].idempotencyKey);
    expect(confirmationBodies[2].idempotencyKey).not.toBe(confirmationBodies[1].idempotencyKey);
  });

  it("keeps the created case visible when first-draft generation fails", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ proposal, sources: [source], failures: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "00000000-0000-4000-8000-000000000123" }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Provider unavailable" }), { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ImportWizard locale="en" />);

    fireEvent.click(screen.getByRole("radio", { name: /Business Insights/i }));
    fireEvent.change(screen.getByLabelText(/Source text or speech transcript/i), { target: { value: "Review the client handoff" } });
    fireEvent.click(screen.getByRole("button", { name: "Analyse and propose draft" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm and generate first draft" }));

    await screen.findByText(/case was created, but the first draft could not be generated/i);
    expect(screen.getByRole("link", { name: "Open case" })).toBeTruthy();
    expect(screen.getByText("Provider unavailable")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("accepts PPTX files and preserves the selected file when extraction fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "No selected file could be extracted", errorCode: "no_sources_extracted", failures: [{ filename: "brief.pptx", code: "pptx_parse_failed" }] }), { status: 422 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ImportWizard locale="en" />);
    fireEvent.click(screen.getByRole("radio", { name: /Business Insights/i }));
    const fileInput = document.querySelector('input[type="file"]');
    expect(fileInput).toBeTruthy();
    const file = new File(["not a real deck"], "brief.pptx", { type: "application/vnd.ms-powerpoint" });
    fireEvent.change(fileInput!, { target: { files: [file] } });
    expect(screen.getByText("brief.pptx")).toBeTruthy();
    expect(screen.queryByText(/15 bytes/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Analyse and propose draft" }));
    await screen.findByText(/brief\.pptx \(PPTX could not be read\)/);
    expect(screen.getByText(/selected files could not be extracted/i)).toBeTruthy();
    expect(screen.getByText("brief.pptx")).toBeTruthy();
  });
});
