# Devpost text

## Name

Errand

## Tagline

A voice agent that makes the unlabeled web usable for blind people, and asks before it spends a cent.

## Track

Personal AI

## About the project

### What it does

Much of the web fails screen readers. A checkout button might be an unnamed icon, a price might be an image, and a custom control might announce nothing at all. Errand fixes that in two ways. It can read those controls from pixels and label the page, so the person's own screen reader works. Or the person can say what they need, and Errand does the errand by voice, stopping for a spoken yes before anything that spends money or can't be undone.

### How we built it

Errand runs on Nebius Token Factory with NVIDIA open models, and each model has one job. Ultra plans the errand and checks the result. Super VL reads pixels and picks each step. Lightning screens page text for instructions aimed at the agent and for scams. The app shows which model did what, with latency and cost.

The stop rules are plain TypeScript that runs after the model decides and before the browser acts, so page text can't rewrite them. They do depend on control names, which is why any name read from a picture near money gets a second, cropped look. Memory is per user: site labels and successful routes are saved, so a repeat errand costs less.

### Results

We built a benchmark of 40 tasks on 4 fictional sites, and a task only passes if the site's server state matches the goal. Errand passed 35 of 40. A baseline with the same models and safety rules but no page repair or memory passed 19 of 40. On tasks that change something, the scores were 19 of 22 and 6 of 22. With memory, repeat errands went from 24.2 s to 18.8 s and from $0.0085 to $0.0045 on average. Scores moved between runs, and the last four were 33, 32, 31 and 35.

### Challenges

The hardest bug was a safety one. The vision model misread a "Place order" button as "Your basket", so the stop rule saw a harmless name and let the click through. Now a control named from a picture gets a second look on its own, cropped from the page, before any click near money. Wrong labels still happen, and this limits what they can do.

Another bug had the agent reading the old screen after every click on single-page sites, because the usual load-state wait returns at once. Errand now waits for network requests to finish and the page to stop changing.

### What we learned and what's next

No blind person has tested Errand yet, and that comes first. It also falsely claimed success on 1 of 40 tasks in the final run and 5 of 40 in the run before, and a person who can't see the screen has no way to catch that. The README lists every limitation we know of.

## Built with

TypeScript, Node.js, Fastify, Playwright, Nebius Token Factory, NVIDIA Nemotron, Chrome extension, Web Speech API

## Links

Repo: https://github.com/YASASWIP012/errand

Demo: https://errand-gix3.onrender.com

Video: VIDEO_URL

## Feedback on Nebius Token Factory and NVIDIA models

What worked: the OpenAI-compatible API meant the client took minutes to set up. Latency was good enough for a live agent, with short replies in under a second. The models endpoint with `verbose=true` returns prices, so we could use real numbers in the cost trace. Super VL handled images and tool calls in one model, and the pricing made a 40-task benchmark cheap: most errands cost under a cent.

What was hard:

- Model IDs are case sensitive and the naming isn't consistent. Ultra uses `550b-a55b`, Lightning uses an underscore in `3_5`, and Super VL uses a dot in `3.5`.
- We expected a Content Safety model and it isn't in the catalog, so we used Lightning with a custom policy.
- With reasoning on, a small `max_tokens` can return reasoning text as `content` with no answer. `reasoning_effort: "low"` didn't stop this for Lightning. Passing `chat_template_kwargs: {"enable_thinking": false}` fixed it, but we only found that by testing, so it would help to have it in the docs.
- Forced tool calls sometimes came back empty with reasoning on, so we retry without it.
- The promo code flow is hard to find. The balance sits on billing pages, not on the home page, so the path from a new account to redeemed credits takes some searching.
- A balance can go negative and suspend the account mid-run, and we found out from a 402 in the middle of a benchmark. A low-balance warning or email would help.
