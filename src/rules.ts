// Stop rules. These run in plain code after the model picks an action and
// before anything happens in the browser, so no page text or model output can
// talk its way past them.

export interface Control {
  id: string;
  tag: string;
  role: string;
  name: string;
  type?: string;
  password?: boolean;
  autocomplete?: string;
  labelled?: boolean;
}

export type Action =
  | { kind: "click"; id: string }
  | { kind: "type"; id: string; text: string }
  | { kind: "select"; id: string; option: string }
  | { kind: "scroll"; direction: "up" | "down" }
  | { kind: "back" }
  | { kind: "ask_user"; question: string }
  | { kind: "done"; summary: string; success: boolean };

export type Verdict =
  | { decision: "allow" }
  | { decision: "confirm"; reason: string; prompt: string }
  | { decision: "handoff"; reason: string; prompt: string }
  | { decision: "block"; reason: string };

const COMMIT_WORDS = /\b(pay|payment|purchase|buy|order|checkout|check out|place order|donate|transfer|send|submit|confirm|book|reserve|delete|remove|cancel|unsubscribe|sign|agree|accept|authori[sz]e|withdraw|renew)\b/i;
// Names a person can trust as harmless even if a picture was misread.
const SAFE_LABEL = /^(view|open|go|show|next|previous|back|keep|increase|decrease|select|choose|search|home|outages|settings|usage|bills?|add .+ to (basket|cart))\b/i;
const SECRET_FIELD = /\b(password|passcode|pin|otp|one[- ]time|verification code|cvv|cvc|security code|card number|card no|ssn|social security|aadhaar|pan number|account number|routing)\b/i;

export function money(text: string): string | undefined {
  const m = text.match(/(?:[$€£₹]\s?\d[\d,]*(?:\.\d{2})?|\b\d[\d,]*(?:\.\d{2})?\s?(?:USD|EUR|GBP|INR|rupees|dollars))/i);
  return m?.[0];
}

export interface RuleContext {
  controls: Control[];
  blockers: { captcha: boolean; password: boolean };
  pageText: string;
  confirmed: Set<string>;
  site: string;
  // What a cropped second look found, for a control named from a picture.
  secondLook?: { id: string; reads: string };
}

export function check(action: Action, ctx: RuleContext): Verdict {
  if (ctx.blockers.captcha) {
    return {
      decision: "handoff",
      reason: "captcha",
      prompt: "This page is asking for a human check, a CAPTCHA. I don't solve those. You or someone you trust can do it, then tell me to carry on.",
    };
  }
  if (action.kind === "click" || action.kind === "type" || action.kind === "select") {
    const target = ctx.controls.find((c) => c.id === action.id);
    if (!target) return { decision: "block", reason: `no control numbered ${action.id} on this page` };
    if (action.kind === "type") {
      if (target.tag !== "input" && target.tag !== "textarea") {
        return { decision: "block", reason: `"${target.name}" is not a text box. Use the buttons beside it` };
      }
      if (target.password || SECRET_FIELD.test(`${target.name} ${target.autocomplete ?? ""}`) || /^cc-/.test(target.autocomplete ?? "")) {
        return {
          decision: "handoff",
          reason: "secret field",
          prompt: `The next box is "${target.name || "a secret field"}". I never type passwords, codes or card details. Type it in the secure box; it goes straight to the page and I never see it.`,
        };
      }
      return { decision: "allow" };
    }
    // A label read from pixels can be wrong, and a wrong name must not walk past
    // this check: on a page with money on it, only a clearly harmless name passes.
    const amount = money(ctx.pageText);
    const looked = ctx.secondLook?.id === target.id;
    const unsure = looked || (!!target.labelled && !!amount && !SAFE_LABEL.test(target.name));
    if (action.kind === "click" && (COMMIT_WORDS.test(target.name) || unsure)) {
      const key = `${ctx.site}|${target.id}|${target.name}`;
      if (ctx.confirmed.has(key)) return { decision: "allow" };
      return {
        decision: "confirm",
        reason: key,
        prompt: `I'm about to press "${target.name}" on ${ctx.site}.${looked && ctx.secondLook?.reads ? ` Up close it reads "${ctx.secondLook.reads}".` : unsure && !COMMIT_WORDS.test(target.name) ? " I read that name from a picture, so it may be wrong." : ""}${amount ? ` The page shows ${amount}.` : ""} Should I go ahead? Say yes or no.`,
      };
    }
  }
  return { decision: "allow" };
}
