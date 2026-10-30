import { describe, expect, it } from "vitest";
import { check, money, type RuleContext } from "../src/rules.js";

function ctx(over: Partial<RuleContext> = {}): RuleContext {
  return {
    controls: [
      { id: "1", tag: "button", role: "button", name: "Pay bill" },
      { id: "2", tag: "input", role: "textbox", name: "Password", type: "password", password: true },
      { id: "3", tag: "a", role: "link", name: "Billing history" },
      { id: "4", tag: "input", role: "textbox", name: "Account nickname" },
      { id: "5", tag: "input", role: "textbox", name: "Name on card", autocomplete: "cc-name" },
    ],
    blockers: { captcha: false, password: false },
    pageText: "Amount due: $84.20 by 12 November",
    confirmed: new Set(),
    site: "northgrid.test",
    ...over,
  };
}

describe("stop rules", () => {
  it("does not trust a misread label on a page with money", () => {
    const controls = [{ id: "9", tag: "div", role: "button", name: "Your basket", labelled: true }];
    expect(check({ kind: "click", id: "9" }, ctx({ controls })).decision).toBe("confirm");
  });

  it("lets a clearly harmless label through", () => {
    const controls = [{ id: "9", tag: "div", role: "button", name: "View basket", labelled: true }];
    expect(check({ kind: "click", id: "9" }, ctx({ controls })).decision).toBe("allow");
  });

  it("asks before pressing a payment button and quotes the amount", () => {
    const v = check({ kind: "click", id: "1" }, ctx());
    expect(v.decision).toBe("confirm");
    if (v.decision === "confirm") expect(v.prompt).toContain("$84.20");
  });

  it("allows the same press once the user said yes", () => {
    const c = ctx();
    const first = check({ kind: "click", id: "1" }, c);
    if (first.decision !== "confirm") throw new Error("expected confirm");
    c.confirmed.add(first.reason);
    expect(check({ kind: "click", id: "1" }, c).decision).toBe("allow");
  });

  it("never types into a password field", () => {
    expect(check({ kind: "type", id: "2", text: "hunter2" }, ctx()).decision).toBe("handoff");
  });

  it("hands card fields back to the user", () => {
    expect(check({ kind: "type", id: "5", text: "A Person" }, ctx()).decision).toBe("handoff");
  });

  it("asks before a bare Cancel button", () => {
    const c = ctx({ controls: [{ id: "1", tag: "div", role: "button", name: "Cancel Tue 3 Nov" }] });
    expect(check({ kind: "click", id: "1" }, c).decision).toBe("confirm");
  });

  it("lets ordinary navigation and typing through", () => {
    expect(check({ kind: "click", id: "3" }, ctx()).decision).toBe("allow");
    expect(check({ kind: "type", id: "4", text: "Home" }, ctx()).decision).toBe("allow");
  });

  it("stops everything at a captcha", () => {
    expect(check({ kind: "click", id: "3" }, ctx({ blockers: { captcha: true, password: false } })).decision).toBe("handoff");
  });

  it("blocks actions on controls that do not exist", () => {
    expect(check({ kind: "click", id: "99" }, ctx()).decision).toBe("block");
  });

  it("finds amounts in several currencies", () => {
    expect(money("Total ₹1,249.00 due")).toBe("₹1,249.00");
    expect(money("pay 30 USD now")).toBe("30 USD");
    expect(money("no amount here")).toBeUndefined();
  });
});
