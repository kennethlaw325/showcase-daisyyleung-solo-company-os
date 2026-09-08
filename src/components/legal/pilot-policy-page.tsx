import Link from "next/link";
import { policyCopy, type PilotPolicyDocument, type PilotPolicyLocale } from "@/src/lib/legal/pilot-policy";

type PilotPolicyPageProps = {
  document: PilotPolicyDocument;
  locale: PilotPolicyLocale;
};

export function PilotPolicyPage({ document, locale }: PilotPolicyPageProps) {
  const copy = policyCopy(document, locale);
  const otherLocale: PilotPolicyLocale = locale === "zh-Hant" ? "en" : "zh-Hant";
  const path = document === "privacy" ? "/privacy" : "/terms";
  const otherLabel = otherLocale === "zh-Hant" ? "繁體中文" : "English";
  const backLabel = locale === "zh-Hant" ? "返回 Solo Company OS" : "← Solo Company OS";

  return (
    <main className="legal-page">
      <header className="legal-page-header">
        <Link href="/">{backLabel}</Link>
        <nav aria-label={locale === "zh-Hant" ? "語言" : "Language"}>
          <Link href={`${path}?lang=${locale}`}>{locale === "zh-Hant" ? "繁體中文" : "English"}</Link>
          <span aria-hidden="true"> · </span>
          <Link href={`${path}?lang=${otherLocale}`}>{otherLabel}</Link>
        </nav>
      </header>
      <p className="section-eyebrow">{copy.eyebrow}</p>
      <h1>{copy.title}</h1>
      <p className="legal-intro">{copy.reviewNotice}</p>
      <p className="legal-intro">{copy.intro}</p>
      {copy.sections.map((section) => (
        <section key={section.heading}>
          <h2>{section.heading}</h2>
          <p>{section.body}</p>
        </section>
      ))}
      <footer className="legal-page-footer">
        <Link href={`/privacy?lang=${locale}`}>{locale === "zh-Hant" ? "私隱聲明" : "Privacy"}</Link>
        <Link href={`/terms?lang=${locale}`}>{locale === "zh-Hant" ? "服務條款" : "Terms"}</Link>
      </footer>
    </main>
  );
}
