// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionDraftEditor } from "../src/components/portal/action-draft-editor";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/src/components/locale-provider", () => ({
  useLocale: () => ({ locale: "en" }),
}));

afterEach(() => cleanup());

describe("ActionDraftEditor template choice", () => {
  it("lets the user choose detailed or key-points content before creating a Gmail draft", () => {
    render(<ActionDraftEditor
      caseId="case-1"
      title="Client onboarding decision"
      summary="The client needs one confirmed onboarding route."
      body="The current handoff has five steps.\n\n- Confirm the delivery owner\n- Remove the duplicate approval"
      nextAction="Confirm the owner by Friday."
      contentLocale="en"
    />);

    expect(screen.getByRole("group", { name: "Choose draft format" })).toBeTruthy();
    expect((screen.getByRole("radio", { name: /Detailed/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Subject") as HTMLInputElement).value).toBe("A focused next step: Client onboarding decision");
    expect((screen.getByLabelText("Full draft body") as HTMLTextAreaElement).value).toContain("Details");

    fireEvent.click(screen.getByRole("radio", { name: /Key points/ }));

    expect((screen.getByRole("radio", { name: /Key points/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Subject") as HTMLInputElement).value).toBe("Action needed: Client onboarding decision");
    expect((screen.getByLabelText("Full draft body") as HTMLTextAreaElement).value).toContain("Key points");
    expect((screen.getByLabelText("Full draft body") as HTMLTextAreaElement).value).not.toContain("Details");
  });

  it("does not replace an already-created action with a template picker", () => {
    render(<ActionDraftEditor
      caseId="case-1"
      title="Existing draft"
      summary="Summary"
      body="Body"
      nextAction="Next"
      action={{ to: "client@example.com", subject: "Human subject", body: "Human-edited body" }}
    />);

    expect(screen.queryByRole("group", { name: "Choose draft format" })).toBeNull();
    expect((screen.getByLabelText("Subject") as HTMLInputElement).value).toBe("Human subject");
    expect((screen.getByLabelText("Full draft body") as HTMLTextAreaElement).value).toBe("Human-edited body");
  });
});
