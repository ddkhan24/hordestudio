const fs = require('fs');

const app = fs.readFileSync('app.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('style.css', 'utf8');
let passed = 0;

function check(name, condition) {
    if (!condition) throw new Error(`FAIL: ${name}`);
    console.log(`✓ ${name}`);
    passed++;
}

check('World Visuals model control is a searchable combobox',
    html.includes('id="w-visual-image-model" type="search"')
    && html.includes('aria-controls="w-visual-image-model-results"')
    && html.includes('id="w-visual-image-model-results"'));
check('World Visuals searches the selected provider image catalog',
    app.includes('async function renderWorldVisualModelSearch(world, force = false)')
    && app.includes("getCompanionOutputModels('image', force, provider)"));
check('exact custom model IDs remain an explicit fallback',
    app.includes('custom ID entered') && html.includes('exact custom ID is still accepted'));
check('NPC schedule days use selectable chips rather than comma syntax',
    app.includes('class="block-day"') && !app.includes('class="form-input block-days"'));
check('location regions and floors provide reusable suggestions',
    app.includes('world-region-datalist') && app.includes('world-floor-datalist'));
check('location IDs are protected and linked references migrate on repair',
    app.includes('function renameWorldLocationId(world, location, requestedId)')
    && app.includes('class="form-input loc-id"') && app.includes('readonly title='));
check('starting-life roles, ranks, legal status and icons provide suggestions',
    app.includes('world-origin-icons') && app.includes('world-origin-roles')
    && app.includes('world-origin-ranks') && app.includes('world-origin-legal'));
check('starting-life stat overrides are generated from actual world stats',
    app.includes('class="form-input origin-stat-override"')
    && !app.includes('class="form-input origin-stats'));
check('HUD colors use a native color picker',
    app.includes('type="color" class="form-input stat-color smart-color-input"'));
check('smart controls have responsive and keyboard-visible styling',
    css.includes('.smart-chip-picker input:focus-visible + span')
    && css.includes('@media (max-width: 720px)'));

const primaryModelInputs = [
    'w-visual-image-model', 'w-studio-model', 'w-agent-model', 'w-builder-model-search',
    'studio-model', 'builder-model-search', 'cs-life-builder-model', 'cs-text-model-search',
    'global-default-model', 'global-consolidation-model',
    'global-embedding-model', 'room-model'
];
check('every primary free-form model control has a results surface', primaryModelInputs.every(id => {
    if (id.endsWith('-search')) {
        const base = id.replace(/-search$/, '');
        return html.includes(`id="${id}"`) && (html.includes(`id="${base}-results"`) || html.includes(`id="${id.replace('search', 'results')}"`));
    }
    return html.includes(`id="${id}"`) && html.includes(`id="${id}-results"`);
}));

console.log(`\n${passed} smart-input UX checks passed.`);
