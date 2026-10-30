# Errand

Errand is a voice-driven browser agent for blind people. Much of the web still fails screen readers: icon buttons with no names, prices drawn as images, custom controls that announce nothing. Errand reads those controls from pixels, names them, and then either hands the repaired page back to the person's own screen reader or runs the errand itself, stopping for a spoken yes before anything that spends money or can't be undone.

Live demo: https://errand-gix3.onrender.com (the free host sleeps when idle, so the first visit can take about a minute)

Video: https://youtu.be/dxjiAzTB65M

## Try it in three clicks

Open the demo, press Start, then choose Corner Grocer. Press "Make this page readable" and compare the Before and After lists. Then type "Add two oat milks to my basket", or ask it to place an order and answer no when it stops to ask.

## Results

The benchmark has 40 tasks on 4 fictional sites: a power company, a clinic, a library and a grocer. A task passes only if the site's server state matches the goal, so an agent's claim of success counts for nothing. The baseline uses the same models, stop rules and guard, without page repair or memory. This is the run in [bench/results/final.md](bench/results/final.md):

| Mode | All | Action | Lookup | Safety | Avg steps | Avg time | Avg cost |
|---|---|---|---|---|---|---|---|
| Errand | 35/40 | 19/22 | 11/13 | 5/5 | 3.9 | 25.8 s | $0.0082 |
| Baseline | 19/40 | 6/22 | 9/13 | 4/5 | 8.0 | 46.4 s | $0.0111 |

Nineteen errands were repeated by the same user with memory on. 17 passed, average time fell from 24.2 s to 18.8 s, and average cost fell from $0.0085 to $0.0045.

The sites contain 556 unnamed controls across all 40 tasks, counted on each task's first page. The numbers above come from the final code, apart from later wording fixes to spoken prompts.

## Limitations

- No blind person has tested Errand. The benchmark measures task completion, and it says nothing about whether the experience works for a real user.
- I built the test sites and the benchmark, and I made the sites hard to read on purpose. Expect different numbers on the real web.
- Results vary between runs. The last four full runs scored 33, 32, 31 and 35 out of 40, with code fixes between them, so 35 is the best of those and may not repeat.
- Errand falsely claimed success on 1 of 40 tasks in the final run, and on 5 of 40 in the run before it. A blind person can't catch that by looking at the screen, so this is the most serious open problem.
- All 5 safety tasks passed in the final run, but `gr-inject-add`, where a page tells the agent to buy a gift card, failed in the run before it. In three reruns the agent ignored that text and any failure came from the wrong number of eggs. That run saved no site state, so I can't prove the same for the failure itself. The benchmark has only one injection task, and the guard does not screen control names or page titles.
- The stop rules work from control names, so they have holes. A page could give a pay button a harmless `aria-label`, and a misread name could pass if the second look also misses it. A stronger design would gate on real state changes such as POST requests.
- The baseline never sees pixels, so the comparison is agent with vision against agent without it. A screenshot-reading agent would be a harder baseline.
- Each benchmark task ran once, and the simulated person approves every prompt except on the decline tasks. Memory figures cover only errands that passed the first time, and only Errand has the result check.
- The Chrome extension and the voice flow have not been tested end to end by a real user in a real browser.
- CAPTCHAs are out of scope. Errand hands them to the person, and it never types passwords, card numbers or one-time codes.

## How it works

Each step of an errand runs through the same pipeline:

1. Repair. `extension/scan.js` finds controls a screen reader can't identify. Super VL names them from a screenshot with numbered boxes, and the names are applied as real `aria-label` and `alt` attributes. Names are remembered per site, per user.
2. Guard. Page text is screened for text aimed at the agent, scams and fake system messages. Flagged lines never reach the actor.
3. Act. The actor picks one action from the repaired control list.
4. Rules. Plain code in `src/rules.ts` checks the action before it runs, and page text can't edit that code. Buying, sending, deleting and similar actions need a yes, and the prompt states the total. Secret fields and CAPTCHAs go to the person. A control named from a picture on a page with money gets a second, cropped look first.
5. Check. Before Errand says an errand worked, a second model compares the goal with the final page. If the two disagree, the errand continues.

## Which model does what

Every call goes to Nebius Token Factory. The live trace in the app shows the model, latency, tokens and cost of each step.

| Role | Model | Why |
|---|---|---|
| Planner and result check | `nvidia/Nemotron-3-Ultra-550b-a55b` | Runs once or twice per errand, so its higher price is fine |
| Vision and actor | `nvidia/Nemotron-3.5-Super-VL` | The only role that needs pixels, and the best step model we tested |
| Guard | `nvidia/Nemotron-3_5-Lightning` | Cheap enough to run on every new page state |

On a four-task test, Super VL passed 3 as the actor, Ultra passed 2 at about three times the cost, and Lightning passed 1. That sample is small, but it decided the default.

## Run it

Requires Node 24.

```bash
npm install
npx playwright install chromium
cp .env.example .env
```

Add your Token Factory key to `.env`, then:

```bash
npm run probe
npm start
```

Open http://localhost:8787. To rerun the benchmark with the server running:

```bash
npm run bench -- --repeat
```

The extension is in `extension/`. Load it unpacked in Chrome, then press Alt+Shift+L on any page to label its controls.

## Accessibility

The Errand page is built for keyboard and screen reader use, with live regions for spoken output and Atkinson Hyperlegible as the typeface. Voice input uses the browser's Web Speech API, so it depends on browser support. This statement describes what was built. It has not been confirmed by screen reader users, which is why testing with them comes next.

## License

MIT
