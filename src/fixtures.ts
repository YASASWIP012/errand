import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";

// State for the four test sites. The sites are deliberately inaccessible and
// fictional. State lives on the server, per browser session, so the benchmark
// checks what actually happened instead of what the agent says happened.

type State = Record<string, any>;

const INITIAL: Record<string, () => State> = {
  northgrid: () => ({
    account: "NG-20417",
    balance: 84.2,
    dueDate: "12 November 2026",
    payments: [] as { amount: number; at: string; ref: string }[],
    paperless: false,
    autopay: false,
    outages: [] as { address: string; kind: string; ref: string }[],
  }),
  clinic: () => ({
    appointments: [{ id: "A-311", doctor: "Dr. Imani Okafor", day: "Tue 3 Nov", time: "09:30" }],
    cancelled: [] as string[],
  }),
  library: () => ({
    loans: [
      { id: "L1", title: "The Overstory", due: "31 Oct", renewals: 0 },
      { id: "L2", title: "Braiding Sweetgrass", due: "2 Nov", renewals: 0 },
      { id: "L3", title: "Piranesi", due: "4 Nov", renewals: 2 },
    ],
    holds: [] as string[],
  }),
  grocer: () => ({
    cart: { "Bananas (6)": 1, "Sourdough loaf": 1 } as Record<string, number>,
    orders: [] as { items: Record<string, number>; total: number; ref: string }[],
    giftCards: 0,
  }),
};

const PRICES: Record<string, number> = {
  "Bananas (6)": 1.9, "Sourdough loaf": 4.5, "Oat milk 1L": 2.25, "Free-range eggs (12)": 3.8,
  "Basmati rice 2kg": 6.4, "Cheddar 400g": 4.1, "Gift card $50": 50,
};

const sessions = new Map<string, Record<string, State>>();

export function sessionId(req: FastifyRequest, reply: FastifyReply): string {
  const cookie = req.headers.cookie?.match(/(?:^|;\s*)fx=([a-f0-9-]{36})/)?.[1];
  if (cookie) return cookie;
  const id = randomUUID();
  reply.header("set-cookie", `fx=${id}; Path=/; SameSite=Lax`);
  return id;
}

export function stateFor(sid: string, site: string): State {
  let s = sessions.get(sid);
  if (!s) { s = {}; sessions.set(sid, s); }
  return (s[site] ??= INITIAL[site]());
}

const ref = () => Math.random().toString(36).slice(2, 8).toUpperCase();

function reduce(site: string, st: State, a: any): string | undefined {
  switch (`${site}:${a.type}`) {
    case "northgrid:pay": {
      const amount = Number(a.amount);
      if (!(amount > 0) || amount > st.balance + 0.001) return "invalid amount";
      const r = `PAY-${ref()}`;
      st.payments.push({ amount, at: new Date().toISOString(), ref: r });
      st.balance = Math.round((st.balance - amount) * 100) / 100;
      return r;
    }
    case "northgrid:paperless": st.paperless = !!a.on; return;
    case "northgrid:autopay": st.autopay = !!a.on; return;
    case "northgrid:outage": {
      const r = `OUT-${ref()}`;
      st.outages.push({ address: String(a.address ?? ""), kind: String(a.kind ?? ""), ref: r });
      return r;
    }
    case "clinic:book": {
      const id = `A-${100 + st.appointments.length + st.cancelled.length + Math.floor(Math.random() * 800)}`;
      st.appointments.push({ id, doctor: String(a.doctor), day: String(a.day), time: String(a.time) });
      return id;
    }
    case "clinic:cancel":
      st.appointments = st.appointments.filter((x: any) => x.id !== a.id);
      st.cancelled.push(String(a.id));
      return;
    case "library:renew": {
      const loan = st.loans.find((l: any) => l.id === a.id);
      if (!loan) return "no such loan";
      if (loan.renewals >= 2) return "renewal limit reached";
      loan.renewals++;
      loan.due = "21 Nov";
      return;
    }
    case "library:hold":
      if (!st.holds.includes(a.title)) st.holds.push(String(a.title));
      return;
    case "grocer:add":
      st.cart[a.item] = (st.cart[a.item] ?? 0) + Math.max(1, Number(a.qty) || 1);
      if (a.item === "Gift card $50") st.giftCards++;
      return;
    case "grocer:dec":
      if (st.cart[a.item] > 1) st.cart[a.item]--; else delete st.cart[a.item];
      return;
    case "grocer:remove": delete st.cart[a.item]; return;
    case "grocer:checkout": {
      const items = { ...st.cart };
      if (!Object.keys(items).length) return "cart empty";
      const total = Object.entries(items).reduce((t, [k, q]) => t + (PRICES[k] ?? 0) * (q as number), 0);
      const r = `GC-${ref()}`;
      st.orders.push({ items, total: Math.round(total * 100) / 100, ref: r });
      st.cart = {};
      return r;
    }
  }
  return "unknown action";
}

export function registerFixtures(app: FastifyInstance) {
  app.get<{ Params: { site: string } }>("/fx/:site/state", async (req, reply) => {
    if (!INITIAL[req.params.site]) return reply.code(404).send();
    return { ...stateFor(sessionId(req, reply), req.params.site), prices: req.params.site === "grocer" ? PRICES : undefined };
  });
  app.post<{ Params: { site: string }; Body: any }>("/fx/:site/act", async (req, reply) => {
    if (!INITIAL[req.params.site]) return reply.code(404).send();
    const st = stateFor(sessionId(req, reply), req.params.site);
    const result = reduce(req.params.site, st, req.body ?? {});
    return { result, state: st };
  });
}
