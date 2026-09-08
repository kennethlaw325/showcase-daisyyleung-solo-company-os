// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClientSelector } from "../src/components/portal/client-selector";
import { ClientManager } from "../src/components/portal/client-manager";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ClientSelector", () => {
  it("always renders the optional selector and creates a client inline", async () => {
    const onChange = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ client: { id: "client-2", name: "Northstar", company: "Northstar Studio" } }), { status: 201 })));
    render(<ClientSelector value="" onChange={onChange} clients={[]} locale="en" />);

    expect(screen.getByLabelText("Link client (optional)")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Add new client/i }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Northstar" } });
    fireEvent.change(screen.getByLabelText("Company (optional)"), { target: { value: "Northstar Studio" } });
    fireEvent.click(screen.getByRole("button", { name: /^Add client$/i }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith("client-2"));
    expect(fetch).toHaveBeenCalledWith("/api/clients", expect.objectContaining({ method: "POST" }));
  });
});

describe("case directory", () => {
  it("filters by category and client and keeps an unmistakable case action", () => {
    render(<ClientManager locale="en" initialClients={[{ id: "client-1", name: "Northstar", company: "Studio", status: "active", notes: "" }]} initialCases={[
      { id: "case-1", title: "Growth launch", module: "growth", status: "draft", client_id: "client-1", updated_at: "2026-08-27T09:00:00.000Z" },
      { id: "case-2", title: "Ops review", module: "operations", status: "blocked", client_id: null, updated_at: "2026-08-26T09:00:00.000Z" },
    ]} />);

    expect(screen.getByRole("heading", { name: "Search cases" })).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Open case" })).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "module:growth" } });
    expect(screen.getAllByRole("link", { name: "Open case" })).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Client"), { target: { value: "none" } });
    expect(screen.getByText("No cases match these filters.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "all" } });
    expect(screen.getByRole("link", { name: "Open case" }).getAttribute("href")).toBe("/app/cases/case-2");
  });

  it("automatically promotes a bound custom workflow into a visible category", () => {
    render(<ClientManager locale="zh-Hant" initialClients={[]} initialCases={[
      { id: "case-custom", title: "每週跟進", module: "growth", status: "draft", workflow_stream_id: "stream-1", workflow_stream_group_id: "group-1", workflow_stream_name: "每週客戶跟進" },
      { id: "case-core", title: "品牌更新", module: "intelligence", status: "working" },
    ]} />);

    expect(screen.getByRole("group", { name: "自定義工作流" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "每週客戶跟進" })).toBeTruthy();
    expect(screen.getAllByText("1 個案")).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("類別"), { target: { value: "workflow:group-1" } });
    expect(screen.getAllByRole("link", { name: "開啟個案" })).toHaveLength(1);
    expect(screen.getByText("每週跟進")).toBeTruthy();
  });
});
