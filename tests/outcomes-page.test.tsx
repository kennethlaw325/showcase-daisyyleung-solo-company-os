// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import OutcomesPage from "../app/app/outcomes/page";

vi.mock("../src/demo-mode", () => ({ isSafeDemoMode: () => false }));

vi.mock("../src/lib/supabase/auth", () => ({
  requirePortalContext: vi.fn(async () => ({
    user: { id: "user-1" },
    locale: "en",
    workspace: { id: "workspace-1", name: "Workspace", slug: "workspace", timezone: "Asia/Hong_Kong", default_locale: "en" },
    membership: { workspace_id: "workspace-1", role: "owner" },
  })),
}));

vi.mock("../src/lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    from(table: string) {
      const result = table === "cases"
        ? {
          data: [
            { id: "case-oldest", title: "Oldest case", module: "operations" },
            { id: "case-middle", title: "Middle case", module: "growth" },
            { id: "case-newest", title: "Newest case", module: "intelligence" },
          ],
          error: null,
        }
        : { data: [], error: null };
      const query = {
        select: () => query,
        eq: () => query,
        is: () => query,
        order: () => query,
        limit: () => query,
        then: (resolve: (value: typeof result) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject),
      };
      return query;
    },
  })),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode; [key: string]: unknown }) => <a href={href} {...props}>{children}</a>,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("../src/components/locale-provider", () => ({
  Localized: ({ en }: { zh: ReactNode; en: ReactNode }) => <>{en}</>,
  useLocale: () => ({ locale: "en", localeSaving: false, toggleLocale: vi.fn(), setLocale: vi.fn(), localeError: "" }),
}));

describe("outcomes page queue", () => {
  afterEach(() => cleanup());

  it("renders every tenant-scoped pending case oldest first with unique form labels", async () => {
    render(await OutcomesPage());

    const forms = Array.from(document.querySelectorAll<HTMLFormElement>(".outcome-pending-stack > form"));
    expect(forms).toHaveLength(3);
    expect(forms.map((form) => form.querySelector("h2")?.textContent)).toEqual(["Oldest case", "Middle case", "Newest case"]);
    expect(forms.map((form) => ({
      number: form.querySelector(".case-module-mark")?.textContent,
      accent: form.querySelector(".case-module-mark")?.classList.item(1),
    }))).toEqual([
      { number: "02", accent: "cyan" },
      { number: "01", accent: "violet" },
      { number: "03", accent: "amber" },
    ]);

    const confidenceLabels = Array.from(document.querySelectorAll<HTMLElement>("[id$='-confidence-label']"));
    const dispositionLabels = Array.from(document.querySelectorAll<HTMLElement>("[id$='-learning-disposition-label']"));
    expect(new Set(confidenceLabels.map((label) => label.id)).size).toBe(3);
    expect(new Set(dispositionLabels.map((label) => label.id)).size).toBe(3);
    for (const form of forms) {
      const labelledTriggers = Array.from(form.querySelectorAll<HTMLButtonElement>(".outcome-select-trigger"));
      expect(labelledTriggers).toHaveLength(2);
      for (const trigger of labelledTriggers) {
        const labelIds = trigger.getAttribute("aria-labelledby")?.split(/\s+/u) ?? [];
        expect(labelIds[0]).toBeTruthy();
        expect(document.getElementById(labelIds[0]!)).not.toBeNull();
      }
    }
  });
});
