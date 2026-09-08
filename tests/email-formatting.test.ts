import { describe, expect, it } from "vitest";
import { emailBodyToHtml, emailBodyToPlainText, formatEmailBody, parseEmailBody } from "../src/lib/presentation/email-formatting";

describe("Gmail action-body formatting", () => {
  it("renders all supported inline marks and removes markers from plain text", () => {
    const formatted = formatEmailBody("**bold** _italic_ ==highlight==");
    expect(formatted.plainText).toBe("bold italic highlight");
    expect(formatted.html).toContain("<strong>bold</strong>");
    expect(formatted.html).toContain("<em>italic</em>");
    expect(formatted.html).toContain("<mark>highlight</mark>");
  });

  it("supports nested, non-crossing marks", () => {
    const formatted = formatEmailBody("**bold _italic ==highlight==_**");
    expect(formatted.plainText).toBe("bold italic highlight");
    expect(formatted.html).toBe("<p><strong>bold <em>italic <mark>highlight</mark></em></strong></p>");
  });

  it("keeps malformed and crossed delimiters literal", () => {
    for (const value of ["**unclosed", "**bold _crossed** text_", "==also unclosed"]) {
      const formatted = formatEmailBody(value);
      expect(formatted.plainText).toBe(value);
      expect(formatted.html).not.toContain("<strong>");
      expect(formatted.html).not.toContain("<em>");
      expect(formatted.html).not.toContain("<mark>");
    }
  });

  it("supports escaped marker characters and Unicode text", () => {
    const formatted = formatEmailBody("皆さん \\**literal\\** \\_name\\_");
    expect(formatted.plainText).toBe("皆さん **literal** _name_");
    expect(formatted.html).toContain("皆さん **literal** _name_");
  });

  it("escapes hostile text and never interprets arbitrary HTML", () => {
    const formatted = formatEmailBody("<script>alert('x')</script> & **safe**");
    expect(formatted.html).toContain("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;");
    expect(formatted.html).not.toContain("<script>");
    expect(formatted.plainText).toContain("<script>alert('x')</script>");
  });

  it("preserves paragraphs and groups contiguous bullet/number lines", () => {
    const value = "First line\r\nSecond line\r\n\r\n- one\n- two\n\n2. two\n4. four";
    const ast = parseEmailBody(value);
    expect(ast.map((block) => block.type)).toEqual(["paragraph", "unordered-list", "ordered-list"]);
    expect(emailBodyToPlainText(ast)).toBe("First line\nSecond line\n\n- one\n- two\n\n2. two\n4. four");
    expect(emailBodyToHtml(ast)).toContain("<ul><li>one</li><li>two</li></ul>");
    expect(emailBodyToHtml(ast)).toContain('<ol><li value="2">two</li><li value="4">four</li></ol>');
  });

  it("keeps ordinary plain bodies backward compatible and output deterministic", () => {
    const first = formatEmailBody("A plain body\nwith two lines");
    const second = formatEmailBody("A plain body\nwith two lines");
    expect(first.plainText).toBe("A plain body\nwith two lines");
    expect(first).toEqual(second);
  });

  it("fails closed for adversarial delimiter-heavy input without deep recursion", () => {
    const value = "**".repeat(50_000);
    const formatted = formatEmailBody(value);
    expect(formatted.plainText).toBe(value);
    expect(formatted.html).not.toContain("<strong>");
  });
});
