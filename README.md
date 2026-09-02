![Horde Studio 17 — Your Story. Your Choices. Now in Motion.](assets/marketing/v17.0.0/horde-studio-v17.0.0-launch-poster.png)

<div align="center">

# Horde Studio 17

### Build characters. Shape worlds. Simulate lives.

**A local-first creative studio for persistent AI stories that remember, react, and evolve.**

Characters & group rooms · Living sandbox worlds · Autonomous virtual humans · Local models & cloud providers

</div>

## What is Horde Studio?

**Horde Studio 17** is a creator-focused AI roleplay and simulation platform that brings character chat, interactive video storytelling, persistent worldbuilding, virtual-human simulation, and host-powered multiplayer into one application.

It is designed for stories that need to **remember, react, and evolve**. Build a cast, create a world around them, carry consequences across sessions, or simulate an AI person with routines, relationships, moods, memories, and multiple timelines.

Horde Studio is **local-first**: the application runs on your computer and stores its primary state in your browser. You decide whether generation happens through a local model or a connected cloud provider.

> [!NOTE]
> Local-first does not automatically mean fully offline. Content sent to a cloud model or media provider is processed under that provider's own terms. Use a local OpenAI-compatible endpoint when you want generation to remain on your machine.

---

## See it in action

### Real in-app screenshots

<table>
  <tr>
    <td width="50%"><img src="assets/marketing/v16.6.0/reddit-pack/screenshots/08-living-world-gameplay.png" alt="Horde Studio living World gameplay with persistent location, time, character stats and outfit state" /></td>
    <td width="50%"><img src="assets/marketing/v16.6.0/reddit-pack/screenshots/06-virtual-human-social.png" alt="Horde Studio Virtual Human conversation with an optional persistent social feed" /></td>
  </tr>
  <tr>
    <td align="center"><strong>Living Worlds</strong><br />Location, time, outfits, meters, mechanics and consequences stay attached to play.</td>
    <td align="center"><strong>Virtual Humans</strong><br />Texting timelines connect to schedules, memory, delayed replies and an optional public life.</td>
  </tr>
</table>

![Horde Studio dedicated multiplayer campaign hub](assets/marketing/v16.6.0/reddit-pack/screenshots/04-multiplayer-hub.png)

Dedicated Multiplayer keeps party identities, campaign state and the host's model connection separate from single-player saves.

### Virtual humans who have somewhere else to be

![A Horde Studio Virtual Human conversation with real-time status, autonomous messages, timelines, and an in-chat generated photo](assets/readme/virtual-human-chat.png)

Virtual Humans maintain their own clock, routine, mood, relationship state, memories, and availability. They can reply late, follow up on their own, refuse a request, send a context-aware photo or voice note, and continue across persistent or forked timelines.

<table>
  <tr>
    <td width="50%">
      <img src="assets/readme/world-living-society.png" alt="World Studio starting lives and living society editor" />
    </td>
    <td width="50%">
      <img src="assets/readme/world-npc-editor.png" alt="World Studio NPC autonomy and agenda editor" />
    </td>
  </tr>
  <tr>
    <td align="center"><strong>Start anywhere</strong><br />Create starting lives, homes, families, roles, schedules, and social ties.</td>
    <td align="center"><strong>Build people with agency</strong><br />Give NPCs goals, secrets, routines, autonomy, and persistent relationships.</td>
  </tr>
</table>

> Screens shown are from the real application. Generated character imagery depends on the image provider and model you connect.

---

## Core experiences

### Video Adventures — new in 17

Video Adventures are a separate, story-first roleplay mode built around short generated scenes and contextual player choices. A fast World Director plans the complete bounded decision tree as inexpensive text in advance; Horde validates it, then renders only the opening and the path the player actually chooses so unused branches never incur video costs.

- Context-aware choices across preplanned 4- or 13-scene blocks, plus a go-off-script action that prepares a new block
- Persistent characters, reference images, visual styles, player viewpoint, canon and timelines
- First-person and visible-player presentation modes
- MiniMax H3 Max, Wan 3.0, Wan 3.0 Prime and LTX-2.3 Fast renderer selection
- Ordered automatic fallbacks that preserve the Director beat and continuity frame
- Background jobs, cancellation, recovery, local clip storage and timeline deletion
- Session spending limits with renderer-aware duration and price estimates
- Fal image generation for World visuals and Virtual Human photos
- Fal video generation for Virtual Human story clips

Video Adventures remain separate from simulation Worlds: neither definitions nor timelines are silently shared between the two experiences.

### Persistent story memory — new in 16.7

Character chats now keep a durable story continuity separate from individual chat sessions. Facts, relationships, current state, unresolved threads, and important scenes survive long-running roleplay without flooding the model with the entire transcript.

- Continue, fork, or start fresh when creating a chat session
- Hybrid semantic and local lexical recall with recency, importance, pinned-canon, state, and open-thread weighting
- Structured provenance so edited, rerolled, or deleted messages can invalidate memories they created
- Contradiction handling that supersedes stale canon instead of silently keeping both versions
- A dedicated Story Memory inspector for searching, pinning, editing, archiving, and deleting durable memories
- Backward-compatible migration for existing episodic summaries and embedding caches

### Optional RPG systems — new in 16.6

![Horde Studio 16.6 optional RPG systems](assets/marketing/v16.6.0/horde-studio-v16.6.0-rpg-systems.png)

Worlds and dedicated Multiplayer campaigns now share one system-agnostic mechanics engine. Use **Off** for pure narrative, **Light** for equipment and checks, or **Full** for progression, requirements, resources and persistent effects.

- Weapons, armor, clothing, consumables, tools, cyberware and custom items
- Equipment slots, damage, armor, charges, durability, rarity and requirements
- Gear modifiers for attributes, skills, defenses, resources and checks
- Visible base and effective values on character sheets
- Buffs, debuffs, status effects and progression in Full mode
- Non-destructive live mechanics switching in Worlds and Multiplayer
- Backward-compatible migration for existing text inventories

The rules layer is optional. Disabling it pauses mechanics without deleting the party's builds, equipment or authored state.

### Characters & Group Rooms

Create individual AI characters or bring a full cast into a shared room.

- Detailed character profiles, personas, greetings, examples, and behavioral instructions
- One-to-one and multi-character roleplay
- Multiple chat sessions, rerolls, continuations, editing, and summaries
- Lorebooks, author guidance, long-term memory, presets, and regex scripts
- SillyTavern-compatible character-card and preset imports

### Persistent Worlds

Build a playable setting instead of a disposable chat background.

- Locations, maps, rooms, exits, NPCs, factions, settlements, and items
- Quests, shops, inventories, stats, relationships, schedules, and starting lives
- Travel, time, weather, outfits, world events, story threads, and secrets
- Autonomous NPC goals, faction activity, movement, markets, and world-state changes
- Persistent timelines that preserve the consequences of play
- World audit and calibration tools for catching inconsistent state

### Dedicated Multiplayer

- Multiplayer campaigns remain separate from single-player saves and UI
- One host owns canonical state and supplies the AI connection
- Every player has an independent persona, sheet, inventory and turn
- LAN rooms and bring-your-own Internet WebSocket relays
- Round-robin play, reconnecting guests, permissions and party votes
- Synchronized rules, equipment, resources, effects, encounters and progression

### Virtual Humans

Create an AI person designed to feel like they have a life beyond the current message.

- Identity, personality, inner life, mood, relationships, and private boundaries
- Eight-channel mixed emotions, appraisal, masking, rumination and delayed reactions
- Optional adult-only desire and intimacy dynamics kept separate from trust, attraction and consent
- Workweeks, sleep cycles, routines, commitments, locations, and wardrobes
- Evolving memory and relationship context
- Autonomous messages, photos, voice notes, and live-call-style interaction
- Real-location and Open-Meteo weather grounding
- Fresh timelines, persistent timelines, and timeline forks
- Jane Harlow and Ashlyn “Ash” Reynolds included as complete showcase humans

### Local-First Creative Control

- Browser-based local storage through IndexedDB
- Localhost-only Python bridge
- Bring your own model and media providers
- Optional **Horde Labs** cognition through a local server, the in-app **TinyBrain 2 / Needle** structured router, or the legacy embedded runtime
- Validated local assists for social cues, world continuity, life beats, status briefs, and chat meters
- Exportable characters, worlds, timelines, and backups
- Provider credentials kept outside normal Horde Studio exports
- No Node.js build process and no external Python packages required

---

## Supported providers

### Text generation

| Mode | Examples |
|---|---|
| Cloud | OpenRouter, GPTProto, NanoGPT, NVIDIA NIM, Amazon Bedrock |
| Local / self-hosted | Ollama, LM Studio, KoboldCpp, llama.cpp, vLLM, text-generation-webui, and other OpenAI-compatible servers |

### Images and creative tools

| Integration | Use |
|---|---|
| ComfyUI | Run API-format image workflows locally |
| OpenAI-compatible local image servers | Generate images through a local-device or private-LAN endpoint |
| Higgsfield MCP | Connected creative-media tools through the local bridge |
| Magnific MCP | Connected enhancement tools through the local bridge |

### Additional services

- Open-Meteo geocoding and weather data
- Browser and provider-based text-to-speech options

---

## Quick start

### Requirements

- Python 3
- A modern desktop browser
- An AI provider or local model server for generation

No `npm install`, build command, virtual environment, or `pip install` is required for the included application.

### macOS

Double-click:

```text
Start Horde Studio.command
```

If macOS blocks execution, run this once inside the project directory:

```bash
chmod +x "Start Horde Studio.command" start-horde-studio.sh
./start-horde-studio.sh
```

### Windows

Double-click:

```text
Start Horde Studio.bat
```

### Linux / Chromebook Linux environment

```bash
chmod +x start-horde-studio.sh
./start-horde-studio.sh
```

### Direct launch

```bash
python3 horde_mcp_bridge.py --open
```

Horde Studio opens at:

```text
http://127.0.0.1:43127
```

Running the launcher again is safe. If Horde Studio already owns the port, it opens the existing instance rather than starting a duplicate bridge.

To use a different port:

```bash
HORDE_MCP_PORT=43128 python3 horde_mcp_bridge.py --open
```

---

## First-time setup

1. Launch Horde Studio.
2. Open **Settings**.
3. Choose a text provider:
   - Add an OpenRouter or GPTProto key, or
   - Configure a local OpenAI-compatible server.
4. Select a model and test the connection.
5. Optionally configure image generation, voice, weather grounding, and MCP providers.
6. Create a character, virtual human, or world.

---

## Local model examples

Use the base URL exposed by your local server. Exact model IDs and endpoints depend on the application running the model.

| Server | Common base URL |
|---|---|
| Ollama | `http://127.0.0.1:11434/v1` |
| LM Studio | `http://127.0.0.1:1234/v1` |
| KoboldCpp | `http://127.0.0.1:5001/v1` |
| llama.cpp server | `http://127.0.0.1:8080/v1` |

> [!TIP]
> If your model server runs on another computer on your LAN, the application's Content Security Policy must explicitly allow that machine's IP address.

---

## ComfyUI setup

1. Start ComfyUI, normally at `http://127.0.0.1:8188`.
2. Export your workflow in **API format**.
3. In Horde Studio, open **Settings → ComfyUI & local image servers**.
4. Paste the workflow JSON.
5. Confirm or override the detected prompt and seed nodes.
6. Add a `LoadImage` node ID when the workflow should receive a Virtual Human identity reference.
7. Run the built-in photo test before enabling autonomous image generation.

The local bridge uploads configured references, queues the graph, polls its history, and retrieves the generated image without exposing bridge credentials to the browser application.

---

## Import and export

Horde Studio supports portable project data and common roleplay formats.

### Character and chat formats

- `.horde`
- `.nexus`
- SillyTavern PNG character cards
- SillyTavern-style chat-completion preset JSON
- Full Horde Studio backups

### World formats

- `.horde_world`

### Virtual Human data

- Virtual Human archives
- Persistent and forked timelines
- Included memories, relationship state, messages, and simulation state where supported by the selected export

Keep backups of important projects before upgrading or making large structural changes.

---

## Data and privacy

### Application data

Primary application state is stored in browser **IndexedDB** under the Horde Studio origin.

Deleting browser site data, using a different browser profile, or changing the local origin can make that state unavailable. Export regular backups.

### MCP credentials

OAuth credentials used by the local bridge are stored with owner-only permissions outside the browser app:

| Platform | Location |
|---|---|
| macOS | `~/Library/Application Support/Horde Studio/mcp-auth.json` |
| Linux | `~/.config/horde-studio/mcp-auth.json` |
| Windows | `%APPDATA%/Horde Studio/mcp-auth.json` |

Normal Virtual Human exports and full application backups do **not** include this credential file.

### Network scope

The included bridge binds to `127.0.0.1` rather than exposing the application to the wider network.

---

## Project structure

```text
Horde Studio 10+/
├── index.html                  # Application shell and views
├── style.css                   # Complete visual system
├── app.js                      # State, UI, chat, worlds, and simulations
├── rpg-mechanics.js            # Shared optional RPG and equipment rules
├── multiplayer-engine.js       # Canonical multiplayer campaign state
├── multiplayer.js              # LAN/Internet party UI and synchronization
├── presets.js                  # Included system presets
├── horde_mcp_bridge.py         # Local server, MCP auth, and image relay
├── MCP_SETUP.md                # Detailed bridge and media setup
├── Start Horde Studio.command  # macOS launcher
├── Start Horde Studio.bat      # Windows launcher
├── start-horde-studio.sh       # Linux/macOS shell launcher
└── scratch/                    # Audits, fixtures, and stress tests
```

---

## Architecture

Horde Studio intentionally keeps its stack simple and portable.

- **Frontend:** vanilla HTML, CSS, and JavaScript
- **Persistence:** IndexedDB
- **Local bridge:** Python standard library
- **Text APIs:** OpenAI-compatible chat-completion patterns plus supported cloud providers
- **Media:** ComfyUI, compatible local image endpoints, MCP integrations, and TTS
- **Build system:** none

This makes the project easy to inspect, modify, back up, and run without a package manager.

---

## Development

Clone or download the repository, then run the local bridge:

```bash
git clone <YOUR_REPOSITORY_URL>
cd "Horde Studio 10+"
python3 horde_mcp_bridge.py --open
```

Edit the source files directly:

- `index.html` for structure
- `style.css` for presentation
- `app.js` for application behavior
- `presets.js` for bundled presets
- `horde_mcp_bridge.py` for localhost bridge behavior

Reload the browser after making changes. There is no compilation step.

The `scratch/` directory contains browser harnesses, world fixtures, audits, and stress tests for systems such as movement, factions, quests, shops, simulation state, timeline seeds, and world consistency.

---

## Safety notes

- Never commit API keys, OAuth files, exported private conversations, or personal Virtual Human archives.
- Review third-party model and media-provider privacy policies before sending sensitive content.
- Only import character cards, presets, worlds, and backups from sources you trust.
- Keep the bridge bound to loopback unless you fully understand the security implications of exposing it.

---

## Feedback and contributions

Horde Studio is built for writers, roleplayers, worldbuilders, local-model users, and creators who want deeper simulation than a standard chatbot provides.

Useful feedback includes:

- Reproducible bugs
- Model-specific prompt or formatting failures
- Broken import/export cases
- World-state inconsistencies
- Performance issues in long-running timelines
- Accessibility and usability improvements

When reporting an issue, include your operating system, browser, provider, model, reproduction steps, and a redacted export when possible.

---

<div align="center">

## Launch your universe.

**Characters that remember. Worlds that evolve. Lives that continue.**

</div>
