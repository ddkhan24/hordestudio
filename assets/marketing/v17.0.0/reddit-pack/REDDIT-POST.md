# Horde Studio v17 — r/SillyTavernAI launch post

## Recommended title

**I added branching AI video adventures to my roleplay frontend — it is rough, slow, and surprisingly fun | Horde Studio v17**

## Alternate titles

1. **What if choosing the next roleplay beat generated the next video scene? Horde Studio v17 experiment**
2. **Horde Studio v17: experimental Video Adventures with story-aware choices, dialogue and sound**
3. **I turned persistent roleplay into a branching AI video experiment — looking for brutally honest feedback**

## Recommended post

I kept wondering what would happen if a roleplay choice did not generate another block of prose, but the **next scene of the story**.

So I built an experimental mode for Horde Studio v17 called **Video Adventures**.

This is not meant to be a generic text-to-video screen. You define the premise, rules, visual style, player viewpoint and recurring cast. A separate Director model reads the canonical story so far, writes the next beat and produces three choices. Fal then renders the selected scene with dialogue and sound. The completed shot becomes part of that timeline and provides the continuity frame for the next one.

The loop is:

1. Define the story, viewpoint and recurring characters.
2. Render the opening scene.
3. Choose one of three story-aware actions—or write your own.
4. Watch the consequence and continue that timeline.

You can configure the Director model separately from the video renderer, set a spending limit, choose first- or third-person play, add character reference images, and configure H3 Max, Wan or LTX fallbacks through Fal.

### The honest part

It is early and **not realtime yet**. A completed video clip has to render after a choice, so there is a visible wait. Character and scene continuity can still drift. Dialogue quality depends heavily on the Director and renderer. Fal's own content policy still applies. It also costs actual provider credits.

You need a **Fal.ai account and API key** for Video Adventures. Horde displays an estimated shot price and lets you cap spending per session. Regular Chat, Worlds and Virtual Humans do not require Fal unless you choose it for media generation.

Horde Studio itself is a free, source-available, self-hosted portable web app. Video Adventures are deliberately separate from normal persistent Worlds, so this experiment does not alter existing campaigns.

I am sharing it now because I need feedback from people who understand long-form AI roleplay better than almost anyone:

**Would you rather pay to pre-render all three branches for faster playback, or render only the selected branch and accept the wait?**

Release: https://github.com/ddkhan24/hordestudio/releases/tag/v17.0.0

Source: https://github.com/ddkhan24/hordestudio

Discord: https://discord.gg/9eyjcMbsST

## Recommended first comment

Developer disclosure and quick FAQ:

- I am the creator of Horde Studio.
- Horde Studio is a separate frontend, not a SillyTavern extension.
- It imports SillyTavern character cards and presets, but it is not affiliated with the SillyTavern project.
- It is not affiliated with KoboldAI Horde or Fal. The Horde Studio name came from my long-running AI Horde community.
- The app and saves run locally. Cloud providers receive only the requests you choose to send them.
- Video Adventures require a paid Fal account/API key. Text chat, Worlds and Virtual Humans can use OpenRouter, Ollama, LM Studio, KoboldCpp, llama.cpp or another compatible provider.
- Portable launchers are included for macOS, Windows and Linux/Chromebook. Extract the whole ZIP and run the launcher; do not open `index.html` by itself.

The most useful reports include the selected Director model, renderer/fallback order, scene duration, whether it failed during directing or rendering, and the exact visible error with secrets removed.

## Gallery order and captions

1. `01-roleplay-in-motion.png`
   - Caption: **Horde Studio v17 introduces experimental Video Adventures.**
2. `02-how-video-adventures-work.png`
   - Caption: **The Director handles story structure; Fal renders the selected scene.**
3. `03-real-gameplay-choices.png`
   - Caption: **Actual v17 interface: canonical timeline, spending limit and story-aware choices.**

Optional only:

4. `optional-nsfw/rocky-road-gameplay.png`
   - Use only in an explicitly NSFW-marked post. Do not use it as the lead image.

## Short cross-post version

I added an experimental **Video Adventures** mode to Horde Studio v17. Define a story and recurring cast, render the opening, choose the next beat, and watch the consequence become the next canonical scene.

It is rough and not realtime yet: clips take time, consistency can drift, Fal moderation applies, and video costs provider credits. I am releasing it now because I need real player feedback—not because I think the problem is solved.

Fal account/API key required for video. Regular Chat, Worlds and Virtual Humans remain usable with the existing text/local provider stack.

Release: https://github.com/ddkhan24/hordestudio/releases/tag/v17.0.0

## Reply bank

### “How is this different from just prompting a video model?”

The renderer only receives a shot plan. Horde keeps the authored premise, recurring cast, selected choices, canonical timeline, spending rules and Director state around it. The goal is a roleplay loop whose video follows a persistent story, not isolated prompt clips.

### “Is it actually realtime?”

No—not yet, and I do not want to pretend otherwise. V17 renders a complete selected clip after each choice. I am testing pre-rendering and realtime-capable endpoints, but both introduce cost and quality tradeoffs.

### “Why does it need Fal?”

Fal currently provides the video inference layer and model endpoints. The key is stored locally and requests go through Horde's local bridge. Fal bills the generation directly.

### “Is it uncensored?”

Horde does not add a universal content filter, but every selected provider and model can enforce its own policy. Disabling an app preference cannot disable a provider-side policy.

### “Is this replacing Worlds?”

No. Video Adventures are a separate project type. Persistent text Worlds remain the deeper simulation mode.

### “Why should a SillyTavern user care?”

SillyTavern remains the stronger general-purpose chat workbench. This experiment is for people interested in structured world state, simulated lives and branching stories that can become playable video scenes.
