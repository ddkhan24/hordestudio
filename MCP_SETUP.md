# Horde Studio local bridge

The localhost-only bridge serves Horde Studio, connects Higgsfield and
Magnific MCP tools, and safely relays requests to ComfyUI or another local
image server. Provider OAuth tokens remain in the operating-system user
profile and are never exposed to the browser app or included in Horde Studio
backups.

## Start

- macOS: double-click `Start Horde Studio.command`.
- Windows: double-click `Start Horde Studio.bat`.
- Linux: run `./start-horde-studio.sh`.
- Chromebook: enable the Linux development environment, then run
  `./start-horde-studio.sh` from the project folder.

All launchers require Python 3. You can also start it directly:

```sh
python3 horde_mcp_bridge.py --open
```

### HTTPS certificate errors

The bridge verifies HTTPS using operating-system trust and, when installed,
the `certifi` bundle from the same Python interpreter that runs the launcher.
Updating certifi in a different Python installation does not affect the bridge.
For a trusted organization HTTPS proxy, set `HORDE_CA_BUNDLE` to its PEM CA
bundle before starting Horde Studio. An unreadable or invalid bundle produces
an error; certificate verification is never disabled.

An **expired certificate** is different from a missing issuer. If your computer's
date and time are correct, the provider or HTTPS proxy must renew the expired
certificate in its chain. Updating certifi cannot renew a server certificate.
The bridge now identifies the failing host and distinguishes these cases.

Running a launcher again is safe: if Horde Studio already owns its local port,
the launcher opens the existing app instead of starting a duplicate bridge.
If another program owns that port, it reports the conflict rather than opening
the wrong service.

Open `http://127.0.0.1:43127`, then use **Settings → Creative MCP providers**.
Web browsers deliberately cannot execute a local `.command`, `.bat`, or shell
script. The Settings page detects the platform and supplies the appropriate
download; the launcher must be run by the operating system.

The local app and bridge share `127.0.0.1:43127`, so startup cannot leave the
page running without its image-provider bridge. Credentials are stored with
owner-only permissions in:

- macOS: `~/Library/Application Support/Horde Studio/mcp-auth.json`
- Linux: `~/.config/horde-studio/mcp-auth.json`
- Windows: `%APPDATA%/Horde Studio/mcp-auth.json`

Normal Virtual Human exports and Full Backup never include this file.

## ComfyUI

1. Start ComfyUI locally (normally `http://127.0.0.1:8188`).
2. In ComfyUI, export/save the workflow in **API format**.
3. Paste that JSON under **Settings → ComfyUI & local image servers**.
4. Horde Studio auto-detects common positive-prompt and seed nodes. For a
   custom graph, enter the positive prompt node ID and input name.
5. To use a Virtual Human identity image, enter the workflow's `LoadImage`
   node ID as the reference node. Leave it blank for text-to-image workflows.
6. In **Virtual Human Studio → Photos & Voice**, choose **ComfyUI workflow**,
   then use the existing Photo Test before enabling autonomous photos.

The bridge uploads a configured identity reference to `/upload/image`, queues
the API-format graph at `/prompt`, polls `/history/{prompt_id}`, and retrieves
the output from `/view`.

## Other local image generators

Servers exposing an OpenAI-compatible image endpoint can be used independently
of the text provider:

1. Enter its loopback base URL, normally `http://127.0.0.1:7860/v1`.
2. Enter its generation path, normally `/images/generations`.
3. Choose **Local image server** for the Virtual Human and type the server's
   model ID in the searchable model control.

For safety, the bridge accepts only `localhost`, `127.0.0.1`, or `::1` image
server URLs. A local API may return base64 image data, a data URL, or an image
URL. Identity-reference fields are attempted when enabled and retried without
the reference when the selected server rejects them.
