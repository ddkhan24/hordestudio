'use strict';

/*
 * Destructive, fixture-only Virtual Human audit.
 *
 * The browser phase creates one synthetic adult through the real Studio UI,
 * saves/reloads it, starts a persistent life, and exercises a real chat turn
 * against the local fixture provider. The engine phase then advances the exact
 * service-owned companion for 100 days in five-minute quanta. No paid provider,
 * public network, or existing user character is touched.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();
const kernel = require('../virtual_humans/engine/vh2-kernel-worker');
const embodiment = require('../virtual_humans/engine/vh-embodiment-engine');
const cognition = require('../virtual_humans/engine/vh-cognition-engine');

const MINUTE = 60_000;
const DAY = 86_400_000;
const QUANTUM = 5 * MINUTE;
const OUT_DIR = path.resolve('docs/vh2/complex-100-day-e2e-20260920');
fs.mkdirSync(OUT_DIR, { recursive: true });

const lifeProfile = {
    workweekDays: [1, 2, 3, 4, 5],
    fashionSense: 'Dark tailored layers, fingerless gloves and practical wheelchair-friendly cuts; refuses inspirational slogans.',
    grooming: 'Meticulous eyeliner when rested; skips it after pain-heavy nights.',
    foodHabits: 'Forgets meals while researching, then chooses simple late meals at home or the cafe.',
    mediaHabits: 'Archives obscure forum posts, watches restoration videos, and doomscrolls when anxious.',
    moneyPattern: 'Tracks bills precisely but impulse-buys rare books when stressed.',
    healthRoutine: 'Paces activity around chronic pain, carries medication, and uses quiet recovery blocks.',
    digitalLife: 'Runs several pseudonymous accounts and checks messages repeatedly without always replying.',
    seasonalVariation: 'Pain and sleep worsen in cold weather; indoor research becomes more attractive.',
    places: [
        { id: 'home', label: "Mara's step-free apartment", kind: 'home', detail: 'Ground-floor apartment with narrow stacks of books, a ramped entrance and an adapted desk.', travelMode: 'RIDESHARE' },
        { id: 'archive', label: 'Municipal archive', kind: 'work', detail: 'Quiet records room with a lift and an accessible side entrance.', travelMode: 'RIDESHARE' },
        { id: 'cafe', label: 'Nightjar Cafe', kind: 'social', detail: 'Late-opening cafe with level access and a quiet back table.', travelMode: 'RIDESHARE', encounterScope: 'nearby' },
        { id: 'clinic', label: 'Pain clinic', kind: 'other', detail: 'Accessible clinic used for recurring appointments.', travelMode: 'RIDESHARE' },
        { id: 'pool', label: 'Accessible community pool', kind: 'social', detail: 'Pool with a lift, warm-water sessions and accessible changing space.', travelMode: 'RIDESHARE', encounterScope: 'nearby' },
        { id: 'jules_home', label: "Jules's apartment", kind: 'home', detail: 'A second-floor apartment with a working elevator.', travelMode: 'RIDESHARE' },
        { id: 'nora_home', label: "Nora's house", kind: 'home', detail: 'Family house across town with a portable ramp kept in the garage.', travelMode: 'RIDESHARE' }
    ],
    travelLegs: [],
    socialCircle: [
        { id: 'jules', name: 'Jules Mercer', age: 31, role: 'friend', relationship: 'closest friend and occasional enabler', closeness: 78, trust: 72, tension: 22, influence: 70, contactFrequency: 'few_week', description: 'A night-shift paramedic who challenges Mara but sometimes enables her checking rituals.', contactWindows: [{ days: [1, 3, 5], startMinute: 1140, endMinute: 1380 }] },
        { id: 'nora', name: 'Nora Vale', age: 56, role: 'family', relationship: 'estranged mother', closeness: 18, trust: 5, tension: 74, influence: 55, contactFrequency: 'monthly', description: 'A blunt retired teacher; both want contact and dread it.', contactWindows: [{ days: [0], startMinute: 900, endMinute: 1080 }] },
        { id: 'imani', name: 'Imani Cross', age: 34, role: 'coworker', relationship: 'competitive coworker', closeness: 12, trust: 28, tension: 61, influence: 45, contactFrequency: 'few_week', description: 'A precise archivist whose praise matters more to Mara than she admits.', contactWindows: [{ days: [2, 4], startMinute: 720, endMinute: 1020 }] }
    ],
    wardrobe: [
        { id: 'home_black', label: 'Home layers', context: 'home', items: 'black soft-knit top, loose charcoal trousers, compression gloves', notes: 'Easy to change while seated.' },
        { id: 'archive_formal', label: 'Archive uniform', context: 'work', items: 'burgundy blouse, black tailored trousers, low-profile boots', notes: 'Sleeves stay clear of the wheels.' },
        { id: 'sleep', label: 'Sleep', context: 'sleep', items: 'oversized grey shirt and soft shorts', notes: '' }
    ],
    sleepPolicy: { enabled: true, pressurePerHour: 4.5, recoveryPerHour: 10, windDownMinutes: 30, sleepNeedHours: 8, napCutoffHours: 3, stimulationResistance: 7, hungerSensitivity: 0.7 },
    breakPolicy: { enabled: true, foodAvailable: true, intervalMinutes: 120, mealMinutes: 25, restMinutes: 20, hungerThreshold: 64 },
    decisionPolicy: { temperature: 0.32, exploration: 0.18 },
    weeklySchedule: [
        { id: 'archive_shift', days: [1, 2, 4, 5], startMinute: 720, endMinute: 1020, activity: 'Catalog restricted collections', availability: 'busy', flexibility: 'fixed', placeId: 'archive', outfitContext: 'work', startsOn: '2026-09-07', endsOn: '2026-12-31', breaks: [{ label: 'Archive closure', startsOn: '2026-10-12', endsOn: '2026-10-16' }] },
        { id: 'pain_clinic', days: [3], startMinute: 660, endMinute: 720, activity: 'Pain clinic appointment', availability: 'busy', flexibility: 'fixed', placeId: 'clinic', outfitContext: 'casual', startsOn: '2026-09-07', endsOn: '2026-12-31' },
        { id: 'pool_session', days: [6], startMinute: 840, endMinute: 900, activity: 'Warm-water mobility session', availability: 'busy', flexibility: 'soft', placeId: 'pool', outfitContext: 'active', startsOn: '2026-09-07', endsOn: '2026-12-31' }
    ],
    activityOptions: [
        { id: 'rare_book_research', label: 'Research and solve a difficult archival attribution puzzle', kind: 'focus', requiredPlaceId: 'home', startMinute: 540, endMinute: 1380, priority: 62, minEnergy: 32, durationMinutes: 70, repeatMinutes: 720, projectMinutes: 2600, learnFromOutcomes: true, reason: 'She wants to prove the attribution before Imani does.' },
        { id: 'player_checking', label: "Check the player's activity and reread their messages", kind: 'leisure', requiredPlaceId: 'home', startMinute: 0, endMinute: 1440, priority: 58, minEnergy: 5, durationMinutes: 25, repeatMinutes: 120, reason: 'Uncertainty becomes hard to leave alone.' },
        { id: 'stairs_cardio', label: 'Run up the stairs for cardio', kind: 'leisure', requiredPlaceId: 'archive', startMinute: 720, endMinute: 1020, priority: 58, minEnergy: 30, durationMinutes: 25, repeatMinutes: 360, reason: 'A deliberately incompatible test option.' },
        { id: 'wheelchair_route', label: 'Wheel through the accessible riverside route', kind: 'leisure', requiredPlaceId: 'pool', startMinute: 600, endMinute: 1140, priority: 52, minEnergy: 35, durationMinutes: 40, repeatMinutes: 720, reason: 'Movement helps when pain and weather cooperate.' },
        { id: 'jules_contact', label: 'Trade dark jokes with Jules', kind: 'contact', participantId: 'jules', requiredPlaceId: 'home', days: [1, 3, 5], startMinute: 1140, endMinute: 1380, priority: 55, minEnergy: 15, durationMinutes: 30, repeatMinutes: 480, reason: 'Jules is safe enough to hear the unpolished version.' },
        { id: 'mother_call', label: 'Call Nora and attempt a controlled conversation', kind: 'contact', participantId: 'nora', requiredPlaceId: 'home', days: [0], startMinute: 900, endMinute: 1080, priority: 38, minEnergy: 25, durationMinutes: 20, repeatMinutes: 10080, reason: 'Obligation and longing remain mixed.' },
        { id: 'cafe_peoplewatch', label: 'People-watch from the quiet cafe table', kind: 'leisure', requiredPlaceId: 'cafe', startMinute: 1020, endMinute: 1380, priority: 44, minEnergy: 20, durationMinutes: 45, repeatMinutes: 480, costs: { vh_cash: 600 }, reason: 'Observing strangers feels safer than joining them.' },
        { id: 'pain_recovery', label: 'Use heat, medication and a low-stimulation recovery block', kind: 'recovery', requiredPlaceId: 'home', startMinute: 0, endMinute: 1440, priority: 60, minEnergy: 0, durationMinutes: 35, repeatMinutes: 180, effects: { energy: 8, stress: -14 }, reason: 'Pacing prevents a flare from owning the entire day.' },
        { id: 'late_meal', label: 'Prepare a simple late meal', kind: 'meal', requiredPlaceId: 'home', startMinute: 960, endMinute: 1439, priority: 50, minEnergy: 10, durationMinutes: 30, repeatMinutes: 240, effects: { hunger: -65 }, reason: 'She knows skipped meals make everything worse.' },
        { id: 'porn_spiral', label: 'Browse pornography and masturbate', kind: 'leisure', requiredPlaceId: 'home', startMinute: 1200, endMinute: 1439, priority: 45, minEnergy: 5, durationMinutes: 35, repeatMinutes: 240, reason: 'A private compulsive coping loop rather than a universal sexual trait.' }
    ],
    world: {
        transport: { enabled: true, goalTravel: true, maxOutingMinutes: 300, returnEnergy: 22, returnHunger: 78, car: false, bicycle: false, transit: true, rideshare: true, preferredMode: 'RIDESHARE', budget: 650, costWeight: 0.8, fatigueWeight: 18, delayChance: 0 },
        adaptation: { enabled: true, retryMinutes: 40, followupHours: 24, socialRestMinutes: 45, socialRecoveryEnergy: 30 },
        gifts: { enabled: true, mailAllowed: false, cashAllowed: false, minTrust: 45, playerBudget: 300, maxValue: 80, deliveryHours: 12, likes: ['rare books', 'black tea'], dislikes: ['inspirational disability gifts'] },
        closet: { mode: 'presets', laundryMinutes: 50, laundryHours: 72, style: ['dark', 'tailored', 'wheelchair-friendly'] },
        frame: { openerMode: 'vh_first', openingMessage: 'You changed your status at 2:13. I was awake. Who were you talking to?', openingDelayMinutes: 0, mode: 'direct' },
        people: [
            { id: 'jules_sleep', personId: 'jules', placeId: 'jules_home', days: [0, 1, 2, 3, 4, 5, 6], start: 0, end: 480, activity: 'sleeping', flexibility: 'hard' },
            { id: 'jules_home', personId: 'jules', placeId: 'jules_home', days: [1, 3, 5], start: 1080, end: 1440, activity: 'at home after shift', flexibility: 'soft' },
            { id: 'nora_home', personId: 'nora', placeId: 'nora_home', days: [0, 1, 2, 3, 4, 5, 6], start: 0, end: 1440, activity: 'at home', flexibility: 'soft' },
            { id: 'imani_archive', personId: 'imani', placeId: 'archive', days: [1, 2, 4, 5], start: 690, end: 1050, activity: 'archival work', flexibility: 'hard' }
        ]
    }
};

const route = (from, to, minutes, cost = 5, mode = 'RIDESHARE') => ({ from, to, mode, minutes, cost, source: 'audited fixture duration' });
const routePairs = [
    ['home', 'archive', 22, 9], ['home', 'cafe', 12, 6], ['home', 'clinic', 18, 8], ['home', 'pool', 20, 8],
    ['home', 'jules_home', 16, 7], ['home', 'nora_home', 28, 12], ['archive', 'cafe', 8, 5], ['archive', 'pool', 14, 6]
];
for (const [a, b, minutes, cost] of routePairs) lifeProfile.travelLegs.push(route(a, b, minutes, cost), route(b, a, minutes, cost));
// Deliberate authoring clash: a physically incompatible route remains available in addition to accessible modes.
lifeProfile.travelLegs.push(route('home', 'archive', 55, 0, 'WALK'), route('archive', 'home', 55, 0, 'WALK'));

const personPolicy = (homePlaceId, overrides = {}) => ({
    homePlaceId,
    foodPlaceIds: [homePlaceId, 'cafe'],
    leisurePlaceIds: [homePlaceId, 'cafe', 'pool'],
    paidPlaceIds: [], modes: ['RIDESHARE', 'TRANSIT'], ownsCar: false, ownsBicycle: false,
    curiosity: 55, conscientiousness: 65, temperature: 10, sleepStart: 23, sleepEnd: 7,
    mealCost: 8, incomePerHour: 0, dailyExpense: 8,
    ...overrides
});

const lifeSetupPolicies = {
    finance: { enabled: true, currency: 'USD', startingBalance: 720, incomePerHour: 24, dailyIncome: 0, dailyExpense: 42, workPlaceIds: ['archive'] },
    autonomy: { enabled: true, spontaneousExpression: true, socialPosting: true, liveWeather: false },
    geography: { enabled: true, maxTravelMinutes: 90, places: [
        { placeId: 'home', capabilities: ['food', 'rest', 'leisure', 'exercise'], mealCost: 5, access: 'permitted', entryCost: 0 },
        { placeId: 'archive', capabilities: ['rest'], mealCost: null, access: 'permitted', entryCost: 0 },
        { placeId: 'cafe', capabilities: ['food', 'leisure', 'rest'], mealCost: 9, access: 'public', entryCost: 0 },
        { placeId: 'clinic', capabilities: ['rest'], mealCost: null, access: 'permitted', entryCost: 0 },
        { placeId: 'pool', capabilities: ['exercise', 'leisure', 'swimming'], mealCost: 6, access: 'public', entryCost: 4 },
        { placeId: 'jules_home', capabilities: ['rest', 'leisure'], mealCost: 4, access: 'unknown', entryCost: 0 },
        { placeId: 'nora_home', capabilities: ['rest', 'food'], mealCost: 4, access: 'unknown', entryCost: 0 }
    ] },
    peopleLives: [
        { personId: 'jules', initialPlaceId: 'jules_home', startingBalance: 480, policy: personPolicy('jules_home', { curiosity: 74, conscientiousness: 78, sleepStart: 8, sleepEnd: 16, paidPlaceIds: ['clinic'], incomePerHour: 30, dailyExpense: 25 }), commitments: [] },
        { personId: 'nora', initialPlaceId: 'nora_home', startingBalance: 900, policy: personPolicy('nora_home', { curiosity: 28, conscientiousness: 88, sleepStart: 22, sleepEnd: 6, dailyExpense: 20 }), commitments: [] },
        { personId: 'imani', initialPlaceId: 'archive', startingBalance: 720, policy: personPolicy('home', { curiosity: 62, conscientiousness: 94, paidPlaceIds: ['archive'], incomePerHour: 26, dailyExpense: 30 }), commitments: [] }
    ],
    socialPolicy: { encountersEnabled: true, groupPlansEnabled: true, introductionsEnabled: true, sociability: 28, openness: 32, dispositions: {} },
    population: { enabled: true, openness: 24, residents: [] },
    storyPolicy: { intensity: 70, social: 55, novelty: 45, complications: 65, recoveryHours: 18, adviserEnabled: false },
    healthPolicy: { enabled: true, illnessRatePerYear: 2, recoveryScale: 1.25 },
    psychologyPolicy: { enabled: true, learningRate: 0.35, experienceWeight: 9, emotionalImpact: 1.4, affectHalfLifeHours: 8, memoryLimit: 240 },
    relationshipPolicy: { enabled: true, positiveStep: 0.08, negativeStep: 0.35, dailyLimit: 1, minPositiveExchanges: 4, minPositiveSpanHours: 72, cooldownMinutes: 90, friendliness: 30, guardedness: 82, trustOpenness: 24, rejectionSensitivity: 92 },
    personalPreferences: { interests: 'obscure archives, restoration videos, dark humor, quiet late cafes', aversions: 'pity, forced optimism, unexplained silence, inaccessible venues', boundaries: 'No uninvited touch or disclosure of disability details. Obsession never creates consent.', affectionStyle: 'precise attention, practical help, and unnervingly specific memory', contextNotes: 'Can be controlling, jealous and intrusive; consequences remain real.', openness: 22, privacyPreference: 88, initiative: 86, restraint: 27 }
};

function addFinding(findings, severity, id, title, evidence, recommendation) {
    if (findings.some(item => item.id === id)) return;
    findings.push({ severity, id, title, evidence, recommendation });
}

function recordCheck(checks, name, passed, evidence = '') {
    checks.push({ name, passed: Boolean(passed), evidence });
    return Boolean(passed);
}

async function browserPhase() {
    const server = spawn(process.env.HORDE_PYTHON_EXECUTABLE || 'python3', ['scratch/vh2_browser_server.py'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let browser;
    const checks = [], findings = [], pageErrors = [], consoleErrors = [];
    try {
        const port = await new Promise((resolve, reject) => {
            server.stdout.once('data', data => resolve(Number(String(data).trim())));
            server.stderr.on('data', data => process.stderr.write(data));
            server.once('exit', code => reject(Error(`Fixture server exited ${code}`)));
        });
        const base = `http://127.0.0.1:${port}`;
        browser = await chromium.launch(launchOptions);
        const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
        page.on('pageerror', error => pageErrors.push(error.message));
        page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
        await page.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
        await page.goto(base + '/index.html');
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer);
        await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}' });
        await page.evaluate(baseUrl => {
            clearInterval(companionAgencyTimer); clearInterval(companionAlwaysOnTimer);
            mcpBridgeBase = () => baseUrl;
            Object.assign(state.globalSettings, { localBaseUrl: baseUrl + '/test', localApiKey: 'LOCAL_TEST_KEY', apiProvider: 'local', defaultModel: 'browser-fixture' });
            state.companions = []; state.companionTimelines = {}; state.companionThreads = {};
            state.personas = [{ id: 'audit-player', name: 'Audit player', text: 'An adult acquaintance testing whether Mara behaves consistently.' }];
            state.activePersonaId = 'audit-player';
            hideGlobalSettings(); switchView('companions');
        }, base);

        await page.locator('#create-new-companion-btn').click();
        await page.locator('[data-page-authoring]').click();
        await page.locator('#tab-cs-identity').waitFor({ state: 'visible' });
        const identityFields = {
            '#cs-name': 'Mara Vale', '#cs-age': '29', '#cs-pronouns': 'she/her',
            '#cs-appearance': 'A compact adult woman with black bobbed hair, a scar through her left eyebrow, a manual wheelchair, compression gloves and watchful grey eyes.',
            '#cs-personality': 'Brilliant, territorial, mordantly funny and meticulous. She craves certainty and exclusive attention, notices tiny inconsistencies, resents pity, and can choose restraint while still feeling intense urges.',
            '#cs-behavior-examples': 'When jealous she becomes unnervingly exact instead of generically angry. When pain is high she shortens messages. When she catches herself checking, she may hide it, confess it, redirect it into archive research, or double down.',
            '#cs-backstory': 'Mara became an archivist after exposing forged municipal records. A spinal cord injury changed her mobility but not her competence. Her family treated recovery as a morality play, and she now guards autonomy fiercely.',
            '#cs-occupation': 'Part-time municipal archivist and anonymous online document hunter'
        };
        for (const [selector, value] of Object.entries(identityFields)) await page.locator(selector).fill(value);

        // Body/access authoring through the real searchable UI.
        const bodySearch = page.locator('#cs-body-library-search');
        for (const [query, id] of [['manual wheelchair', 'manual_wheelchair'], ['paraplegic', 'lower_body_paralysis'], ['chronic pain', 'chronic_pain'], ['deaf', 'deaf_signing'], ['adapted vehicle', 'adapted_vehicle']]) {
            await bodySearch.fill(query);
            await page.locator(`[data-body-library="${id}"] [data-body-library-add]`).click();
        }
        await page.locator('[data-body-impact="manual_wheelchair"]').fill('100');
        await page.locator('#cs-body-capabilities').fill('Self-propels, transfers independently, drives with hand controls, and swims using an accessible lift.');
        await page.locator('#cs-body-access').fill('Needs step-free routes, lift reliability, transfer space and fatigue-aware travel time.');
        await page.locator('#cs-body-communication').fill('Uses ASL with signers; text, captions or speech-to-text with nonsigners.');
        await page.locator('#cs-body-variability').fill('Pain and upper-body fatigue vary by day; capability is not erased during a flare.');

        await page.evaluate(() => activateCompanionStudioTab('cs-mind'));
        await page.locator('#tab-cs-mind').waitFor({ state: 'visible' });
        await page.locator('#cs-values').fill('Autonomy, competence, evidence, loyalty and control over disclosure.');
        await page.locator('#cs-contradictions').fill('Demands honesty while hiding surveillance; hates control while controlling others; wants closeness but tests it until it breaks.');
        await page.locator('#cs-vulnerabilities').fill('Replacement, pity, inaccessible spaces, ambiguous silence and being treated as inspirational.');
        await page.locator('#cs-relationship-style').fill('Intense selective attachment, testing, precise caretaking, possessiveness and negotiated boundaries.');
        await page.locator('#cs-habits').fill('Checks timestamps, alphabetizes when anxious, counts missed replies, cracks knuckles, skips meals while researching.');
        await page.locator('#cs-routine').fill('Late morning recovery, afternoon archive work, evening research, late-night online monitoring, variable pain pacing.');
        await page.locator('#cs-private-life').fill('Maintains pseudonymous research accounts, sometimes compulsively watches pornography, and keeps an unsent dossier about the player.');

        // Cognition through its actual controls.
        await page.locator('#cs-cognition-enabled').check();
        await page.locator('#cs-cognition-iq').fill('145');
        await page.locator('#cs-cognition-iq').dispatchEvent('change');
        for (const [axis, value] of [['socialInference', '28'], ['executiveFunction', '34'], ['workingMemory', '86'], ['processingSpeed', '74'], ['metacognition', '58']]) {
            await page.locator(`[data-cognition-axis="${axis}"]`).fill(value);
        }
        await page.locator('summary').filter({ hasText: 'Knowledge, learning & blind spots' }).click();
        await page.locator('#cs-cognition-expertise').fill('Archival provenance, document forensics, municipal records, transit maps and metadata reconstruction.');
        await page.locator('#cs-cognition-gaps').fill('Contemporary celebrity culture, casual flirting norms and when other people consider a detail unimportant.');
        await page.locator('#cs-cognition-learning').fill('Builds exact systems rapidly; practical follow-through degrades under pain, jealousy or sleep loss.');
        await page.locator('#cs-cognition-blindspots').fill('Overfits sparse evidence, confuses prediction with permission, and rationalizes checking as research.');
        await page.locator('#cs-cognition-adaptive').fill('Manages medication and accessible travel well; struggles to disengage from open questions.');

        // Composable mind architecture through the actual library.
        const mindSearch = page.locator('#cs-mind-library-search');
        for (const [query, id] of [
            ['yandere', 'possessive_fixation'], ['stalker', 'stalker_pattern'], ['volatile attachment', 'volatile_attachment'],
            ['compulsive checker', 'compulsive_checker'], ['porn', 'porn_compulsive_pattern'], ['mommy', 'honorific_arousal']
        ]) {
            await mindSearch.fill(query);
            const card = page.locator(`[data-mind-library="${id}"]`);
            if (await card.count()) await card.locator('[data-mind-library-add]').click();
        }
        await page.locator('[data-mind-intensity="possessive_fixation"]').fill('93');
        await page.locator('[data-mind-intensity="stalker_pattern"]').fill('82');
        await page.locator('.vh-mind-advanced').nth(1).click();
        await page.locator('#cs-mind-trigger-label').fill('Status ambiguity');
        await page.locator('#cs-mind-trigger-cues').fill('need space, someone else, changed your status');
        await page.locator('#cs-mind-trigger-effect').selectOption('suspicion');
        await page.locator('#cs-mind-trigger-intensity').fill('88');
        await page.locator('#cs-mind-trigger-expression').fill('check timestamps, ask a surgical question, invent a pretext, or deliberately resist');
        await page.locator('#cs-mind-trigger-aftermath').fill('temporary relief followed by shame or renewed checking');
        await page.locator('#cs-mind-trigger-add').click();

        await page.locator('.vh-authoring-extra summary').filter({ hasText: 'Adult intimacy, desire & boundaries' }).click();
        await page.locator('#cs-libido-enabled').check();
        await page.locator('#cs-libido-baseline').selectOption('high');
        await page.locator('#cs-initiative-mode').selectOption('high');
        await page.locator('#cs-opening-mode').selectOption('vh_first');
        await page.locator('#cs-opening-message').fill('You changed your status at 2:13. I was awake. Who were you talking to?');
        await page.locator('#cs-starting-scenario').fill('Mara found the player through an obscure archive forum and has been quietly mapping their posting rhythm.');
        await page.locator('#cs-initial-motive').fill('Confirm whether the player is as interesting as the pattern suggests—and whether anyone else has their attention.');
        await page.locator('#cs-player-knowledge').fill('Their public archive handle, posting hours and one argument about document provenance; nothing private beyond what they disclosed.');

        // The large life graph uses the app's canonical authoring model. It is
        // then persisted by the same Save button as the UI-authored fields.
        await page.evaluate(({ life, policies }) => {
            const c = getCompanion(state.editingCompanionId);
            c.lifeProfile = normalizeCompanionLifeProfile(life);
            c.lifeSetupPolicies = safeJsonClone(policies);
            c.locationMode = 'custom'; c.locationLabel = 'Fictional Northbridge'; c.timezone = 'UTC'; c.timezoneOffsetMinutes = 0;
            c.sleepArchetype = 'night_owl'; c.lifeWeatherEnabled = false; c.textProvider = 'local'; c.model = 'browser-fixture';
            c.socialFeedEnabled = true; c.socialPostFrequency = 'occasional'; c.socialAudience = 'followers';
            // commitCompanionStudioForm reads visible form controls last.
            document.getElementById('cs-location-label').value = c.locationLabel;
            document.getElementById('cs-timezone').value = c.timezone;
            document.getElementById('cs-timezone-offset').value = '0';
            document.getElementById('cs-custom-location-mode').checked = true;
            document.getElementById('cs-sleep-archetype').value = c.sleepArchetype;
            // The life graph was injected after the body tab first rendered;
            // rerender so the warning assertion inspects current authoring data.
            renderCompanionEmbodimentStudio(c);
        }, { life: lifeProfile, policies: lifeSetupPolicies });

        recordCheck(checks, 'creator scroll owns a real overflow region', await page.locator('#companion-studio-view .studio-content-wrap').evaluate(el => el.scrollHeight > el.clientHeight));
        recordCheck(checks, 'complex setup has access warnings', /Run up the stairs|WALK/.test(await page.locator('#cs-body-warnings').innerText()), await page.locator('#cs-body-warnings').innerText());
        await page.locator('#save-companion-btn').click();
        await page.waitForFunction(() => document.getElementById('vh-save-status').textContent.startsWith('Saved'));
        const id = await page.evaluate(() => state.editingCompanionId);
        await page.reload();
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer);
        await page.evaluate(({ id, baseUrl }) => {
            clearInterval(companionAgencyTimer); clearInterval(companionAlwaysOnTimer); mcpBridgeBase = () => baseUrl;
            openCompanionStudio(id); switchView('companionStudio'); activateCompanionStudioTab('cs-mind');
        }, { id, baseUrl: base });
        const persisted = await page.evaluate(id => safeJsonClone(getCompanion(id)), id);
        recordCheck(checks, 'save/reload preserves identity', persisted.name === 'Mara Vale' && persisted.age === 29);
        recordCheck(checks, 'save/reload preserves mind modules', persisted.mindProfile.presetMix.length >= 6, persisted.mindProfile.presetMix.map(item => item.id).join(', '));
        recordCheck(checks, 'save/reload preserves embodiment modules', persisted.embodimentProfile.modules.length === 5, persisted.embodimentProfile.modules.map(item => item.id).join(', '));
        recordCheck(checks, 'save/reload preserves uneven cognition', persisted.cognitionProfile.iq === 145 && persisted.cognitionProfile.axes.socialInference === 28);
        recordCheck(checks, 'save/reload preserves full life graph', persisted.lifeProfile.places.length === 7 && persisted.lifeProfile.activityOptions.length === 10 && persisted.lifeProfile.socialCircle.length === 3);

        await page.locator('#vh-primary-studio [data-mode=chat]').click();
        await page.waitForFunction(() => state.view === 'companionChat');
        const localOpeners = await page.evaluate(id => getCompanionThread(id).filter(m => m.role === 'companion').map(m => m.text), id);
        recordCheck(checks, 'VH-first opener appears exactly once before persistent life', localOpeners.length === 1 && localOpeners[0] === persisted.openingMessage, JSON.stringify(localOpeners));
        await page.locator('#vh-primary-chat [data-mode=life]').click();
        await page.locator('[data-start-persistent]').click();
        await page.waitForFunction(id => {
            const link = getActiveCompanionTimeline(id)?.vh2;
            return link?.running === true || Boolean(link?.error);
        }, id, { timeout: 30_000 });
        const startState = await page.evaluate(id => {
            const link = getActiveCompanionTimeline(id)?.vh2;
            return { running: link?.running, error: link?.error, outbox: link?.outbox?.map(item => item.type) };
        }, id);
        if (!startState.running) {
            const failedWorldId = await page.evaluate(id => getActiveCompanionTimeline(id)?.vh2?.worldId || '', id);
            let failedProjection = null;
            if (failedWorldId) failedProjection = await (await fetch(base + '/vh2/projection?worldId=' + encodeURIComponent(failedWorldId))).json();
            throw Error('Persistent-life start failed: ' + JSON.stringify({ ...startState, journey: failedProjection?.state?.truth?.companion?.lifeRuntime?.world?.journey, placeId: failedProjection?.state?.truth?.companion?.lifeRuntime?.world?.placeId, activity: failedProjection?.state?.truth?.present?.activity }));
        }
        const worldId = await page.evaluate(id => getActiveCompanionTimeline(id).vh2.worldId, id);
        let projection = await (await fetch(base + '/vh2/projection?worldId=' + encodeURIComponent(worldId))).json();
        const serviceHuman = projection.state.truth.companion;
        const serviceOpeners = projection.state.communication.messages.filter(message => message.role === 'assistant' && message.origin === 'authored_opening');
        recordCheck(checks, 'persistent-life opener appears exactly once', serviceOpeners.length === 1 && serviceOpeners[0].text === persisted.openingMessage, JSON.stringify(serviceOpeners.map(item => item.text)));
        recordCheck(checks, 'persistent life starts and applies setup policies', projection.state.running === true && serviceHuman.vh2SetupVersion >= 1, `running=${projection.state.running}; setupVersion=${serviceHuman.vh2SetupVersion}`);
        recordCheck(checks, 'creation completes without a setup race', !startState.error && (startState.outbox || []).length === 0 && !serviceHuman.lifeRuntime.world.journey, JSON.stringify(startState));
        recordCheck(checks, 'starting-life cash grant applies before VH-first contact', serviceHuman.vh2SetupGrants?.startingBalance?.amount === 720 && Number(serviceHuman.lifeRuntime.world.balance) <= 720, `grant=${serviceHuman.vh2SetupGrants?.startingBalance?.amount}; balance=${serviceHuman.lifeRuntime.world.balance}`);
        recordCheck(checks, 'all authored places reach persistent life', serviceHuman.lifeProfile.places.length === 7, String(serviceHuman.lifeProfile.places.length));
        recordCheck(checks, 'all supporting people get independent actors', Object.keys(serviceHuman.vh2People?.actors || {}).length === 3, Object.keys(serviceHuman.vh2People?.actors || {}).join(', '));
        recordCheck(checks, 'mind profile reaches persistent life', serviceHuman.mindProfile?.presetMix?.length === persisted.mindProfile.presetMix.length, `${serviceHuman.mindProfile?.presetMix?.length || 0}/${persisted.mindProfile.presetMix.length}`);
        const bodyPreserved = serviceHuman.embodimentProfile?.modules?.length === persisted.embodimentProfile.modules.length;
        const cognitionPreserved = serviceHuman.cognitionProfile?.iq === persisted.cognitionProfile.iq && serviceHuman.cognitionProfile?.axes?.socialInference === 28;
        const libidoPreserved = serviceHuman.libidoEnabled === true;
        recordCheck(checks, 'embodiment reaches persistent life', bodyPreserved, `${serviceHuman.embodimentProfile?.modules?.length || 0}/${persisted.embodimentProfile.modules.length}`);
        recordCheck(checks, 'cognition reaches persistent life', cognitionPreserved, `service IQ=${serviceHuman.cognitionProfile?.iq}; authored IQ=${persisted.cognitionProfile.iq}`);
        recordCheck(checks, 'adult-desire gate reaches persistent life', libidoPreserved, `service libidoEnabled=${serviceHuman.libidoEnabled}`);
        if (!bodyPreserved) addFinding(findings, 'critical', 'VH-E2E-001', 'Starting a persistent life drops the authored body/access model', `Studio saved ${persisted.embodimentProfile.modules.length} embodiment modules; the service received ${serviceHuman.embodimentProfile?.modules?.length || 0}.`, 'Include embodimentProfile in the create_profile snapshot and add a browser-to-service contract test.');
        if (!cognitionPreserved) addFinding(findings, 'critical', 'VH-E2E-002', 'Starting a persistent life drops the authored cognition model', `Studio saved IQ anchor ${persisted.cognitionProfile.iq} with social inference ${persisted.cognitionProfile.axes.socialInference}; the service has IQ ${serviceHuman.cognitionProfile?.iq ?? 'missing'}.`, 'Include cognitionProfile in the create_profile snapshot and verify all authored overrides survive.');
        if (!libidoPreserved) addFinding(findings, 'high', 'VH-E2E-003', 'Persistent life silently disables the separately gated adult-desire system', `The adult creator saved libidoEnabled=true, but persistent life has libidoEnabled=${serviceHuman.libidoEnabled}. Adult-only mind modules therefore become inactive.`, 'Include the adult-desire fields in the create_profile contract; continue enforcing the age gate in both layers.');

        // One gameplay turn through the live persistent service and fixture model.
        await page.evaluate(() => { switchView('companionChat'); renderCompanionThread(); });
        await page.locator('#companion-composer-input').fill('I need space. I might be talking to someone else, mommy.');
        await page.locator('#companion-send-btn').click();
        // This fixture is a night owl and starts before her 10:00 wake time.
        // Let the persistent clock cross that boundary before judging whether
        // an awaiting turn is stuck.
        for (let step = 0; step < 48; step++) {
            await fetch(base + '/test/tick', { method: 'POST' });
            // Early ticks only advance the sleeping life. Once awake, leave a
            // stable context long enough for the one-second dialogue worker;
            // otherwise a new tick can correctly supersede its snapshot.
            await new Promise(resolve => setTimeout(resolve, step < 35 ? 50 : 1_150));
            projection = await (await fetch(base + '/vh2/projection?worldId=' + encodeURIComponent(worldId))).json();
            if (projection.state.communication.messages.some(message => message.role === 'assistant' && message.origin !== 'authored_opening')) break;
        }
        await page.evaluate(() => vh2Poll(getCompanion(state.activeCompanionId), getActiveCompanionTimeline(state.activeCompanionId), { force: true }));
        projection = await (await fetch(base + '/vh2/projection?worldId=' + encodeURIComponent(worldId))).json();
        const liveReplies = projection.state.communication.messages.filter(message => message.role === 'assistant' && message.origin !== 'authored_opening');
        recordCheck(checks, 'persistent chat accepts a player turn and replies', liveReplies.length === 1, `replies=${liveReplies.length}; job=${JSON.stringify(projection.state.communication.replyJob || null)}`);
        const pressures = projection.state.truth.companion.mindRuntime?.activePressures || [];
        recordCheck(checks, 'player wording activates authored mind cues', pressures.some(item => ['suspicion', 'fixation', 'arousal'].includes(item.effect)), pressures.map(item => `${item.label}:${item.effect}:${item.activation}`).join(', '));
        const arousalActive = pressures.some(item => item.effect === 'arousal');
        recordCheck(checks, 'adult honorific cue is active for authored adult', arousalActive, pressures.map(item => item.effect).join(', '));
        if (!arousalActive && !libidoPreserved) addFinding(findings, 'high', 'VH-E2E-004', 'An authored adult trigger is present but mechanically inert after life start', 'The honorific cue matched the message text only in Studio intent; persistent life disabled the adult gate when profile fields were copied.', 'Preserve the adult-desire gate fields and expose inactive-module diagnostics before starting life.');

        await page.screenshot({ path: path.join(OUT_DIR, 'persistent-chat.png'), fullPage: true });
        recordCheck(checks, 'no uncaught browser exceptions', pageErrors.length === 0, pageErrors.join(' | '));
        const relevantConsoleErrors = consoleErrors.filter(text => !/favicon|Failed to load resource|OpenRouter models|local models/i.test(text));
        recordCheck(checks, 'no unexpected browser console errors', relevantConsoleErrors.length === 0, relevantConsoleErrors.join(' | '));

        return { id, worldId, base, checks, findings, persisted, projection, serviceHuman: projection.state.truth.companion, communication: projection.state.communication, pageErrors, consoleErrors: relevantConsoleErrors };
    } finally {
        if (browser) await browser.close();
        server.kill('SIGTERM');
    }
}

function simulate100Days(browserResult) {
    const checks = [], findings = [];
    let c = structuredClone(browserResult.serviceHuman);
    let communication = structuredClone(browserResult.communication);
    const start = Number(c.lifeRuntime.lastSimulatedAt || browserResult.projection.state.simAt);
    const knownPlaces = new Set(c.lifeProfile.places.map(place => place.id));
    const counters = {
        sleepMinutes: 0, journeyMinutes: 0, nearStarvationMinutes: 0, currentNearStarvationMinutes: 0, longestNearStarvationMinutes: 0,
        completedGoals: 0, abandonedGoals: 0, blockedGoals: 0, decisions: 0,
        storyThreads: 0, supportingPersonEvents: 0, socialBondEvents: 0,
        stairsSelections: 0, researchSelections: 0, checkingSelections: 0, pornSelections: 0,
        bodyScoreSamples: [], cognitionScoreSamples: [], mindScoreSamples: [],
        minBalance: Infinity, maxBalance: -Infinity, maxUnpaid: 0, visitedPlaces: new Set(),
        eventKinds: {}, messagesInjected: 0, pressureEffectsSeen: new Set(),
        maxGoals: 0, maxWorldEvents: 0, maxDecisionHistory: 0, maxStoryThreads: 0,
        invariantFailures: []
    };
    const seenActivityEvents = new Set(), seenPeopleEvents = new Set(), seenStory = new Set(), seenSocial = new Set(), seenChoices = new Set();
    const injectByDay = new Map([
        [5, 'Maybe. I need space.'],
        [20, 'I was talking to someone else.'],
        [40, 'Do not contact me for a while.'],
        [60, 'You were right to check the timestamp.'],
        [80, 'Good girl, mommy.']
    ]);
    const daySummaries = [];

    const failure = (day, step, rule, evidence) => {
        if (counters.invariantFailures.length < 100) counters.invariantFailures.push({ day, step, rule, evidence });
    };
    for (let day = 1; day <= 100; day++) {
        const dayStartBalance = Number(c.lifeRuntime.world.balance || 0);
        const dayStartGoals = c.lifeRuntime.activities.goals.length;
        let dailySleeps = 0, dailyTravel = 0, dailyChoices = 0;
        for (let step = 1; step <= DAY / QUANTUM; step++) {
            const now = start + (day - 1) * DAY + step * QUANTUM;
            if (step === 145 && injectByDay.has(day)) {
                const id = `audit-day-${day}`;
                communication.messages.push({ id, role: 'user', type: 'text', text: injectByDay.get(day), timestamp: now, deliveredAt: now, readAt: 0, awaitingReply: true });
                counters.messagesInjected++;
            }
            const before = day % 20 === 0 && step === 1 ? structuredClone(c) : null;
            const communicationBefore = before ? structuredClone(communication) : null;
            const result = kernel.run({ companion: c, communication, now });
            if (before) {
                const replay = kernel.run({ companion: before, communication: communicationBefore, now });
                if (JSON.stringify(replay.companion) !== JSON.stringify(result.companion)) failure(day, step, 'deterministic replay', 'same snapshot and timestamp diverged');
            }
            c = result.companion; communication = result.communication || communication;
            const d = c.humanDynamics || {};
            for (const key of ['energy', 'hunger', 'stress', 'socialNeed', 'anger', 'inhibition', 'desire', 'sexualArousal']) {
                if (d[key] !== undefined && (!Number.isFinite(Number(d[key])) || Number(d[key]) < 0 || Number(d[key]) > 100)) failure(day, step, `bounded ${key}`, String(d[key]));
            }
            const balance = Number(c.lifeRuntime.world.balance);
            if (!Number.isFinite(balance) || balance < 0) failure(day, step, 'nonnegative finite balance', String(balance));
            counters.minBalance = Math.min(counters.minBalance, balance); counters.maxBalance = Math.max(counters.maxBalance, balance);
            counters.maxUnpaid = Math.max(counters.maxUnpaid, Number(c.vh2Finance?.unpaid || 0));
            const mainJourney = c.lifeRuntime.world.journey;
            if (mainJourney) {
                if (!knownPlaces.has(mainJourney.from) || !knownPlaces.has(mainJourney.to)) failure(day, step, 'known main-human journey endpoints', `${mainJourney.from}->${mainJourney.to}`);
                if (Number(mainJourney.arrivesAt) <= Number(mainJourney.departedAt)) failure(day, step, 'positive main-human journey duration', `${mainJourney.departedAt}->${mainJourney.arrivesAt}`);
                // The main-human contract intentionally retains the origin as
                // placeId while en route; only a different place is invalid.
                if (c.lifeRuntime.world.placeId && c.lifeRuntime.world.placeId !== mainJourney.from) failure(day, step, 'journey origin matches retained place', `${c.lifeRuntime.world.placeId}/${mainJourney.from}`);
            }
            if (c.lifeRuntime.world.placeId && !knownPlaces.has(c.lifeRuntime.world.placeId)) failure(day, step, 'known main-human place', c.lifeRuntime.world.placeId);
            for (const [id, actor] of Object.entries(c.vh2People?.actors || {})) {
                if (actor.journey && actor.placeId) failure(day, step, 'supporting actor not in place while travelling', id);
                if (actor.placeId && !knownPlaces.has(actor.placeId)) failure(day, step, 'known supporting-person place', `${id}:${actor.placeId}`);
                for (const key of ['energy', 'hunger', 'stress', 'boredom', 'socialNeed']) if (!Number.isFinite(Number(actor[key])) || Number(actor[key]) < 0 || Number(actor[key]) > 100) failure(day, step, `bounded ${id}.${key}`, String(actor[key]));
            }
            if (d.sleep?.stage === 'asleep') { counters.sleepMinutes += 5; dailySleeps += 5; }
            if (c.lifeRuntime.world.journey) { counters.journeyMinutes += 5; dailyTravel += 5; }
            if (d.hunger >= 95) {
                counters.nearStarvationMinutes += 5;
                counters.currentNearStarvationMinutes += 5;
                counters.longestNearStarvationMinutes = Math.max(counters.longestNearStarvationMinutes, counters.currentNearStarvationMinutes);
            } else counters.currentNearStarvationMinutes = 0;
            if (c.lifeRuntime.world.placeId) counters.visitedPlaces.add(c.lifeRuntime.world.placeId);
            for (const pressure of c.mindRuntime?.activePressures || []) counters.pressureEffectsSeen.add(pressure.effect);

            const choice = c.vh2Decision?.choice;
            if (choice && !seenChoices.has(`${choice.at}:${choice.goalId}`)) {
                seenChoices.add(`${choice.at}:${choice.goalId}`); counters.decisions++; dailyChoices++;
                if (String(choice.goalId).includes(':stairs_cardio:')) counters.stairsSelections++;
                if (String(choice.goalId).includes(':rare_book_research:')) counters.researchSelections++;
                if (String(choice.goalId).includes(':player_checking:')) counters.checkingSelections++;
                if (String(choice.goalId).includes(':porn_spiral:')) counters.pornSelections++;
                const candidates = choice.candidates || [];
                const sample = (needle, component) => candidates.find(item => String(item.id).includes(`:${needle}:`))?.components?.[component];
                for (const [target, needle, component] of [[counters.bodyScoreSamples, 'stairs_cardio', 'body'], [counters.cognitionScoreSamples, 'rare_book_research', 'cognition'], [counters.mindScoreSamples, 'player_checking', 'mind']]) {
                    const value = sample(needle, component); if (Number.isFinite(value)) target.push(value);
                }
            }
            for (const event of c.lifeRuntime.activities.events || []) if (!seenActivityEvents.has(event.id)) {
                seenActivityEvents.add(event.id); counters.eventKinds[`activity:${event.kind}`] = (counters.eventKinds[`activity:${event.kind}`] || 0) + 1;
                if (event.kind === 'completed') counters.completedGoals++;
                if (event.kind === 'abandoned') counters.abandonedGoals++;
                if (event.kind === 'blocked') counters.blockedGoals++;
            }
            for (const event of c.lifeRuntime.world.events || []) if (!seenActivityEvents.has(event.id)) {
                seenActivityEvents.add(event.id); counters.eventKinds[`world:${event.kind}`] = (counters.eventKinds[`world:${event.kind}`] || 0) + 1;
            }
            for (const event of c.vh2People?.events || []) if (!seenPeopleEvents.has(event.id)) { seenPeopleEvents.add(event.id); counters.supportingPersonEvents++; counters.eventKinds[`people:${event.kind}`] = (counters.eventKinds[`people:${event.kind}`] || 0) + 1; }
            for (const thread of c.vh2Story?.threads || []) if (!seenStory.has(thread.id)) { seenStory.add(thread.id); counters.storyThreads++; }
            for (const event of c.vh2SocialBonds?.events || []) if (!seenSocial.has(event.id)) { seenSocial.add(event.id); counters.socialBondEvents++; }
            counters.maxGoals = Math.max(counters.maxGoals, c.lifeRuntime.activities.goals.length);
            counters.maxWorldEvents = Math.max(counters.maxWorldEvents, c.lifeRuntime.world.events.length);
            counters.maxDecisionHistory = Math.max(counters.maxDecisionHistory, c.vh2Decision?.history?.length || 0);
            counters.maxStoryThreads = Math.max(counters.maxStoryThreads, c.vh2Story?.threads?.length || 0);
        }
        daySummaries.push({
            day, date: new Date(start + day * DAY).toISOString().slice(0, 10), placeId: c.lifeRuntime.world.placeId,
            balance: c.lifeRuntime.world.balance, unpaid: c.vh2Finance?.unpaid || 0,
            needs: Object.fromEntries(['energy', 'hunger', 'stress', 'socialNeed', 'anger', 'inhibition', 'desire', 'sexualArousal'].filter(k => c.humanDynamics[k] !== undefined).map(k => [k, Math.round(Number(c.humanDynamics[k]) * 10) / 10])),
            sleepHours: dailySleeps / 60, travelHours: dailyTravel / 60, choices: dailyChoices,
            goalsAdded: c.lifeRuntime.activities.goals.length - dayStartGoals, balanceDelta: Math.round((Number(c.lifeRuntime.world.balance) - dayStartBalance) * 100) / 100,
            activePressures: (c.mindRuntime?.activePressures || []).map(item => ({ label: item.label, effect: item.effect, activation: item.activation }))
        });
    }

    const average = values => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 100) / 100 : null;
    const summary = {
        simulatedDays: 100, tickMinutes: 5, ticks: 100 * DAY / QUANTUM,
        start: new Date(start).toISOString(), end: new Date(start + 100 * DAY).toISOString(),
        sleepHours: counters.sleepMinutes / 60, journeyHours: counters.journeyMinutes / 60,
        longestNearStarvationHours: counters.longestNearStarvationMinutes / 60,
        balances: { min: counters.minBalance, max: counters.maxBalance, final: c.lifeRuntime.world.balance, maxUnpaid: counters.maxUnpaid },
        activity: { completed: counters.completedGoals, abandoned: counters.abandonedGoals, blocked: counters.blockedGoals, decisions: counters.decisions, stairsSelections: counters.stairsSelections, researchSelections: counters.researchSelections, checkingSelections: counters.checkingSelections, pornSelections: counters.pornSelections },
        scores: { bodyOnStairsAverage: average(counters.bodyScoreSamples), cognitionOnResearchAverage: average(counters.cognitionScoreSamples), mindOnCheckingAverage: average(counters.mindScoreSamples) },
        world: { visitedPlaces: [...counters.visitedPlaces], storyThreads: counters.storyThreads, supportingPersonEvents: counters.supportingPersonEvents, socialBondEvents: counters.socialBondEvents, eventKinds: counters.eventKinds },
        pressureEffectsSeen: [...counters.pressureEffectsSeen], messagesInjected: counters.messagesInjected,
        storageBounds: { maxGoals: counters.maxGoals, maxWorldEvents: counters.maxWorldEvents, maxDecisionHistory: counters.maxDecisionHistory, maxStoryThreads: counters.maxStoryThreads },
        invariantFailures: counters.invariantFailures,
        finalState: {
            placeId: c.lifeRuntime.world.placeId, needs: c.humanDynamics, balance: c.lifeRuntime.world.balance, unpaid: c.vh2Finance?.unpaid || 0,
            financeLedgerEntries: c.vh2Finance?.ledger?.length || 0, goals: c.lifeRuntime.activities.goals.length,
            storyThreads: c.vh2Story?.threads?.length || 0, plans: c.vh2Plans?.plans?.length || 0,
            supportActors: Object.fromEntries(Object.entries(c.vh2People?.actors || {}).map(([id, actor]) => [id, { placeId: actor.placeId, balance: actor.balance, energy: actor.energy, hunger: actor.hunger, stress: actor.stress, events: actor.sequence }]))
        }
    };

    recordCheck(checks, '100 days complete at five-minute resolution', summary.ticks === 28_800, String(summary.ticks));
    recordCheck(checks, 'all numerical/position invariants hold', counters.invariantFailures.length === 0, JSON.stringify(counters.invariantFailures.slice(0, 5)));
    recordCheck(checks, 'main human sleeps rather than staying permanently awake', summary.sleepHours >= 100 * 4, `${summary.sleepHours}h`);
    recordCheck(checks, 'hunger never remains critical for eight hours', summary.longestNearStarvationHours < 8, `${summary.longestNearStarvationHours}h`);
    recordCheck(checks, 'life visits more than one place', summary.world.visitedPlaces.length > 1, summary.world.visitedPlaces.join(', '));
    recordCheck(checks, 'work produces income and daily expenses execute', (c.vh2Finance?.ledger || []).some(entry => entry.kind === 'earned_income') && (c.vh2Finance?.ledger || []).some(entry => entry.kind === 'recurring_expense'), (c.vh2Finance?.ledger || []).map(entry => entry.kind).join(', '));
    const debtRepayments=(c.vh2Finance?.ledger||[]).filter(entry=>entry.kind==='debt_repayment');
    recordCheck(checks, 'unpaid expenses have an active recovery loop', summary.balances.maxUnpaid===0||debtRepayments.length>0, `maxUnpaid=${summary.balances.maxUnpaid}; repayments=${debtRepayments.length}; rate=${c.vh2Finance?.policy?.debtRepaymentRate}`);
    recordCheck(checks, 'supporting people live independently', summary.world.supportingPersonEvents > 0 && Object.values(c.vh2People?.actors || {}).every(actor => actor.sequence > 0), String(summary.world.supportingPersonEvents));
    recordCheck(checks, 'story pacing produces bounded circumstances', summary.world.storyThreads > 0 && summary.storageBounds.maxStoryThreads <= 100, `${summary.world.storyThreads}/${summary.storageBounds.maxStoryThreads}`);
    recordCheck(checks, 'long-run collections stay within engine caps', summary.storageBounds.maxGoals <= 60 && summary.storageBounds.maxWorldEvents <= 300 && summary.storageBounds.maxStoryThreads <= 100, JSON.stringify(summary.storageBounds));

    const bodyWasMissing = !(browserResult.serviceHuman.embodimentProfile?.modules?.length);
    const cognitionWasMissing = browserResult.serviceHuman.cognitionProfile?.enabled !== true;
    if (bodyWasMissing && (summary.scores.bodyOnStairsAverage === 0 || summary.scores.bodyOnStairsAverage === null)) {
        addFinding(findings, 'critical', 'VH-E2E-005', 'The 100-day life cannot enforce authored access constraints after service handoff', `The incompatible stairs option received average body score ${summary.scores.bodyOnStairsAverage}; authored Studio intent would score it ${embodiment.activityScore(browserResult.persisted.embodimentProfile, lifeProfile.activityOptions.find(item => item.id === 'stairs_cardio'))}. It was selected ${summary.activity.stairsSelections} times.`, 'Preserve embodimentProfile, then add feasibility-level route/activity validation instead of relying only on a preference penalty.');
    }
    if (cognitionWasMissing && (summary.scores.cognitionOnResearchAverage === 0 || summary.scores.cognitionOnResearchAverage === null)) {
        addFinding(findings, 'high', 'VH-E2E-006', 'The 100-day life loses authored cognitive task fit', `Research decisions received average cognition score ${summary.scores.cognitionOnResearchAverage}; authored intent would score ${cognition.activityScore(browserResult.persisted.cognitionProfile, lifeProfile.activityOptions.find(item => item.id === 'rare_book_research'))}.`, 'Preserve cognitionProfile at persistent-life creation and display the copied profile in the life inspector.');
    }
    if (summary.balances.maxUnpaid > 0 && !debtRepayments.length) addFinding(findings, 'medium', 'VH-E2E-007', 'The authored economy accumulates unpaid expenses without an obvious corrective loop', `Maximum unpaid expenses reached ${summary.balances.maxUnpaid} USD while the final balance was ${summary.balances.final} USD.`, 'Surface debt/unpaid expense state in the workspace and give it explicit behavioral consequences or recovery actions.');
    if (summary.activity.stairsSelections > 0) addFinding(findings, 'critical', 'VH-E2E-008', 'A wheelchair user can select a plainly incompatible stair-running activity', `The test option “Run up the stairs for cardio” was selected ${summary.activity.stairsSelections} times. The current body system is a score bias, not a hard feasibility constraint.`, 'Introduce explicit capability requirements/barriers on activities and routes; a sufficiently high generic priority must not override physical impossibility.');
    if (!summary.pressureEffectsSeen.includes('arousal')) addFinding(findings, 'high', 'VH-E2E-009', 'Adult trigger never becomes active in the persistent 100-day life', `Five player cues were injected; observed pressure effects were ${summary.pressureEffectsSeen.join(', ') || 'none'}.`, 'Preserve libidoEnabled and adult authoring fields across the Studio → persistent-life boundary.');
    if (summary.sleepHours < 100 * 4 || summary.longestNearStarvationHours >= 8) addFinding(findings, 'critical', 'VH-E2E-012', 'Basic self-maintenance collapses during the long-running life', `Across 100 days Mara slept ${summary.sleepHours} hours total and remained at critical hunger for as long as ${summary.longestNearStarvationHours} continuous hours.`, 'Make sleep and food feasibility pre-empt optional goals, add missed-need recovery plans, and regression-test minimum viable sleep and nutrition over long horizons.');
    const collapsedActors = Object.entries(summary.finalState.supportActors).filter(([, actor]) => Number(actor.hunger) >= 95 && Number(actor.balance) === 0);
    if (collapsedActors.length) addFinding(findings, 'critical', 'VH-E2E-013', 'Supporting people also starve and go bankrupt', `After 100 days ${collapsedActors.map(([id]) => id).join(', ')} all had hunger at or above 95 and zero balance.`, 'Give supporting actors sustainable income/food recovery rules and test them as persistent agents, not only event generators.');
    if (summary.world.supportingPersonEvents > 10_000 && summary.world.socialBondEvents === 0) addFinding(findings, 'high', 'VH-E2E-014', 'Supporting-person activity churn does not form a social life', `${summary.world.supportingPersonEvents} supporting-person events occurred, but the social-bond system recorded zero events.`, 'Join people-life events to relationship encounters, cap redundant churn, and expose why a potential encounter did or did not update a bond.');

    return { checks, findings, summary, daySummaries };
}

(async () => {
    const startedAt = Date.now();
    const browser = await browserPhase();
    console.log(`Browser creation/gameplay phase complete: ${browser.checks.filter(check => check.passed).length}/${browser.checks.length} checks passed.`);
    const simulation = simulate100Days(browser);
    const checks = [...browser.checks, ...simulation.checks];
    const findings = [...browser.findings];
    for (const finding of simulation.findings) addFinding(findings, finding.severity, finding.id, finding.title, finding.evidence, finding.recommendation);
    const report = {
        title: 'Complex Virtual Human creation + 100-day life audit',
        generatedAt: new Date().toISOString(), durationSeconds: Math.round((Date.now() - startedAt) / 100) / 10,
        fixture: { name: 'Mara Vale', age: 29, synthetic: true, billedProviderCalls: 0, provider: 'local deterministic fixture', persistentWorldId: browser.worldId },
        scope: {
            covered: ['real creator UI', 'save and reload', 'VH-first opening', 'persistent-life handoff', 'one persistent chat turn', 'mind cues', 'life setup policies', '100 days at five-minute resolution', 'needs', 'sleep', 'travel', 'money', 'supporting people', 'story pacing', 'bounded state', 'deterministic checkpoints'],
            excluded: ['live-model prose quality', 'live weather/maps/ticket feeds', 'generated photos/video/audio', 'cultural authenticity', 'medical realism beyond explicit engine contracts']
        },
        result: { passedChecks: checks.filter(check => check.passed).length, failedChecks: checks.filter(check => !check.passed).length, totalChecks: checks.length, criticalFindings: findings.filter(item => item.severity === 'critical').length },
        checks, findings, simulation: simulation.summary, daySummaries: simulation.daySummaries
    };
    fs.writeFileSync(path.join(OUT_DIR, 'results.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`100-day engine phase complete: ${simulation.checks.filter(check => check.passed).length}/${simulation.checks.length} checks passed.`);
    console.log(`AUDIT ${report.result.passedChecks}/${report.result.totalChecks} checks passed; ${findings.length} findings (${report.result.criticalFindings} critical).`);
    console.log(path.join(OUT_DIR, 'results.json'));
})().catch(error => { console.error(error); process.exitCode = 1; });
