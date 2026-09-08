import type { Metadata } from "next";
import Link from "next/link";
import { Localized } from "@/src/components/locale-provider";

export const metadata: Metadata = { title: "More", robots: { index: false, follow: false } };

export default function MorePage() {
  const links = [
    { href: "/app/clients", title: "Case overview", zhTitle: "個案一覽", body: "Search and filter cases by client and category.", zhBody: "按客戶及類別搜尋和篩選個案。", icon: "◎" },
    { href: "/app/workflows", title: "My Workflow", zhTitle: "我的工作流", body: "Save a useful Custom setup and reuse it next time.", zhBody: "儲存實用的自定義設定，下次可再次使用。", icon: "⌘" },
    { href: "/app/intakes", title: "Initial Inputs", zhTitle: "初始輸入", body: "Review immutable exact snapshots and clearly marked legacy reconstructions.", zhBody: "查看不可修改的完整快照及清楚標示的舊資料重建。", icon: "▤" },
    { href: "/app/settings/connections", title: "Connections", zhTitle: "連接設定", body: "Review connector scope and reversible access.", zhBody: "查看連接範圍及可撤銷的存取權。", icon: "◇" },
  ];
  return <main className="portal-page more-page">
    <header className="portal-page-header compact"><div><Localized zh={<><p className="portal-kicker">更多</p><h1>更多。</h1><p>從這裡前往個案一覽、我的工作流、初始輸入及連接設定。</p></>} en={<><p className="portal-kicker">More</p><h1>More.</h1><p>Reach the case overview, My Workflow, initial inputs, and connection settings from one small hub.</p></>} /></div></header>
    <nav className="more-link-grid" aria-label="More portal destinations">
      {links.map((item) => <Link className="more-link-card portal-panel" href={item.href} key={item.href}><span className="more-link-icon" aria-hidden="true">{item.icon}</span><div><Localized zh={<><h2>{item.zhTitle}</h2><p>{item.zhBody}</p></>} en={<><h2>{item.title}</h2><p>{item.body}</p></>} /></div><span aria-hidden="true">→</span></Link>)}
    </nav>
  </main>;
}
