"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocale } from "@/src/components/locale-provider";
import { PILOT_POLICY_VERSION } from "@/src/lib/legal/pilot-policy";

type SubmissionState = "idle" | "submitting" | "success" | "error";

const copy = {
  zh: {
    name: "名稱",
    namePlaceholder: "Demo User",
    email: "電郵地址",
    emailPlaceholder: "you@company.com",
    role: "哪一項最貼近你的工作？",
    rolePlaceholder: "請選擇",
    consultant: "顧問",
    creator: "創作者",
    freelancer: "自由工作者",
    pain: "目前甚麼工作最容易失去焦點？",
    painPlaceholder: "請告訴我們，工作在哪裏失去動力、背景脈絡或責任感……",
    desiredOutcome: "怎樣的成果會令這次試用值得？",
    desiredOutcomePlaceholder: "請分享一項你希望每週達成的具體成果……",
    website: "網站",
    consent: "我同意就創始試用聯絡我，並已閱讀",
    privacy: "私隱聲明",
    terms: "服務條款",
    consentJoin: "及",
    consentEnd: "。",
    submitting: "提交中……",
    successButton: "已收到申請 ✓",
    submitButton: "申請創始試用 ↗",
    successMessage: "已收到申請。我們會親自審閱。",
    errorMessage: "未能提交申請，請稍後再試；你已填寫的內容會保留。",
    rateLimitMessage: "提交次數已達上限，請稍後再試；你已填寫的內容會保留。",
    demoNote: "示範模式：這個展示版沒有後端，表單只會在瀏覽器內確認，不會送出或儲存任何資料。",
    demoSuccess: "示範模式：已在瀏覽器內確認收到申請，沒有任何資料被送出或儲存。真實版本會由人手逐份審閱。",
    note: "每份申請均會個別審閱。提交此表格並不會建立帳戶。",
  },
  en: {
    name: "Name",
    namePlaceholder: "Demo User",
    email: "Email address",
    emailPlaceholder: "you@company.com",
    role: "Which best describes your work?",
    rolePlaceholder: "Select one",
    consultant: "Consultant",
    creator: "Creator",
    freelancer: "Freelancer",
    pain: "What currently feels most scattered?",
    painPlaceholder: "Tell us where work loses momentum, context, or accountability…",
    desiredOutcome: "What outcome would make this pilot worthwhile?",
    desiredOutcomePlaceholder: "One concrete weekly result you want to achieve…",
    website: "Website",
    consent: "I agree to be contacted about the founding pilot and have read the",
    privacy: "privacy note",
    terms: "terms",
    consentJoin: "and",
    consentEnd: ".",
    submitting: "Submitting…",
    successButton: "Application received ✓",
    submitButton: "Request founding access ↗",
    successMessage: "Application received. We’ll review it personally.",
    errorMessage: "Unable to submit your application. Please try again; your entries are preserved.",
    rateLimitMessage: "The application limit was reached. Please try again later; your entries are preserved.",
    demoNote: "Demo mode: this showcase build has no backend. The form confirms in your browser only; nothing is sent or stored.",
    demoSuccess: "Demo mode: your application was confirmed in the browser only. Nothing was sent or stored. The real build reviews every application by hand.",
    note: "Applications are reviewed individually. Submitting this form does not create an account.",
  },
} as const;

function createSubmissionId() {
  if (typeof globalThis.crypto !== "undefined") {
    if (typeof globalThis.crypto.randomUUID === "function") return globalThis.crypto.randomUUID();
    if (typeof globalThis.crypto.getRandomValues === "function") {
      const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
  }
  const random = Math.floor(Math.random() * 0x1_0000_0000).toString(16).padStart(8, "0");
  return `${Date.now().toString(16).padStart(8, "0").slice(-8)}-${random.slice(0, 4)}-4${random.slice(4, 7)}-8${random.slice(0, 3)}-${random}${random.slice(0, 4)}`;
}

export function RequestAccessForm({ demo = false }: { demo?: boolean }) {
  const { locale } = useLocale();
  const languageCopy = locale === "zh-Hant" ? copy.zh : copy.en;
  const [state, setState] = useState<SubmissionState>("idle");
  const [message, setMessage] = useState("");
  const [submissionId, setSubmissionId] = useState(createSubmissionId);
  const previousLocale = useRef(locale);

  useEffect(() => {
    if (previousLocale.current === locale) return;
    previousLocale.current = locale;
    setSubmissionId(createSubmissionId());
    setState("idle");
    setMessage("");
  }, [locale]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    const formElement = event.currentTarget;
    event.preventDefault();
    setState("submitting");
    setMessage("");
    const form = new FormData(formElement);
    const payload = {
      name: form.get("name"),
      email: form.get("email"),
      role: form.get("role"),
      pain: form.get("pain"),
      desiredOutcome: form.get("desiredOutcome"),
      locale,
      consent: form.get("consent") === "on",
      consentVersion: form.get("consentVersion") ?? PILOT_POLICY_VERSION,
      submissionId: form.get("submissionId") ?? submissionId,
      website: form.get("website"),
    };

    if (demo) {
      setState("success");
      setMessage(languageCopy.demoSuccess);
      formElement.reset();
      return;
    }

    try {
      const response = await fetch("/api/pilot-applications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (response.status === 429) {
        setState("error");
        setMessage(languageCopy.rateLimitMessage);
        return;
      }
      if (!response.ok) throw new Error(languageCopy.errorMessage);
      setState("success");
      setMessage(languageCopy.successMessage);
      formElement.reset();
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : languageCopy.errorMessage);
    }
  }

  return (
    <form className="pilot-form" key={`${locale}:${submissionId}`} onSubmit={submit}>
      <input type="hidden" name="submissionId" value={submissionId} readOnly />
      {demo ? <p className="form-message is-demo" role="note">{languageCopy.demoNote}</p> : null}
      <input type="hidden" name="consentVersion" value={PILOT_POLICY_VERSION} readOnly />
      <div className="field-row">
        <label><span>{languageCopy.name}</span><input name="name" required autoComplete="name" placeholder={languageCopy.namePlaceholder} maxLength={80} /></label>
        <label><span>{languageCopy.email}</span><input name="email" type="email" required autoComplete="email" placeholder={languageCopy.emailPlaceholder} maxLength={200} /></label>
      </div>
      <label>
        <span>{languageCopy.role}</span>
        <select name="role" required defaultValue="">
          <option value="" disabled>{languageCopy.rolePlaceholder}</option>
          <option value="consultant">{languageCopy.consultant}</option>
          <option value="creator">{languageCopy.creator}</option>
          <option value="freelancer">{languageCopy.freelancer}</option>
        </select>
      </label>
      <label>
        <span>{languageCopy.pain}</span>
        <textarea name="pain" required rows={4} maxLength={1200} placeholder={languageCopy.painPlaceholder} />
      </label>
      <label>
        <span>{languageCopy.desiredOutcome}</span>
        <textarea name="desiredOutcome" required rows={4} maxLength={1200} placeholder={languageCopy.desiredOutcomePlaceholder} />
      </label>
      <label className="honeypot" aria-hidden="true">
        {languageCopy.website}<input name="website" tabIndex={-1} autoComplete="off" />
      </label>
      <label className="consent-field">
        <input name="consent" type="checkbox" required />
        <span>
          {languageCopy.consent} <Link href={`/privacy?lang=${locale}`}>{languageCopy.privacy}</Link> {languageCopy.consentJoin} <Link href={`/terms?lang=${locale}`}>{languageCopy.terms}</Link>{languageCopy.consentEnd}
        </span>
      </label>
      <button className="form-submit" type="submit" disabled={state === "submitting" || state === "success"}>
        {state === "submitting" ? languageCopy.submitting : state === "success" ? languageCopy.successButton : languageCopy.submitButton}
      </button>
      {message ? <p className={`form-message is-${state}`} role={state === "error" ? "alert" : "status"}>{state === "success" ? (demo ? languageCopy.demoSuccess : languageCopy.successMessage) : message}</p> : null}
      <small>{languageCopy.note}</small>
    </form>
  );
}
