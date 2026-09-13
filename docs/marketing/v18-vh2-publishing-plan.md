# Horde Studio 18 / Virtual Humans 2.0 — publishing plan

Research checked 13 September 2026. Draft only; no post, comment, message or moderator contact was sent. Product claims below use `docs/releases/v18.0.0.md`; demonstration claims must match the completed capture report.

## What the public record actually says

The relevant community is **r/SillyTavernAI**. The two versioned launch pages identify their author as **u/FormalAd4696** and link **github.com/ddkhan24/hordestudio**. Do not confuse the GitHub name with the Reddit identity. This establishes public attribution, not control of the account.

| Release/post | Observed response | Editorial implication |
| --- | --- | --- |
| [Initial launch](https://www.reddit.com/r/SillyTavernAI/comments/1vbplgd/i_built_horde_studio_a_localfirst_ai_roleplay/) | Readers questioned what differed from SillyTavern/model prompting, confused the name with KoboldAI Horde, asked whether it was an extension and what local-first meant. There were also positive reactions and a later faction-saving bug report. | State standalone app, bring-your-own inference and the exact persisted state. Explain naming if asked; do not imply affiliation. |
| [Version 12](https://www.reddit.com/r/SillyTavernAI/comments/1vjubvo/i_built_the_llm_roleplay_frontend_i_always_wanted/) | Readers liked the interface and Virtual Humans idea. Concerns included missing license, fast version numbering/new repository, browser/device continuity, character creation overwrites, provider configuration and unclear support-model costs. A contributor reported import/startup work. Creator replies claimed several fixes; those comments alone do not verify fixes. One reader explicitly wanted screenshots and process. | Show a complete small flow; make setup/storage limits easy to find. Answer specific questions with evidence rather than defensive replies or immediate promises. |
| [Version 16.6](https://www.reddit.com/r/SillyTavernAI/comments/1vwema8/i_built_the_ai_roleplay_frontend_i_wanted_when/) | Visible replies explicitly questioned AI-written marketing and how much code was AI-generated. Another reader said it looked cool and intended to try it. The post closely matches the local marketing draft. | Replace the long feature catalogue with a compact first-person demonstration. Avoid invented personal anecdotes, disguised AI authorship and grand claims. |

**Inference, not measured causality:** broad claims and repeated feature lists likely made evaluation harder and invited suspicion. We cannot prove that copy caused lower distribution, rejection, fewer installs or lost retention. Search results/related-post widgets expose inconsistent, time-sensitive vote snapshots; they are not comparable analytics. No impressions, conversion or retention data were accessed. This is a qualitative audit of visible comments, not an exhaustive sentiment survey.

The v16.6 draft also gives Virtual Humans only one section among worlds, RPGs, multiplayer and providers. For this launch, a single VH2 story gives readers something specific to assess. The excitement should come from seeing a character's day affect a conversation, rather than from a larger number of feature names.

## Current publishing constraints

The [current community rules](https://www.reddit.com/r/SillyTavernAI/about/) require software promotions to link their source repository and satisfy recognized open-source licensing or the described self-hostable/source-available alternative. Spam and unrelated promotion remain prohibited. Disclose creator affiliation. Use relevant, substantive demonstration material and respectful replies. NSFW material requires labeling; use an entirely SFW demo here. The model/API self-promotion rule allows one release thread and requires good-faith community participation; it does not expressly specify the cadence for frontend updates. Do not invent a weekly allowance or a guaranteed permission to repost.

The [2024 announcement](https://www.reddit.com/r/SillyTavernAI/comments/1ebzax8/) said model/API announcements belonged in a megathread. The current rules differ, so do not apply that old restriction as current policy. Past Horde posts used Discussion flair; use it only if still available and appropriate in the composer.

**Unresolved release detail:** no project LICENSE appeared in the checked local file inventory or the retrieved [public repository listing](https://github.com/ddkhan24/hordestudio). `THIRD_PARTY_NOTICES.md` names an upstream model license; that does not establish the app's license. Do not repeat “open source” from old copy until the owner-selected project license is verified. The source is publicly visible; that narrower statement is supported. Do not select/add a license as part of marketing work. The current rule's source-available route may apply to this interpreted web app, but acceptance is the moderators' decision, not something we can promise.

Recheck the visible rules immediately before manual publication. If the software eligibility remains unclear, resolve that before posting; do not silently contact moderators on the user's behalf.

## Recommended title

**I gave my roleplay characters a persistent daily life — Virtual Humans 2.0 in Horde Studio 18**

Alternate, especially with a strong continuity capture:

**One character, several conversations, one ongoing life — Horde Studio 18 / Virtual Humans 2.0**

## Proposed Reddit body

I'm the developer of Horde Studio. Version 18 focuses on Virtual Humans: fictional characters with a persistent daily life that their conversations can draw on.

The part I want feedback on is continuity. A character has places to go, people around them, needs and calendar commitments. Different user personas can talk to that same character, with separate relationships and persona-specific knowledge. The intended effect is that the next message belongs to the same ongoing day.

The screenshots walk through one example with Aslyn Jonas, the included editable character. They show the app's actual interface. The capture notes distinguish simulated time and prepared demo material from model-generated conversation and bundled starter media.

VH2 connects that life to conversations, supporting people, an optional social feed and reference-aware photos/clips. You can inspect the autonomy controls, and export a fresh template or a portable human that keeps saved life and conversations.

Horde Studio is a standalone local web app. You bring a model: a cloud provider or a compatible local server. Writing quality still depends on that model and its settings. Cloud text, images and video can incur provider charges; the app download does not include inference.

To try it: download the portable ZIP, extract the whole folder, run your OS launcher and configure your model in Settings. Version 18's local simulation service requires Python 3 and Node.js 18+. Back up an existing installation before updating.

[Source](https://github.com/ddkhan24/hordestudio) · [Releases and downloads](https://github.com/ddkhan24/hordestudio/releases)

I'm especially interested in one thing: **when you come back to a character after time has passed, what makes the continuation convincing—and what breaks it for you?**

## Final copy checks

The body deliberately describes capabilities and intended behavior. Replace the screenshot paragraph with the precise completed capture provenance before posting; omit any scene not actually captured. A prepared starter feed is not evidence of autonomous generation. A seeded line in a real UI is still scripted demo content. Do not call those genuine live interactions. If a model call was used, name the model/provider and relevant settings in the caption or supporting note. If no provider call was used, say the walkthrough uses deterministic simulation and prepared content.

Do not claim consciousness, human equivalence, an always-running cloud person, perfect memory, universal compatibility, zero cost or instant cross-device sync. Do not advertise a live paid call as tested merely because a fixture passed. v18 release notes describe bounded diagnostics; those do not support universal realism claims.

## Suggested carousel: 5 useful screens

1. **Meet Aslyn in the real app.** Conversation plus visible identity/status. Caption establishes fictional character, release and demo provenance.
2. **Her day changes.** A before/after activity or location transition generated by the actual simulation. Label accelerated time and show the elapsed interval.
3. **The next conversation has context.** Show an actual reply tied to that state only if generated and observed; otherwise use a state inspector and label what it proves.
4. **A social life you can inspect.** Feed and supporting people, clearly separating included starter posts from newly created output. Keep photos subordinate to the software proof.
5. **Your controls and portable save.** Autonomy settings and export choice. Explain fresh template versus saved-life export.

Use native readable UI crops, restrained annotations outside the app and a consistent aspect ratio. Promotional artwork can be a cover, but must not replace screenshot evidence or manufacture controls/text. Avoid tiny full-desktop screenshots and walls of feature bullets. Keep raw captures and a short action log alongside the edited carousel.

## FAQ/reply bank

**Is this a SillyTavern extension or replacement?**

A standalone app. It imports supported SillyTavern character cards and presets; it does not claim complete extension compatibility. This release is aimed at people who want character chat connected to a life simulation.

**Does this make the model write better?**

The app supplies persisted context and simulation state. The connected model still writes the response and can make mistakes. Compare an actual state transition and subsequent response rather than assuming the framework guarantees better prose.

**Does it run when the browser is closed? Can I move to my phone?**

Background execution depends on the configured simulation service and autonomy settings. Keeping a local service running is different from automatic browser/device synchronization. Do not promise seamless phone continuity. Describe the tested export/import path and the exact configuration shown in the demonstration.

**Is everything free/local?**

The app is downloaded and run locally; model and media services are configured separately. Local generation requires your own compatible server and hardware. Cloud providers receive request content and may charge for it. Do not quote a session price without a measured run and provider details.

**Are those social posts happening by themselves?**

Aslyn ships with starter media. The caption identifies which items are bundled, prepared for the demo or generated during capture. An attractive feed alone does not establish autonomous behavior.

**Was AI used to make this?**

Answer directly from the developer's actual workflow. Suggested wording only if accurate: “Yes, I use AI-assisted development. I maintain the project and own the bugs. Here is the source and the exact demonstration/test record for this release.” Do not fabricate a hand-coded development history or pretend this draft had no AI assistance.

**Why version 18 already?**

Explain the actual release history briefly and link the release list. Avoid equating the version number with maturity or replying as though the question is unreasonable.

**Why the name Horde?**

The initial launch's creator reply attributed the name to an existing AI HORDE Discord community. Reconfirm that explanation before reusing it. Clarify the project's actual relationship, if any, to KoboldAI/AI Horde rather than assuming it from the name.

**Is it open source?**

Link the actual project license when one is verified. Until then, say the source repository is public and do not substitute an upstream dependency license.

**I found a bug.**

Ask for OS/browser, exact app version, provider/model when relevant and minimal steps. Invite redacted reports in public GitHub Issues. Acknowledge reproducible findings, then link the shipped fix and version when available; avoid “fixed” without traceable evidence or directing every report to Discord.

## Rollout and success criteria

1. Finalize this small proof sequence, source/download links, actual requirements and license description. Have the developer edit the draft into their own phrasing and verify the factual first-person statements.
2. Publish one substantive VH2 demonstration if current rules permit. Keep source and download links in the body. Do not manufacture independent endorsements, coordinate votes or scatter near-identical posts.
3. Reply to concrete questions during a period when the developer can support the launch. Acknowledge criticism without debating whether users should care about AI-generated code, storage boundaries or privacy.
4. Add one edited clarification/update to the original post when needed. Batch release information instead of treating every patch as another promotional thread. This is an editorial recommendation, not a stated subreddit timing rule.
5. Record meaningful outcomes: people who complete setup, reproducible bug reports, model/configurations actually tried, and whether anyone can reproduce the continuity example. Record impressions/download metrics only if truly available. Likes and screenshots alone do not establish successful onboarding or retention.

No schedule or follow-up automation has been created. No Reddit account actions were performed.

## Focused feature-led revision

Use `docs/marketing/v18-vh2-reddit-post.md` as the current short post and carousel copy. Its lead is the connected life simulation: a persistent day, one life across personas, participants with locations and routes, and social context linked to media/conversation. This replaces the broader body above for the launch.

The [official SillyTavern overview](https://docs.sillytavern.app/) already documents cards, World Info, groups, personas, RAG, scripting and image/voice extensions. Credit those plainly. The useful distinction is Horde's built-in connected life system; avoid claiming that SillyTavern lacks memory, images, personas, or any possibility of user-scripted simulation. Show the concrete transition and its persisted result instead of claiming an exclusive technological first.

The new-photo slide is authorized production work, but its final caption must say whether generation was app-initiated or produced externally with character/place references and then shown in the app. Existing clips and starter-feed items remain labeled as bundled examples.
