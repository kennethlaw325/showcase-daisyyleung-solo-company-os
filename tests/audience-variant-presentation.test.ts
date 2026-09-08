import { describe, expect, it } from "vitest";
import { localizeAudiencePreset, localizeAudienceProfileValue } from "../src/lib/presentation/audience-variant";

describe("audience variant presentation", () => {
  it("localizes built-in audience labels and profile copy in Traditional Chinese", () => {
    expect(localizeAudiencePreset("SELF", "zh-Hant")).toBe("自己");
    expect(localizeAudiencePreset("client", "zh-Hant")).toBe("客戶");
    expect(localizeAudienceProfileValue("direct and reflective", "zh-Hant")).toBe("直接、反思式");
    expect(localizeAudienceProfileValue("client-ready brief", "zh-Hant")).toBe("客戶版簡報");
    expect(localizeAudienceProfileValue("the same requested deliverable, adapted for public use", "zh-Hant")).toBe("同一交付內容的公開版本");
  });

  it("preserves English and unknown user-defined values", () => {
    expect(localizeAudiencePreset("public", "en")).toBe("Public");
    expect(localizeAudienceProfileValue("plain and approachable", "en")).toBe("plain and approachable");
    expect(localizeAudienceProfileValue("專業但親切", "zh-Hant")).toBe("專業但親切");
  });
});
