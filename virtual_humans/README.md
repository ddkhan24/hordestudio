# Virtual Humans source layout

Virtual Humans 2.0 and its shared VH components live here instead of as loose files in the application root.

- `frontend/`: character and life workspace UI, page builders, CSS, browser integration, and the developer dashboard.
- `engine/`: deterministic JavaScript simulation modules, Node worker entry points, and their JSON schemas/policies. CommonJS imports stay relative to this folder.
- `backend/`: Python service modules for persistent lives, dialogue, providers, media, people, places, and supporting systems. Modules use package-relative imports; application entry points import from `virtual_humans.backend`.

The application shell (`index.html`, `app.js`, `style.css`) and local server entry point (`horde_mcp_bridge.py`) remain at the root. Launch Horde Studio through the existing platform launchers. There are no compatibility copies of VH source files at the root.

`WorldService` continues to receive the application root as `app_dir`. Its worker and source paths are resolved into this tree. Browser assets use `/virtual_humans/frontend/` and `/virtual_humans/engine/` URLs. The server retains legacy asset URL aliases for cached pages; those aliases serve the relocated files rather than duplicate source files.

Portable builds preserve this tree under `app/virtual_humans/`. Tests and developer utilities remain in `scratch/` and `scripts/`.
