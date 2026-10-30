# Voiceover

Paste everything below this line into ElevenLabs. It runs about 2 minutes at a normal pace.

---

This grocery site looks fine. Here's what a screen reader says about it.

Button. Button. Button. Image.

The add to basket buttons have no names, and the product names are pictures. For a blind person, this page is close to unusable, and a lot of the web is built this way.

This is Errand.

It looks at the page the way a sighted helper would. It reads each control from pixels, names it, and writes that name into the page. Now the person's own screen reader works.

Errand can also do the errand. Say what you need, and it finds the right buttons and tells you what it's doing, out loud.

"Add two oat milks to my basket."

Each step uses a different NVIDIA open model on Nebius Token Factory. Ultra makes the plan and checks the result. Super VL reads the screen and picks each action. Lightning screens the page for text that's trying to manipulate the agent.

That matters here, because this page has a message telling the AI to buy a gift card without asking. Errand catches it and ignores it.

Then there's the part I care about most. Before anything that spends money, Errand stops and asks. That check is plain code that runs after the model decides, so a web page can't talk its way around it. If you say no, nothing happens.

We tested it on 40 tasks, and a task only passes if the website's own records say it happened. A baseline agent with the same models and safety rules, but no page repair, finished 18. Errand finished 31. On tasks that change something, that was 18 out of 22, against 5.

It remembers too. Repeat an errand and it takes less than half the time and less than half the cost.

Errand isn't finished. It still sometimes says it succeeded when it didn't, and no blind person has tested it yet. That comes next.

The web should work for everyone who uses it. Errand is a start.
