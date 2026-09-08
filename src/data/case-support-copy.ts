export const caseSupportCopy = {
  "zh-Hant": {
    sourcePanel: {
      eyebrow: "來源資料",
      title: "來源",
      emptyTitle: "尚未加入來源",
      emptyBody: "加入筆記或私人檔案，讓下一份修訂稿有清楚依據。",
      pastedNotes: "貼上的筆記",
      publicHttps: "公開 HTTPS",
      extracted: "已擷取",
      captured: "已擷取",
      registered: "已登記",
    },
    learningPanel: {
      eyebrow: "相關學習",
      title: "建議",
      emptyTitle: "暫未有相符的學習",
      emptyBody: "完成結果回顧並確認可重用的學習後，相關建議會顯示在這裡。",
      safetyNote: "只供你審閱，系統不會自動套用。",
      sections: { learning: "建議", applicability: "適用情境", evidence: "依據", hypothesis: "可測試方向", nextAction: "下一步", improvements: "可改善" },
      tags: {
        growth: "增長",
        operations: "營運",
        intelligence: "情報",
        approval: "審批",
      },
    },
    upload: {
      limitReached: "已達來源上限",
      addFiles: "加入私人檔案",
      helper: (remaining: number) => `PDF、DOCX、PPTX、TXT 或 MD · 每個檔案最多 10 MB · 尚可加入 ${remaining} 個`,
      tooMany: (remaining: number) => `這個工作尚可加入 ${remaining} 個來源。`,
      unsupported: (filename: string) => `${filename} 並非支援的 PDF、DOCX、PPTX、TXT 或 MD 檔案。`,
      legacyPowerPoint: (filename: string) => `${filename} 是舊版 PowerPoint，請先另存為未加密的 PPTX。`,
      invalidSize: (filename: string) => `${filename} 必須介乎 1 byte 至 10 MB。`,
      demo: "示範模式不會儲存上載的檔案。",
      uploading: (count: number) => `正在上載 ${count} 個來源⋯`,
      prepareFailed: (filename: string) => `未能準備上載 ${filename}。`,
      uploadFailed: (filename: string) => `未能上載 ${filename}。`,
      extractionFailed: (filename: string) => `${filename} 已儲存，但未能擷取內容。`,
      extractionError: (filename: string, code?: string) => code === "powerpoint_binary_or_encrypted_unsupported"
        ? `${filename} 是舊版或已加密的 PowerPoint，請先另存為未加密的 PPTX。`
        : code === "pptx_parse_failed"
          ? `${filename} 的 PPTX 內容無法讀取，請確認檔案未損壞後再試。`
          : code === "pptx_parser_unavailable"
            ? `${filename} 的 PPTX 讀取器暫時不可用，請稍後再試。`
            : `${filename} 已儲存，但未能擷取內容。`,
      updated: "來源資料已更新。",
      genericError: "未能完成來源上載。",
    },
    regenerate: {
      idle: "產生新修訂稿",
      working: "正在產生⋯",
      demo: "示範模式已模擬產生一份以來源為依據的新修訂稿。",
      demoRevision: (revision: number) => `示範模式已模擬產生第 ${revision} 稿；沒有任何資料被儲存。`,
      success: "新修訂稿已準備好，可供審閱。",
      successRevision: (revision: number) => `第 ${revision} 稿已準備好，可供審閱。`,
      error: "未能產生新修訂稿。",
      missingSource: "加入至少一個已擷取來源後，才可產生下一份修訂稿。",
      closed: "修訂階段已關閉；你仍可加入來源作記錄，但不能產生新修訂稿。",
    },
  },
  en: {
    sourcePanel: {
      eyebrow: "Source pack",
      title: "Sources",
      emptyTitle: "No sources yet",
      emptyBody: "Add notes or private files to ground the next revision.",
      pastedNotes: "Pasted notes",
      publicHttps: "Public HTTPS",
      extracted: "extracted",
      captured: "captured",
      registered: "registered",
    },
    learningPanel: {
      eyebrow: "Relevant learning",
      title: "Suggestions",
      emptyTitle: "No matching learning yet",
      emptyBody: "Relevant suggestions will appear after an outcome review confirms reusable learning.",
      safetyNote: "For your review only. Suggestions are never applied automatically.",
      sections: { learning: "Suggestion", applicability: "When it applies", evidence: "Evidence", hypothesis: "What to test", nextAction: "Next step", improvements: "What to improve" },
      tags: {
        growth: "growth",
        operations: "operations",
        intelligence: "intelligence",
        approval: "approval",
      },
    },
    upload: {
      limitReached: "Source limit reached",
      addFiles: "Add private files",
      helper: (remaining: number) => `PDF, DOCX, PPTX, TXT or MD · 10 MB each · ${remaining} slot${remaining === 1 ? "" : "s"} left`,
      tooMany: (remaining: number) => `You can add ${remaining} more source${remaining === 1 ? "" : "s"} to this case.`,
      unsupported: (filename: string) => `${filename} is not a supported PDF, DOCX, PPTX, TXT, or MD file.`,
      legacyPowerPoint: (filename: string) => `${filename} is a legacy PowerPoint file. Save it as an unencrypted PPTX before uploading.`,
      invalidSize: (filename: string) => `${filename} must be between 1 byte and 10 MB.`,
      demo: "Demo mode does not store uploaded files.",
      uploading: (count: number) => `Uploading ${count} source${count === 1 ? "" : "s"}…`,
      prepareFailed: (filename: string) => `Could not prepare ${filename}.`,
      uploadFailed: (filename: string) => `Could not upload ${filename}.`,
      extractionFailed: (filename: string) => `${filename} was stored but could not be extracted.`,
      extractionError: (filename: string, code?: string) => code === "powerpoint_binary_or_encrypted_unsupported"
        ? `${filename} is a legacy or encrypted PowerPoint file. Save it as an unencrypted PPTX first.`
        : code === "pptx_parse_failed"
          ? `${filename} could not be read as a PPTX. Check that the file is not corrupted and try again.`
          : code === "pptx_parser_unavailable"
            ? `The PPTX reader is temporarily unavailable for ${filename}. Try again later.`
            : `${filename} was stored but could not be extracted.`,
      updated: "Source pack updated.",
      genericError: "The source upload could not be completed.",
    },
    regenerate: {
      idle: "Generate new revision",
      working: "Generating…",
      demo: "Demo mode simulated a new source-grounded revision.",
      demoRevision: (revision: number) => `Demo mode simulated revision ${revision}; nothing was saved.`,
      success: "New revision ready for review.",
      successRevision: (revision: number) => `Revision ${revision} ready for review.`,
      error: "Could not generate a new revision.",
      missingSource: "Add at least one extracted source before generating another revision.",
      closed: "The revision stage is closed; you can still add sources for the record, but a new revision cannot be generated.",
    },
  },
} as const;
