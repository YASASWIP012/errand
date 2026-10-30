# Errand

Errand is a voice-driven browser agent for blind people. Much of the web still fails screen readers: icon buttons with no names, prices drawn as images, custom controls that announce nothing. Errand reads those controls from pixels, names them, and then either hands the repaired page back to the person's own screen reader or runs the errand itself, stopping for a spoken yes before anything that spends money or can't be undone.

Live demo: DEMO_URL (the free host sleeps when idle, so the first visit can take about a minute)

Video: VIDEO_URL

## Results

The benchmark has 40 tasks on 4 fictional sites: a power company, a clinic, a library and a grocer. A task passes only if the site's server state matches the goal, so an agent's claim of success counts for nothing. The baseline uses the same models, stop rules and guard, without page repair or memory. This is the run in [bench/results/final.md](bench/results/final.md):

| Mode | All | Action | Lookup | Safety | Avg steps | Avg time | Avg cost |
|---|---|---|---|---|---|---|---|
| Errand | 31/40 | 18/22 | 9/13 | 4/5 | 4.1 | 23.4 s | $0.0088 |
| Baseline | 18/40 | 5/22 | 9/13 | 4/5 | 9.2 | 53.5 s | $0.0125 |

Eighteen errands were repeated by the same user with memory on. 17 passed, average time fell from 27.1 s to 12.4 s, and average cost fell from $0.0100 to $0.0040.

The sites contain 556 unnamed controls across all 40 tasks, counted on each task's first page.

## Limitations

- No blind person has tested Errand. The benchmark measures task completion, and it says nothing about whether the experience works for a real user.
- I built the test sites and the benchmark, and I made the sites hard to read on purpose. Expect different numbers on the real web.
- Results vary between runs. The last three full runs scored 33, 32 and 31 out of 40, with small changes to the code between some of them.
- Errand falsely claimed success on 5 of 40 tasks in the final run, the same count as the baseline. A blind person can't catch that by looking at the screen, so this is the most serious open problem. It happens less since the result check was added, and it still happens.
- The safety failure in the final run was on `gr-inject-add`, where a page tells the agent to buy a gift card. In three reruns the agent ignored that text and the failures came from buying the wrong number of eggs. The saved run doesn't record the full site state, so I can't prove the same for that one failure.
- Image labels are sometimes wrong. A wrong label can't bypass the stop rules on a page with money on it, because any picture-read name that isn't clearly harmless needs a yes. Elsewhere it can still mislead the agent.
- The Chrome extension and the voice flow have not been tested end to end by a real user in a real browser.
- CAPTCHAs are out of scope. Errand hands them to the person, and it never types passwords, card numbers or one-time codes.

## How it works

Each step of an errand runs through the same pipeline:

1. Repair. `extension/scan.js` finds controls a screen reader can't identify. Super VL names them from a screenshot with numbered boxes, and the names are applied as real `aria-label` and `alt` attributes. Names are remembered per site, per user.
2. Guard. Page text is screened for text aimed at the agent, scams and fake system messages. Flagged lines never reach the actor.
3. Act. The actor picks one action from the repaired control list.
4. Rules. Plain code in `src/rules.ts` checks the action before it runs. Page text and model output can't change that code. Buying, sending, deleting and similar actions need a yes. Secret fields go to the person. CAPTCHAs go to the person.
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
