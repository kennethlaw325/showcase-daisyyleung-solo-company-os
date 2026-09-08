export const siteCopy = {
  zh: {
    nav: {
      product: "產品",
      modules: "三條管線",
      safety: "審批與安全",
      login: "開啟 OS",
      apply: "申請試用",
    },
    hero: {
      eyebrow: "為一人公司而設的工作系統",
      headline: "讓一人公司，\n開始像一間多人公司般運作。",
      body: "將零散的資料、AI 對話、電郵和任務，\n變成一條可追蹤、可審批、會從結果學習的工作流。",
      primary: "申請創始試用",
      secondary: "看看它如何運作",
      trust: "人工智能先準備，你親自審批；\n任何外部行動都不會靜默執行。",
    },
    problem: {
      kicker: "少一點散亂，多一點推進。",
      title: "你唔係欠多一個工具。\n你係欠一條完整閉環。",
      body: "一般人工智能幫你起草，任務工具幫你記低，電郵幫你執行；\n但脈絡、審批、結果同下一次改善，仍然散落喺唔同地方。",
    },
    command: {
      eyebrow: "今日工作台",
      title: "一打開，\n即知今日要推進甚麼。",
      body: "先處理待審批、受阻工作、可執行動作及待回顧結果；\n不是再給你一堆無優先次序的通知。",
    },
    modules: {
      eyebrow: "三條核心管線，共用一個工作核心",
      title: "由商業機會，\n到公司知識，\n再到品牌聲量。",
    },
    approval: {
      eyebrow: "先審批，後執行",
      title: "人工智能可以準備。\n決定權永遠留給你。",
      body: "你會看到即將採用的修訂稿、收件人、主旨和完整正文。\n任何修改都會令舊審批失效。",
    },
    learning: {
      eyebrow: "結果學習閉環",
      title: "完成不是終點。\n結果會令系統變得更懂你。",
      body: "記錄實際結果、有效與失效之處、阻礙、下一步、改善位與其他角度。\n可重用知識要經你確認，先會在下一項相關工作出現。",
    },
    trust: {
      eyebrow: "以信任為設計核心",
      title: "每個重要決定，\n都有清楚來龍去脈。",
    },
    cta: {
      eyebrow: "創始試用 · 8–12 個名額",
      title: "下個 Job，\n唔使再由零開始。",
      body: "現正邀請顧問、創作者及自由工作者參與第一輪設計夥伴計劃。",
      button: "申請試用",
      note: "暫不公開收費 · 逐位審核 · 無自動發送",
    },
  },
  en: {
    nav: {
      product: "Product",
      modules: "Three pipelines",
      safety: "Approval & safety",
      login: "Open OS",
      apply: "Request access",
    },
    hero: {
      eyebrow: "The operating system for a company of one",
      headline: "Let a company of one\noperate like a company of many.",
      body: "Turn scattered context, AI chats, email, and tasks into one traceable workflow that you approve—and that learns from real outcomes.",
      primary: "Request founding access",
      secondary: "See how it works",
      trust: "AI prepares.\nYou approve.\nExternal actions never happen silently.",
    },
    problem: {
      kicker: "Less scatter. More momentum.",
      title: "You don’t need another tool.\nYou need a complete loop.",
      body: "AI can make content, task apps can remember work, and email can execute it.\nNone of them protects the full chain of context, approval, outcome, and improvement.",
    },
    command: {
      eyebrow: "Today Command Centre",
      title: "Open it and know what deserves your attention.",
      body: "Approvals, blocked work, ready actions, and overdue outcomes rise first.\nNot another undifferentiated feed of notifications.",
    },
    modules: {
      eyebrow: "Three focused modules. One shared operating core.",
      title: "Revenue opportunities.\nOperating intelligence.\nBrand impact.",
    },
    approval: {
      eyebrow: "Approval-first by design",
      title: "AI can prepare.\nThe decision stays with you.",
      body: "See the exact artifact revision, recipient, subject, and body before anything leaves the portal.\nEvery edit invalidates the old approval.",
    },
    learning: {
      eyebrow: "Outcome Learning Loop",
      title: "Done is not the end.\nOutcomes make the system wiser.",
      body: "Capture the actual result, what worked, what failed, blockers, next action, improvements, and other angles.\nReusable learning only returns after you confirm it.",
    },
    trust: {
      eyebrow: "Built for trust",
      title: "Every important decision.\nIts full story stays visible.",
    },
    cta: {
      eyebrow: "Founding Pilot · 8–12 places",
      title: "Your next job\ndoesn’t have to start from scratch.",
      body: "We’re inviting consultants, creators, and freelancers to shape the first pilot.",
      button: "Request access",
      note: "No public pricing yet · Reviewed individually · No autonomous sending",
    },
  },
} as const;

export const moduleCopy = [
  {
    key: "growth",
    number: "01",
    accent: "violet",
    zh: {
      eyebrow: "商業增長與銷售轉化",
      title: "由開發商機，\n推進市場培育與成交。",
      body: "把潛在客戶、資格篩選、價值主張、內容與渠道、市場培育、銷售跟進和成交結果，串成一條可量度的增長管線。",
      flow: ["商機與客戶篩選", "市場定位與培育", "銷售提案與跟進", "成交結果與改善"],
    },
    en: {
      eyebrow: "Growth & Revenue",
      title: "From lead,\nto demand,\nto sale.",
      body: "Connect prospect qualification, positioning, content and channels, demand nurture, sales follow-up, and conversion outcomes in one measurable pipeline.",
      flow: ["Lead qualification", "Positioning & nurture", "Proposal & follow-up", "Conversion learning"],
    },
  },
  {
    key: "operations",
    number: "02",
    accent: "cyan",
    zh: {
      eyebrow: "商業洞察",
      title: "把市場與部門洞察，\n整理成清晰決策。",
      body: "把會議、市場趨勢、客戶回饋，以及銷售、產品、財務等部門洞察，整理成決策、責任、行動和可重用知識。",
      flow: ["會議與市場訊號", "跨部門洞察", "決策與責任", "結果與知識累積"],
    },
    en: {
      eyebrow: "Business Insights",
      title: "Turn signals into clear decisions.",
      body: "Connect meetings, market trends, customer feedback, and cross-functional insight from sales, product, and finance to decisions, owners, action, and reusable knowledge.",
      flow: ["Signals & meetings", "Cross-team insight", "Decisions & owners", "Operational learning"],
    },
  },
  {
    key: "intelligence",
    number: "03",
    accent: "amber",
    zh: {
      eyebrow: "品牌傳訊與公關",
      title: "把可靠情報，\n轉成對準受眾的公關內容。",
      body: "先整合有來源、限制與聲譽風險的核心判斷，再按媒體、客戶、合作夥伴或公眾，制定訊息策略、內容和披露邊界。",
      flow: ["來源與聲譽風險", "受眾與訊息策略", "公關內容與媒體提案", "成效與聲量學習"],
    },
    en: {
      eyebrow: "Brand Communications & PR",
      title: "Source-led PR for every audience.",
      body: "Build one sourced view of the facts, limits, and reputation risks, then shape the message, format, pitch, and disclosure boundary for media, clients, partners, or the public.",
      flow: ["Sources & reputation risk", "Audience & message", "PR content & pitches", "Impact learning"],
    },
  },
] as const;
