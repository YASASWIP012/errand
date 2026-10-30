import { call, parseJson, type TraceSink } from "./models.js";

export interface Unnamed {
  id: string;
  tag: string;
  role: string;
  name: string;
  announcedAs: string;
  rect: { x: number; y: number; w: number; h: number };
  context: { heading: string; row: string; hints: string };
}

export interface Label {
  id: string;
  label: string;
  role: string;
  confidence: number;
}

const NOT_A_NAME = /^[\s$€£₹\d.,]*$/;

const SYSTEM = `You name website controls for blind people who use screen readers.
You get a screenshot where each unnamed control has a red box and a red number tag, plus JSON with the page context for each number.
For each number, write the name a screen reader should announce: 1 to 5 words, verb first for actions ("Pay bill", "Remove Wool socks from cart", "Next month"), the visible text for images of text, or a short description for meaningful pictures.
Use the row context to make repeated icons specific ("Delete invoice 1043", not "Delete").
Name each control from its own icon, not from its neighbours. Common icons: plus means "Increase <item> quantity", minus means "Decrease <item> quantity", a shopping cart beside an item means "Add <item> to basket", a shopping cart in the page header means "View basket", a trash can means "Remove <item>", a bolt in navigation means "Outages", a gear means "Settings", a magnifier means "Search".
For a button on a product card, the item name is the image of text inside the same card.
When kind is "picture: read it" and the picture is text, copy the exact words and digits inside the red box, such as "$84.20" or "12 Nov".
When kind is "control: name its action", name what it does. If it shows words, use those exact words, such as "Place order". A control is never named after a price, a number or a section title.
role is one of: button, link, checkbox, tab, menuitem, img, textbox, combobox.
confidence is 0 to 1: how sure you are from the pixels and context. If you cannot tell what a control does, give your best guess with confidence below 0.5.
Reply with only JSON: {"labels":[{"id":"<number>","label":"...","role":"...","confidence":0.0}]}`;

export async function labelControls(
  unnamed: Unnamed[],
  screenshotJpeg: Buffer,
  pageTitle: string,
  sink?: TraceSink,
): Promise<Label[]> {
  if (unnamed.length === 0) return [];
  const context = unnamed.map((u) => ({
    id: u.id,
    element: u.tag,
    kind: u.tag === "img" ? "picture: read it" : "control: name its action",
    currently_announced_as: u.announcedAs,
    section_heading: u.context.heading || undefined,
    // An image of text must be read from its pixels, not guessed from its row.
    nearby_text: u.tag === "img" ? undefined : u.context.row || undefined,
    code_hints: u.context.hints || undefined,
  }));
  const res = await call("vision", `name ${unnamed.length} unlabeled controls`, {
    temperature: 0.1,
    max_tokens: 200 + unnamed.length * 60,
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: [
          { type: "text", text: `Page: ${pageTitle}\nControls:\n${JSON.stringify(context)}` },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${screenshotJpeg.toString("base64")}` } },
        ],
      },
    ],
  }, sink);
  const parsed = parseJson<{ labels: Label[] }>(res.choices[0]?.message?.content);
  const wanted = new Set(unnamed.map((u) => u.id));
  return (parsed.labels ?? [])
    .filter((l) => wanted.has(String(l.id)) && typeof l.label === "string" && l.label.trim())
    .map((l) => {
      // A control named only with digits is a misread. Keep it, flagged as a guess.
      const u = unnamed.find((x) => x.id === String(l.id))!;
      const misread = u.tag !== "img" && NOT_A_NAME.test(l.label);
      return {
        id: String(l.id),
        label: misread ? "Possibly: unnamed button" : tidy(l.label, Number(l.confidence)),
        role: l.role || "button",
        confidence: misread ? 0.1 : clamp(Number(l.confidence)),
      };
    });
}

// Low-confidence guesses are announced as guesses, so the user knows to check.
function tidy(label: string, confidence: number): string {
  const clean = label.trim().replace(/\s+/g, " ").replace(/[."]+$/, "").slice(0, 80);
  return clamp(confidence) < 0.5 ? `Possibly: ${clean}` : clean;
}

function clamp(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5;
}
