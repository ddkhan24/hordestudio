# V17 Reddit strategy

## What previous posts show

### The stronger post

The Horde Studio 12 post earned roughly 129 upvotes. It worked because it:

- opened with one understandable product question;
- respected SillyTavern instead of declaring a replacement;
- explained three concrete modes with examples;
- disclosed limitations in a first comment;
- asked experienced users for specific technical feedback;
- included real screens and direct release/source links.

### The weaker post

The earlier general introduction earned roughly 16 upvotes. Its discussion exposed recurring problems:

- “local-first,” “depth,” and “genuine simulation” sounded broad without proof;
- readers could not immediately tell whether Horde was an extension, replacement or unrelated app;
- the original framing did not show concrete differentiation from lorebooks and prompts;
- missing screenshots weakened credibility;
- “Horde” created confusion with KoboldAI Horde;
- the lack of a recognized license raised open-source and auditability concerns;
- defensive replies prolonged objections instead of converting them into useful questions.

### Relevant community signal

A recent alternative frontend post with roughly 142 upvotes used plain language, made one modest promise, explained import/installation concretely and explicitly foregrounded open-source status. The community rewards honest, inspectable software and dislikes disguised advertising.

## Positioning decision

Do not launch v17 as another complete overview of Horde Studio. Existing readers have already seen that pitch. Lead with one visible experiment:

> Choose a roleplay beat, then watch it become the next video scene.

Make “experimental,” Fal requirement, cost and latency visible before readers have to ask. This turns weaknesses into an invitation to help shape the architecture.

## Compliance and trust

- Post under the appropriate project/showcase/discussion flair available at submission time.
- Identify yourself as the developer.
- Link public source and the self-hosted portable release.
- Do not call the repository “open source” until a recognized license is present. Use “source-available and self-hosted.”
- State that Horde Studio is not affiliated with SillyTavern, KoboldAI Horde or Fal.
- Do not imply realtime playback in v17.
- Do not imply provider safety controls can be disabled.
- Do not use an overtly sexual screenshot as the lead. If included, mark the post NSFW.

## Best conversion asset still missing

Record a 20–30 second screen capture showing:

1. the current clip reaching its ending;
2. the three context-aware choices;
3. one choice being selected;
4. the Director/render status without editing out the wait;
5. the next clip appearing in the same timeline.

Use a SFW adventure with a distinctive recurring character. A real interaction clip will answer “is this just marketing art?” better than another feature carousel.

## Posting sequence

1. Confirm the current subreddit rules and choose the correct flair immediately before posting.
2. Upload the three-image SFW gallery in the documented order.
3. Post the long-form body from `REDDIT-POST.md`.
4. Add the disclosure/FAQ as the first comment within two minutes.
5. Reply to concrete questions with implementation details. Acknowledge taste objections once, then disengage.
6. After 24 hours, summarize repeated feedback in GitHub issues or the Discord feedback channel.
7. Do not repost the same launch copy across adjacent AI subreddits on the same day. Rewrite around each community's actual interest and rules.

## Success signals

Do not optimize only for upvotes. Track:

- release-page clicks and portable downloads;
- first successful Fal connection;
- percentage reaching a completed opening clip;
- median time to first clip and next clip;
- timeout/fallback frequency by renderer;
- number of timelines reaching three completed scenes;
- concrete bug reports containing reproducible configuration details.
