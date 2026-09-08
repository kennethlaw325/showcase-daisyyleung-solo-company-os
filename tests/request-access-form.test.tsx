// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RequestAccessForm } from "../src/components/request-access-form";

const localeState = vi.hoisted(() => ({ locale: "en" as "en" | "zh-Hant" }));

vi.mock("@/src/components/locale-provider", () => ({
  useLocale: () => ({ locale: localeState.locale }),
}));

function payloadAt(fetchMock: ReturnType<typeof vi.fn>, index: number) {
  const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
  return JSON.parse(String(calls[index]?.[1]?.body ?? "{}")) as Record<string, unknown>;
}

afterEach(() => {
  localeState.locale = "en";
  cleanup();
  vi.unstubAllGlobals();
});

describe("request access form", () => {
  it("keeps a successful submission in the success state after resetting", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<RequestAccessForm />);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Demo User" } });
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "demo@example.com" } });
    fireEvent.change(screen.getByLabelText("Which best describes your work?"), { target: { value: "consultant" } });
    fireEvent.change(screen.getByLabelText("What currently feels most scattered?"), { target: { value: "Context" } });
    fireEvent.change(screen.getByLabelText("What outcome would make this pilot worthwhile?"), { target: { value: "A clear result" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Application received"));
    expect(screen.getByRole("status").className).not.toContain("is-error");
    expect(document.body.textContent).not.toContain("TypeError");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstPayload = payloadAt(fetchMock, 0);
    expect(firstPayload.consent).toBe(true);
    expect(firstPayload.consentVersion).toBe("founding-pilot-2026-08-21-v1");
    expect(firstPayload.submissionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it("preserves values and the same submission id after a rate-limited retry", async () => {
    let attempt = 0;
    const fetchMock = vi.fn(async () => {
      attempt += 1;
      return new Response("{}", { status: attempt === 1 ? 429 : 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<RequestAccessForm />);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Demo User" } });
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "demo@example.com" } });
    fireEvent.change(screen.getByLabelText("Which best describes your work?"), { target: { value: "consultant" } });
    fireEvent.change(screen.getByLabelText("What currently feels most scattered?"), { target: { value: "Context" } });
    fireEvent.change(screen.getByLabelText("What outcome would make this pilot worthwhile?"), { target: { value: "A clear result" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(screen.getByRole("alert").className).toContain("is-error"));
    expect(screen.getByRole("alert").textContent).toMatch(/limit|later/i);
    const firstPayload = payloadAt(fetchMock, 0);
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Demo User");
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);

    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Application received"));
    const secondPayload = payloadAt(fetchMock, 1);
    expect(secondPayload.submissionId).toBe(firstPayload.submissionId);
    expect(secondPayload.name).toBe(firstPayload.name);
  });

  it("invalidates consent and rotates the submission id when the locale changes", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = render(<RequestAccessForm />);

    fireEvent.click(screen.getByRole("checkbox"));
    const englishSubmissionId = (screen.getByDisplayValue("founding-pilot-2026-08-21-v1") as HTMLInputElement).form?.querySelector<HTMLInputElement>("input[name='submissionId']")?.value;
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("link", { name: "privacy note" }).getAttribute("href")).toBe("/privacy?lang=en");
    expect(screen.getByRole("link", { name: "terms" }).getAttribute("href")).toBe("/terms?lang=en");

    localeState.locale = "zh-Hant";
    rerender(<RequestAccessForm />);
    await waitFor(() => expect(screen.getByRole("link", { name: "私隱聲明" })).toBeTruthy());

    const chineseSubmissionId = (screen.getByDisplayValue("founding-pilot-2026-08-21-v1") as HTMLInputElement).form?.querySelector<HTMLInputElement>("input[name='submissionId']")?.value;
    expect(chineseSubmissionId).not.toBe(englishSubmissionId);
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    expect(screen.getByRole("link", { name: "私隱聲明" }).getAttribute("href")).toBe("/privacy?lang=zh-Hant");
    expect(screen.getByRole("link", { name: "服務條款" }).getAttribute("href")).toBe("/terms?lang=zh-Hant");
  });
});
