"use client";

import { useState } from "react";

const demoApplications = [
  { id: "demo-1", name: "Alex Morgan", role: "Consultant", email: "alex@example.com", pain: "Client context disappears between discovery, proposal, and follow-up.", submitted: "Today · 09:42" },
  { id: "demo-2", name: "Mina Cho", role: "Creator", email: "mina@example.com", pain: "Content research produces ideas but rarely becomes a consistent operating rhythm.", submitted: "Yesterday · 18:10" },
] as const;

export type PilotApplicationSummary = {
  id: string;
  name: string;
  role: string;
  email: string;
  pain: string;
  submitted: string;
};

export function AdminPilotTable({ demo = false, applications = demoApplications }: { demo?: boolean; applications?: readonly PilotApplicationSummary[] }) {
  const [approved, setApproved] = useState<string[]>([]);

  async function approve(id: string, email: string) {
    if (demo) {
      setApproved((current) => [...current, id]);
      return;
    }
    const response = await fetch("/api/admin/invitations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ applicationId: id, email }) });
    if (response.ok) setApproved((current) => [...current, id]);
  }

  return (
    <div className="admin-application-list">
      {applications.map((item) => (
        <article className="admin-application" key={item.id}>
          <div className="applicant-avatar">{item.name.split(" ").map((part) => part[0]).join("")}</div>
          <div className="applicant-main"><div><span>{item.role}</span><small>{item.submitted}</small></div><h2>{item.name}</h2><a href={`mailto:${item.email}`}>{item.email}</a><p>{item.pain}</p></div>
          <div className="applicant-actions">{approved.includes(item.id) ? <span className="connection-ok"><i />Invitation created</span> : <><button type="button">Not now</button><button className="portal-primary-button" type="button" onClick={() => approve(item.id, item.email)}>Approve & invite</button></>}</div>
        </article>
      ))}
    </div>
  );
}
