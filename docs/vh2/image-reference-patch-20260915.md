# Image reference patch

Shared photo generation now resolves bundled URLs and blob references to data images before constructing provider requests. Reference labels retain their original order.

ComfyUI accepts multiple references and maps them to comma-separated image node IDs (or LoadImage nodes when no mapping is supplied). Insufficient capacity fails before upload/submission. Returned upload subfolders are preserved. Manual ComfyUI selection is not overridden by an older cloud renderer.

Google Gemini direct API is exposed in Person photo source controls with model and API-key setup. Keys stay in the local service provider store, not the exported character. Starter/manual generation uses the existing native Gemini adapter; active life uses its durable image path.

Verified: three ComfyUI mocked transport tests, fourteen image adapter recovery tests, shared URL/blob conversion and Google request routing, reference role numbering, JavaScript syntax, and isolated desktop/mobile social browser regression. Live ComfyUI workflows and paid Google/OpenRouter generation were not exercised.
