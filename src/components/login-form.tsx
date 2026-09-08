"use client";

import { useState, type FormEvent } from "react";
import { useLocale } from "@/src/components/locale-provider";

const copy = {
  zh: {
    title: "歡迎回來。",
    intro: "請輸入收到 Solo Company OS 邀請的電郵地址。",
    email: "受邀電郵地址",
    placeholder: "you@company.com",
    sending: "安全連結傳送中……",
    sent: "請查看收件箱 ✓",
    requestAnother: "重新申請安全連結",
    submit: "以電郵繼續",
    sentMessage: "請查看收件箱，並在同一個瀏覽器使用最新的安全登入連結。",
    linkExpiredMessage: "這條登入連結可能已過期或使用過。請在上方重新申請，並使用同一個瀏覽器收到的最新連結。",
    genericErrorMessage: "未能完成登入。\n請在上方重新申請連結，並使用同一個瀏覽器收到的最新連結。",
    errorMessage: "未能申請登入連結，請稍後再試。",
    demoNote: "示範模式：這個展示版沒有後端，不會實際寄出登入連結。示範工作空間已開放，可直接前往「開啟 OS」試用。",
    demoSent: "示範模式：登入連結不會實際寄出。示範工作空間已開放，可直接按上方「返回產品頁」再選「開啟 OS」。",
    note: "每條連結只可使用一次。請在同一個瀏覽器使用最新連結；如連結過期或使用過，可在上方重新申請。毋須密碼，只有獲批的試用邀請才可登入。",
  },
  en: {
    title: "Welcome back.",
    intro: "Enter the email that received your Solo Company OS invitation.",
    email: "Invited email",
    placeholder: "you@company.com",
    sending: "Sending secure link…",
    sent: "Check your inbox ✓",
    requestAnother: "Request another secure link",
    submit: "Continue with email",
    sentMessage: "Check your inbox, then use the newest secure sign-in link in this same browser.",
    linkExpiredMessage: "That sign-in link may have expired or already been used. Request another above, then use the newest link in this same browser.",
    genericErrorMessage: "We couldn’t complete sign-in.\nRequest another link above, then use the newest link in this same browser.",
    errorMessage: "Unable to request a sign-in link. Please try again.",
    demoNote: "Demo mode: this showcase build has no backend, so no sign-in email is sent. The demo workspace is already open — open the OS directly.",
    demoSent: "Demo mode: no sign-in link is sent. The demo workspace is already open — go back to the product page and choose “Open OS”.",
    note: "Each link works once. Use the newest link in this same browser; if it expires or has already been used, request another above. No password required—access is limited to approved pilot invitations.",
  },
} as const;

export type LoginInitialError = "link_expired" | "generic";

type LoginFormProps = {
  initialError?: LoginInitialError;
  demo?: boolean;
};

export function LoginForm({ initialError, demo = false }: LoginFormProps) {
  const { locale } = useLocale();
  const languageCopy = locale === "zh-Hant" ? copy.zh : copy.en;
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">(initialError ? "error" : "idle");
  const [message, setMessage] = useState("");
  const initialErrorMessage = initialError === "link_expired" ? languageCopy.linkExpiredMessage : initialError === "generic" ? languageCopy.genericErrorMessage : "";
  const visibleMessage = message || (state === "error" ? initialErrorMessage : "");
  const canRequestAnother = state === "sent" || (state === "error" && Boolean(initialError));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("sending");
    setMessage("");
    const email = new FormData(event.currentTarget).get("email");

    if (demo) {
      setState("sent");
      setMessage(languageCopy.demoSent);
      return;
    }

    try {
      const response = await fetch("/api/auth/magic-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, next: "/app" }),
      });
      if (!response.ok) throw new Error(languageCopy.errorMessage);
      setState("sent");
      setMessage(languageCopy.sentMessage);
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : languageCopy.errorMessage);
    }
  }

  return (
    <form className="pilot-form login-form" onSubmit={submit}>
      <div className="login-symbol" aria-hidden="true">→</div>
      <div>
        <h2>{languageCopy.title}</h2>
        <p>{languageCopy.intro}</p>
      </div>
      {demo ? <p className="form-message is-demo" role="note">{languageCopy.demoNote}</p> : null}
      <label><span>{languageCopy.email}</span><input name="email" type="email" autoComplete="email" required placeholder={languageCopy.placeholder} /></label>
      <button className="form-submit" type="submit" disabled={state === "sending"}>
        {state === "sending" ? languageCopy.sending : canRequestAnother ? languageCopy.requestAnother : languageCopy.submit}
      </button>
      {visibleMessage ? <p className={`form-message is-${state}`} role="status">{state === "sent" ? (demo ? languageCopy.demoSent : languageCopy.sentMessage) : visibleMessage}</p> : null}
      <small>{languageCopy.note}</small>
    </form>
  );
}
