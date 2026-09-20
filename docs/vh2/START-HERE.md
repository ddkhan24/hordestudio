# Virtual Humans 2.0 in Horde Studio 18

Virtual Humans have a persistent life with shared places, needs, supporting people, memories, social posts and conversations. Each player persona has its own conversation and relationship within that life.

## Start

Extract the entire portable application and use the launcher at the top level: `Start Horde Studio.bat` on Windows, `Start Horde Studio.command` on macOS, or `start-horde-studio.sh` on Linux. Keep the `app` folder beside the launchers; it holds the supporting files. Python 3 and Node.js 18 or newer are required; Node can also be configured with `HORDE_NODE_EXECUTABLE`. Provider keys are configured in Settings → Connections.

Open Virtual Humans 2.0 to select Aslyn Jonas or create a person. Aslyn starts a fresh life with an empty conversation history, her authored relationships with supporting people, and a starter feed, gallery and clips. The included character contains no publisher chat sessions or personal player memories.

## Create a complete person one system at a time

**New human** opens the system map. **Edit human** is the durable authored person and starting world; **Live human** is the separate evolving timeline and history. The editor keeps the full system available while grouping it into Identity & history, Psychology & relationship, Conversation & expression, World & autonomous life, Social presence, Appearance/photos/voice, Video & clips, and Models & providers.

Age, appearance and body/access are visible in Identity & history. Each relevant field has attached help and an optional **AI draft** action. Page-level drafting starts with no fields selected: choose exactly what to draft, review the exact request count, and apply only the results you want. Credentials, numeric controls and media generation remain explicit settings/actions.

1. A field action selects exactly that field. A page action starts with no fields selected; choose what you want and review the displayed request count.
2. Enter your direction and model, then draft. Each selected field uses a separate small text request and provider credits.
3. Review and edit the results. If one field fails, retry just that field; completed drafts remain available. **Stop generating** keeps completed results in the open review window.
4. Select the results to keep and choose **Apply selected drafts to editor**, then **Save changes and close** or **Save human**. Review copies text into the editor; saving uses the displayed destination. Closing the draft window discards results you have not copied into the editor.

Open **Chat** when identity and a text model are ready. Starting a persistent life is optional; sleep, availability and intentional silence apply once that timeline exists. Existing characters and imported lives keep their timing settings. Configure a text connection under **Models & providers** when needed. A fictional scenario or solitary character does not require supporting people, employment or every optional system.

World & autonomous life lets you draft or edit places, people, clothes and routines separately. The full person-and-world generator has been retired; generation is scoped to fields, pages or chosen life sections. Open **Live human** to inspect activity, relationships, places, references and autonomous permissions. Controls there save to the selected timeline.

The local server must remain running for background life. Catch-up resumes after downtime; no simulation process runs while the computer is off.

## Social media and clips

The social drawer has Feed, Gallery and Clips tabs. Photos retain their proportions. Gallery ideas can store prompts and references without generating a paid image. Image activity shows submitted work and failures. Manual generation and autonomous spending limits are separate.

Clips render on demand. Draft descriptions are production instructions, not messages from a player. Captions and controls appear below the video; use Edit caption to change the public text. Generation uses your selected video provider and references supported by that model.

Aslyn includes approved references for all 22 authored places and six rooms. Fictional homes and workplaces use generated interiors; public settings are inspired by their real surroundings. Discovered map venues may have geographic data without a dedicated image reference. Provider reference limits still apply.

## Export and import

Export offers a clean character template or a Full Portable Human with conversations and saved life. New exports are `.horde_human.zip` packages. `character.json` holds the manifest; media and compressed life backups are separate files. Import the ZIP directly without unpacking it. Older JSON `.horde_human` files remain supported.

Full Portable Human preserves personal conversation history. Use a clean template when sharing a character without that history. A restored life is an isolated copy; existing lives are never overwritten and uncertain paid jobs are not automatically submitted again.

Export reports missing assets and backup errors instead of silently dropping media. Keep the original installation until you have verified the imported copy.

## Limits

The simulator models needs, decisions, interactions and continuity. It does not establish consciousness or guarantee human realism. Provider quality and availability vary. Map data, live feeds and cloud generation require the corresponding configuration. Purchases and money within the simulation are fictional; provider charges are real.

## Field help and saved text

Relevant fields have a visible `?` help control beside the label. Fields show their character counts and limits. A paste is kept intact; an oversized field blocks saving with its field name and limit instead of silently clipping the text. Appearance supports up to 60,000 characters in the editor. Provider context and live-timeline expression requests have separate size budgets, so very large profiles can still require shortening before sending to a model.

**Save human** saves the durable template. The save destination can also update expression in the active life; the receipt distinguishes those operations. If storage fails, the editor retains your draft. If only the life update fails, the receipt says the template was saved and the life update was not confirmed. **Edit human → More actions → Error log** shows recent authoring errors for this page session; reloading clears that log. Saved provider-job failures remain available in Chat's reply details and Image activity.

## Small drafts, including solitary characters

Life section requests contain only the requested output schema. Text habits, an empty supporting cast, and no recurring commitments are valid choices. A character does not need friends, a job or a modern setting to use the writing pages. Optional simulation systems still have their own rules; writing a fictional motive does not guarantee a particular autonomous event.

If a multi-section draft fails or is stopped, use **Review completed sections** or **Retry missing sections**. Finished sections are retained in the open dialog, and retry skips them. There is no whole-character or whole-world generation action. Each section helper shows its request count before generation.

## Reply availability, limits and diagnostics

Chat shows the current life status and waiting reason, with Pause/Resume, an activity-editing action and access to restart. A busy commitment allows attention breaks; private time and sleep can defer conversation. In Life → Routine, a commitment's start/end describe its occupied time, while an activity's opportunity window describes when it may be chosen. Its duration is a separate value. Correct an accidentally day-long meal by editing the commitment instead of restarting the whole character.

**Usage & reply details → Text request budgets** in Chat shows this character's foreground and background allowances, usage and UTC reset. New foreground connections do not inherit a cap from disabled Always On. Older shared caps are retained visibly until you explicitly choose new budgets. Zero blocks a category; turning off the foreground cap allows provider-billed chat/call requests without a local daily ceiling. Budget changes do not resubmit failed jobs automatically.

**Usage & reply details → Reply details** shows the attempt's model, status, failure reason, provider-reported token usage when supplied, and a bounded redacted prompt preview. A missing token report is shown as unavailable, never as zero or a fabricated estimate. Models are selected through the character's text provider; paid live responses still depend on that provider's model access, credentials and availability.

## Places, rooms and optional switches

A place is a location; rooms are interiors within a place. Places and rooms can be edited during a running life. Remove unused placeholders with **Remove place** or the room removal action. A current location or one referenced by a journey, schedule, residence or other active rule cannot be removed until those dependencies are changed. Removal keeps recorded history and archives linked reference entries.

Gifts, mailed gifts and money use visible keyboard-operable checkboxes. Save their preferences to the selected life. These are fictional simulation permissions, separate from provider billing.

## Editable files and real image output

Export also offers **Editable JSON Template**. It downloads readable JSON with embedded starter media; edit authored fields in a text editor and import the JSON through the ordinary Import button. It creates a separate character. Keep embedded image/video data unchanged. Use Full Portable Human for a complete historical backup.

Chat Library characters can use image generation when their image capability, provider and model are configured. Generated output must decode as an image before it becomes a successful attachment. VH2 likewise imports actual image bytes before delivering a photo; a prompt-only result is an error, with its failure shown in Image activity.

For Magnific certificate failures, see `MCP_SETUP.md`. The bridge verifies HTTPS using its default trust store plus installed `certifi` or an explicit `HORDE_CA_BUNDLE`. A genuinely expired provider/proxy certificate must be renewed by its operator; certificate verification is never disabled. Windows uses the `.bat` launcher, macOS `.command`, and Linux `.sh`.
