# Third-party notices

## Node.js runtime for Virtual Humans

Portable Horde Studio packages include unmodified Node.js v24.21.0 executables for the supported desktop platforms. They are staged from the official Node.js release archives after SHA-256 verification. The upstream license text is included at `runtime/LICENSE` inside the portable app.

- Official release: https://nodejs.org/download/release/v24.21.0/
- Upstream license: https://github.com/nodejs/node/blob/v24.21.0/LICENSE

## Cactus Needle 2 / TinyBrain 2

Horde Studio can optionally download the official Cactus Needle 2 browser runtime and model from `Cactus-Compute/needle2` after the user explicitly chooses **Download & install**. The assets are stored in that browser profile's cache and are not included in Horde Studio backups.

- Project: https://github.com/cactus-compute/needle
- Model/runtime assets: https://huggingface.co/Cactus-Compute/needle2
- Model package license: Apache License 2.0
- Upstream source repository license: see the license included by the upstream repository/revision

Horde Studio does not modify or redistribute the downloaded model weights. TinyBrain 2 output remains advisory and is subject to Horde Studio's confidence gates and deterministic validators.

## Freaky Frankenstein 5.4 Internal States

Horde Studio bundles dptgreg's Freaky Frankenstein 5.4 Internal States SillyTavern preset, including its accompanying FF5 Regex 3.0 definitions, alongside the earlier Freaky Frankenstein 4 MAX preset. The 5.4 preset is adapted at runtime for Horde's macro, rendering, and context systems; the upstream data is retained in `presets.js`.

- Author's archive: https://rentry.org/freaky-frankenstein-presets
- Original download: https://www.mediafire.com/file/9f70q840092j5lr/Freaky_Frankenstein_5.4_Internal_States_%25282%2529.json/file
- Upstream JSON SHA-256: `1a42fbbfebdf23ce3bc243dc340b6d400bbb713ba882e8f81d921e162ccb893a`
