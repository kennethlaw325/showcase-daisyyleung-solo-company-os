"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/src/components/locale-provider";
import { getPortalCopy } from "@/src/lib/i18n/portal-copy";

type OutcomeSelectOption = { value: string; label: string };

function OutcomeSelect({ name, labelId, defaultValue, options, onChange }: { name: string; labelId: string; defaultValue: string; options: OutcomeSelectOption[]; onChange?: (value: string) => void }) {
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const selectedOption = options[selectedIndex];

  useEffect(() => {
    function closeOnOutsidePointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, []);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => optionRefs.current[selectedIndex]?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open, selectedIndex]);

  function choose(nextValue: string) {
    setValue(nextValue);
    onChange?.(nextValue);
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function moveFromOption(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(options[index].value);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }

    const nextIndex = event.key === "ArrowDown"
      ? Math.min(options.length - 1, index + 1)
      : event.key === "ArrowUp"
        ? Math.max(0, index - 1)
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? options.length - 1
            : -1;

    if (nextIndex >= 0) {
      event.preventDefault();
      optionRefs.current[nextIndex]?.focus();
    }
  }

  return (
    <div className="outcome-select" ref={rootRef}>
      <input name={name} type="hidden" value={value} />
      <button
        ref={triggerRef}
        className="outcome-select-trigger"
        type="button"
        aria-labelledby={`${labelId} ${menuId}-value`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key) && !open) {
            event.preventDefault();
            setOpen(true);
          }
          if (event.key === "Escape" && open) {
            event.preventDefault();
            setOpen(false);
          }
        }}
      >
        <span id={`${menuId}-value`}>{selectedOption.label}</span>
        <i aria-hidden="true">⌄</i>
      </button>
      {open ? (
        <div className="outcome-select-menu" id={menuId} role="listbox" aria-labelledby={labelId}>
          {options.map((option, index) => (
            <button
              ref={(element) => { optionRefs.current[index] = element; }}
              className="outcome-select-option"
              type="button"
              role="option"
              aria-selected={option.value === value}
              key={option.value}
              onClick={() => choose(option.value)}
              onKeyDown={(event) => moveFromOption(event, index)}
            >
              <span>{option.label}</span>
              <i aria-hidden="true">{option.value === value ? "✓" : ""}</i>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function OutcomeForm({ demo = false, caseId = "studio-retro", title = "Studio intelligence review", moduleLabel = "Business Insights", moduleKey }: { demo?: boolean; caseId?: string; title?: string; moduleLabel?: string; moduleKey?: "growth" | "operations" | "intelligence" }) {
  const { locale, localeSaving } = useLocale();
  const router = useRouter();
  const formId = useId();
  const copy = getPortalCopy(locale).outcomeForm;
  const resolvedModuleLabel = moduleKey ? getPortalCopy(locale).today.modules[moduleKey] : moduleLabel;
  const modulePresentation = moduleKey
    ? {
      growth: { accent: "violet", number: "01" },
      operations: { accent: "cyan", number: "02" },
      intelligence: { accent: "amber", number: "03" },
    }[moduleKey]
    : { accent: "cyan", number: "02" };
  const confidenceLabelId = `${formId}-confidence-label`;
  const learningDispositionLabelId = `${formId}-learning-disposition-label`;
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");
  const [learningDisposition, setLearningDisposition] = useState<"keep" | "adapt" | "discard">("keep");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("saving");
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    if (demo) {
      window.setTimeout(() => { setState("saved"); setMessage(copy.demoSaved); }, 600);
      return;
    }
    try {
      const response = await fetch(`/api/cases/${caseId}/outcome`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const body = (await response.json()) as { error?: string; learningRequested?: boolean; learningGenerated?: boolean; learningApproval?: "approved_for_reuse" | "pending_review" | "not_proposed" };
      if (!response.ok) throw new Error(body.error ?? copy.error);
      setState("saved");
      setMessage(body.learningGenerated === true
        ? body.learningApproval === "approved_for_reuse" ? copy.adaptedSavedBody : copy.savedBody
        : body.learningRequested === false
          ? locale === "zh-Hant"
            ? "結果已記錄，未要求產生可重用學習。"
            : "Outcome captured. No reusable AI learning was requested."
          : locale === "zh-Hant"
            ? "結果已記錄，但未能產生可重用學習。"
            : "Outcome captured, but reusable AI learning was not generated.");
      router.refresh();
    } catch (reason) {
      setState("error");
      setMessage(reason instanceof Error ? reason.message : copy.error);
    }
  }

  return (
    <form className="outcome-form portal-panel" onSubmit={submit}>
      <div className="outcome-form-heading"><div><span className={`case-module-mark ${modulePresentation.accent}`}>{modulePresentation.number}</span><div><p className="portal-kicker">{resolvedModuleLabel}</p><h2>{title}</h2></div></div><span className="case-status status-outcome_pending"><i />{copy.outcomeDue}</span></div>
      <div className="outcome-grid">
        <label><span>{copy.expected}</span><textarea name="expectedResult" required rows={3} defaultValue={locale === "zh-Hant" ? "所有客戶交接都有一位負責人及已確認的到期日。" : "All client handoffs have one owner and a confirmed due date."} /></label>
        <label><span>{copy.actual}</span><textarea name="actualResult" required rows={3} placeholder={copy.actualPlaceholder} /></label>
        <label><span>{copy.evidence}</span><textarea name="evidence" required rows={3} placeholder={copy.evidencePlaceholder} /></label>
        <div className="outcome-choice-field"><span id={confidenceLabelId}>{copy.confidence}</span><OutcomeSelect name="confidence" labelId={confidenceLabelId} defaultValue="medium" options={[{ value: "low", label: copy.low }, { value: "medium", label: copy.medium }, { value: "high", label: copy.high }]} /></div>
        <label><span>{copy.worked}</span><textarea name="whatWorked" required rows={3} /></label>
        <label><span>{copy.failed}</span><textarea name="whatFailed" required rows={3} /></label>
        <label><span>{copy.blockers}</span><textarea name="blockers" required rows={3} /></label>
        <label><span>{copy.nextAction}</span><textarea name="nextAction" required rows={3} /></label>
        <label><span>{copy.improvements}</span><textarea name="improvements" required rows={3} /></label>
        <label><span>{copy.angles}</span><textarea name="otherAngles" required rows={3} /></label>
        <label><span>{copy.followUp}</span><input name="followUpDate" type="date" required /></label>
        <div className="outcome-choice-field"><span id={learningDispositionLabelId}>{copy.disposition}</span><OutcomeSelect name="learningDisposition" labelId={learningDispositionLabelId} defaultValue="keep" onChange={(value) => setLearningDisposition(value as "keep" | "adapt" | "discard")} options={[{ value: "keep", label: copy.keep }, { value: "adapt", label: copy.adapt }, { value: "discard", label: copy.discard }]} /></div>
        {learningDisposition !== "discard" ? <>
          <label><span>{learningDisposition === "adapt" ? copy.learningCandidate : copy.learningNote}</span><textarea name={learningDisposition === "adapt" ? "learningCandidate" : "learningNote"} required={learningDisposition === "adapt"} rows={3} placeholder={learningDisposition === "adapt" ? copy.candidatePlaceholder : copy.notePlaceholder} /></label>
          {learningDisposition === "adapt" ? <>
            <label><span>{copy.learningApplicability}</span><textarea name="learningApplicability" required rows={2} placeholder={copy.applicabilityPlaceholder} /></label>
            <label className="outcome-checkbox-field"><input name="approveAdaptedLearning" type="checkbox" value="true" required /><span>{copy.approveAdaptedLearning}</span></label>
          </> : null}
        </> : <p className="fieldset-note">{copy.discardBody}</p>}
      </div>
      <div className="form-action-bar"><div><strong>{copy.closesLoop}</strong><span>{copy.needsConfirmation}</span></div><button className="portal-primary-button" type="submit" disabled={state === "saving" || state === "saved" || localeSaving}>{state === "saving" ? copy.learning : state === "saved" ? copy.saved : copy.submit}</button></div>
      {message ? <p className={`form-message is-${state}`} role="status">{message}</p> : null}
    </form>
  );
}
