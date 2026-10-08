/**
 * Narrated-presence audit.
 *
 * The DM writes "Emily is right there, three feet away" and never records it,
 * so the cast panel insists the room is empty. This checks the safety net that
 * reads presence out of the prose — and, just as importantly, that it refuses
 * to teleport people it has only heard mentioned.
 *
 * Run with: node scratch/narrated_presence_audit.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { app, functionSource, buildContext } = require('./app_source.js');

const context = { console: { warn() {}, log() {} } };
buildContext(vm, [
    'detectNarratedPresence', 'detectNarratedDepartures', 'applyNarratedPresence',
    'detectNarratedLocation', 'applyNarratedLocation',
    'detectNarratedOutfit', 'applyNarratedOutfit',
    'stripSpokenDialogue', 'isVisibleToSession', 'sessionNpcs', 'isNpcActive',
    'isNpcPinned', 'getExitTargetName', 'normalizeLocationSearchText',
    'findFuzzyLocation', 'resolveWorldExitTarget', 'resolveWorldContainmentParent',
    'findWorldTravelPath'
], context);

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function makeWorld() {
    return {
        id: 'w', locations: [{ id: 'hall', name: 'Upstairs Hallway' }, { id: 'kitchen', name: 'Kitchen' }],
        entities: [
            { id: 'e_emily', name: 'Emily Carter', type: 'npc' },
            { id: 'e_greg', name: 'Greg', type: 'npc' },
            { id: 'e_sarah', name: 'Sarah', type: 'npc' },
            { id: 'e_harrington', name: 'Mrs. Harrington', type: 'npc' }
        ]
    };
}
function makeSession() {
    return {
        id: 's', turnCount: 5, playerLocation: 'hall',
        entityStates: {
            e_emily: { location: 'kitchen' }, e_greg: { location: 'kitchen' },
            e_sarah: { location: 'kitchen' }, e_harrington: { location: 'kitchen' }
        }
    };
}
const detect = narrative => Array.from(
    context.detectNarratedPresence(makeWorld(), makeSession(), narrative),
    hit => hit.name
);

// The reported scene ---------------------------------------------------------

test('the reported case: Emily is pulled in, Greg (downstairs) is not', () => {
    const narration = `The upstairs hallway stretches before you in the pale morning light. The air carries the faint burnt-sugar sting of whatever Greg did to the waffle iron downstairs.

Emily is right there, three feet away, one hand already on the bathroom doorframe as she freezes mid-step.

Her lips curl into a slow, sleepy grin. "Well good morning to you too, stepbrother."`;
    const present = detect(narration);
    assert(present.includes('Emily Carter'), 'Emily was narrated present but not pulled into the scene');
    assert(!present.includes('Greg'), 'Greg was downstairs and should not have been teleported in');
});

// The rule the user identified: dialogue mentions do not count -----------------

test('a name spoken inside dialogue never places that character', () => {
    assert.deepEqual(detect('"Have you seen Sarah today?" you ask the empty hall.'), [],
        'a name inside quotes was treated as presence');
    assert.deepEqual(detect('“Emily is right there in the kitchen,” Greg calls up the stairs.'), [],
        'a name inside smart quotes was treated as presence');
});

test('dialogue is stripped without eating possessives', () => {
    const stripped = context.stripSpokenDialogue(`Emily's hand rests on the frame. "Don't," she says.`);
    assert(stripped.includes("Emily's hand"), 'an apostrophe was mistaken for dialogue');
    assert(!stripped.includes("Don't,"), 'spoken dialogue survived stripping');
});

// Presence cues that should count ---------------------------------------------

test('present-tense action verbs place a character', () => {
    ['Emily steps into the hallway.', 'Emily leans against the doorframe.',
     'Emily blocks the top of the stairs.', 'Emily watches you from the landing.',
     'Sarah sits on the top step, waiting.'].forEach(line => {
        assert(detect(line).length > 0, `no presence detected in: "${line}"`);
    });
});

test('"is" only counts when it lands on an actual presence cue', () => {
    assert(detect('Emily is right there, three feet away.').length, '"is right there" was ignored');
    assert(detect('Emily is standing in the doorway.').length, '"is standing" was ignored');
    assert.deepEqual(detect('Emily is a light sleeper, everyone knows that.'), [],
        'a bare descriptive "is" was treated as presence');
});

// Refusals — a false positive teleports someone -------------------------------

test('an elsewhere marker vetoes the match', () => {
    ['Greg is downstairs burning waffles.', 'Sarah is outside in the car.',
     'Emily is in the kitchen with the others.', 'Greg is still at work.'].forEach(line => {
        assert.deepEqual(detect(line), [], `elsewhere marker ignored in: "${line}"`);
    });
});

test('a remote room prefix does not imply arrival in the player scene', () => {
    assert.deepEqual(detect('In her office, Emily Carter freezes at the news.'), []);
    assert.deepEqual(detect('In his room, Greg’s voice falters over the phone.'), []);
    assert(detect('Emily Carter steps into the hallway.').includes('Emily Carter'));
});

test('a bare mention places nobody', () => {
    assert.deepEqual(detect('The window overlooks Harrington House across the road.'), [],
        'a place named after a character was read as that character');
    assert.deepEqual(detect('You wonder what Sarah would make of all this.'), []);
    assert.deepEqual(detect('Greg had left the iron on again.'), []);
});

test('a title is never used as the character key', () => {
    // "Mrs. Harrington" must key on Harrington; otherwise one "Mrs." would
    // match every titled character in the cast.
    const world = makeWorld();
    world.entities.push({ id: 'e_smith', name: 'Mrs. Smith', type: 'npc' });
    const sess = makeSession();
    sess.entityStates.e_smith = { location: 'kitchen' };
    const hits = context.detectNarratedPresence(world, sess, 'Mrs. Harrington steps into the hallway.')
        .map(h => h.name);
    assert(hits.includes('Mrs. Harrington'), 'a titled character was not detected by surname');
    assert(!hits.includes('Mrs. Smith'), 'a shared title matched the wrong character');
});

test('someone already in the room is not re-detected', () => {
    const world = makeWorld();
    const sess = makeSession();
    sess.entityStates.e_emily.location = 'hall';   // already present
    assert.deepEqual(Array.from(context.detectNarratedPresence(world, sess, 'Emily steps closer.')), []);
});

test('an explicit npc_moves placement is never overridden', () => {
    const world = makeWorld();
    const sess = makeSession();
    sess.entityStates.e_emily.pinnedUntilTurn = sess.turnCount + 6;   // DM placed her elsewhere
    assert.deepEqual(Array.from(context.detectNarratedPresence(world, sess, 'Emily is right there beside you.')), [],
        'inference overrode an explicit narrative placement');
});

test('the dead and departed are never pulled into a scene', () => {
    const world = makeWorld();
    const sess = makeSession();
    sess.entityStates.e_emily.status = 'dead';
    assert.deepEqual(Array.from(context.detectNarratedPresence(world, sess, 'Emily is right there.')), [],
        'a dead character was pulled into the scene');
});

test('applying presence moves them and reports what it did', () => {
    const world = makeWorld();
    const sess = makeSession();
    const applied = context.applyNarratedPresence(world, sess, 'Emily is right there, watching.');
    assert.equal(applied.length, 1);
    assert.equal(sess.entityStates.e_emily.location, 'hall', 'the character was not actually moved');
    assert(applied[0].evidence, 'no evidence recorded for an inferred move');
});

// Possession: a person's voice places them; their belongings do not ----------

const SHOWER_SCENE = `The bathroom hits you like a wall of wet heat, steam so thick it fogs the mirror. Water pounds against the fiberglass tub beneath OutKast still thumping from Emily's little pink boombox perched on the toilet tank.

Through the cheap translucent shower curtain you can make out the blurred silhouette of your stepsister. The curtain is that ugly floral pattern Sarah picked out three years ago.

Your toothbrush is jammed into the ceramic holder next to Emily's pink one and Greg's electric with the worn-out bristles.

Emily's voice cuts through the shower noise, still half-singing. "Told you it wasn't weird."`;

test('the reported shower scene: Emily is placed by her voice, nobody else is', () => {
    const present = detect(SHOWER_SCENE);
    assert(present.includes('Emily Carter'),
        'Emily spoke from six inches away and was still not in the room');
    assert(!present.includes('Greg'), 'Greg was placed by his toothbrush');
    assert(!present.includes('Sarah'), 'Sarah was placed by a curtain she once bought');
});

test('a person attribute places them; a possession does not', () => {
    ['Emily\'s voice cuts through the noise.', 'Emily\'s hand closes on the doorframe.',
     'Emily\'s breath fogs the glass.', 'Emily\'s laugh echoes off the tile.'].forEach(line => {
        assert(detect(line).length, `an attribute failed to place her: "${line}"`);
    });
    ['Emily\'s boombox sits on the tank.', 'Emily\'s pink toothbrush is in the holder.',
     'Emily\'s bedroom door is shut.', 'Greg\'s armchair dominates the room.'].forEach(line => {
        assert.deepEqual(detect(line), [], `a possession wrongly placed someone: "${line}"`);
    });
});

test('an attribute is still vetoed by an elsewhere marker', () => {
    assert.deepEqual(detect("Emily's voice carries from downstairs."), [],
        'a voice from elsewhere was treated as presence');
});

test('recorded voices and images do not place a person in the room', () => {
    assert.deepEqual(detect("Emily's voice plays on the answering machine."), []);
    assert.deepEqual(detect('Emily appears in the photograph on the desk.'), []);
    assert.deepEqual(detect('Emily looks tired on the video screen.'), []);
});

test('a later definite arrival outranks an earlier elsewhere mention', () => {
    assert.deepEqual(detect('Emily is downstairs. A minute later, Emily steps into the hallway.'), ['Emily Carter']);
});

test('shared first names never pull multiple people into a scene', () => {
    const world = makeWorld();
    world.entities.push({ id: 'e_emily_2', name: 'Emily Stone', type: 'npc' });
    const sess = makeSession();
    sess.entityStates.e_emily_2 = { location: 'kitchen' };
    assert.deepEqual(Array.from(context.detectNarratedPresence(world, sess, 'Emily steps into the hallway.')), [],
        'an ambiguous first name teleported multiple people');
    assert.deepEqual(Array.from(context.detectNarratedPresence(world, sess, 'Emily Carter steps into the hallway.'), hit => hit.id), ['e_emily']);
});

test('explicit departures are detected without treating possessions as movement', () => {
    const world = makeWorld();
    world.locations[0].exits = ['to Kitchen'];
    world.locations[1].exits = ['to Upstairs Hallway'];
    const sess = makeSession();
    sess.entityStates.e_emily.location = 'hall';
    assert.deepEqual(Array.from(context.detectNarratedDepartures(world, sess, 'Emily Carter walks out.'), hit => hit.id), ['e_emily']);
    assert.deepEqual(Array.from(context.detectNarratedDepartures(world, sess, 'Emily leaves her bag beside you.')), []);
});

test('turn commits preserve position when a departure is missing its canonical event', () => {
    const source = functionSource('commitWorldTurnReceipt');
    assert(source.includes("detectNarratedPresence(world, sess, context.narrativeText, { includePinned: true })"));
    assert(!source.includes('detectNarratedDepartures(world, sess, context.narrativeText)'));
    assert(source.includes('validation.recoveredDepartures = []'));
    assert(!source.includes('entState.location = hit.destinationId || null'));
});

// Following the prose to a location that exists -------------------------------

function locWorld() {
    return { id: 'w',
        locations: [
            { id: 'hall', name: 'Upstairs Hallway', exits: ['to Bathroom'] },
            { id: 'bath', name: 'Bathroom', exits: ['to Upstairs Hallway'] },
            { id: 'attic', name: 'Attic', exits: [] }
        ],
        entities: [] };
}

test('the scene opening in a known room moves the player there', () => {
    const world = locWorld();
    const sess = { id: 's', turnCount: 3, playerLocation: 'hall', entityStates: {} };
    const moved = context.applyNarratedLocation(world, sess,
        'The Bathroom hits you like a wall of wet heat, steam thick on the mirror.');
    assert(moved, 'the prose plainly moved the scene and the map did not follow');
    assert.equal(sess.playerLocation, 'bath');
    assert.equal(moved.from, 'hall');
});

test('"you step into the X" also counts', () => {
    const world = locWorld();
    const sess = { id: 's', turnCount: 3, playerLocation: 'hall', entityStates: {} };
    context.applyNarratedLocation(world, sess, 'You step through into the Bathroom, steam rolling out.');
    assert.equal(sess.playerLocation, 'bath');
});

test('a place merely mentioned does not relocate the player', () => {
    const world = locWorld();
    const sess = { id: 's', turnCount: 3, playerLocation: 'hall', entityStates: {} };
    context.applyNarratedLocation(world, sess,
        'You linger in the hallway. From here you can hear water running in the Bathroom.');
    assert.equal(sess.playerLocation, 'hall', 'a mention teleported the player');
});

test('an unreachable room is never followed', () => {
    const world = locWorld();
    const sess = { id: 's', turnCount: 3, playerLocation: 'hall', entityStates: {} };
    context.applyNarratedLocation(world, sess, 'The Attic swallows you in dust and dark.');
    assert.equal(sess.playerLocation, 'hall', 'the player was moved somewhere with no route');
});

test('a name inside dialogue cannot relocate the player', () => {
    const world = locWorld();
    const sess = { id: 's', turnCount: 3, playerLocation: 'hall', entityStates: {} };
    context.applyNarratedLocation(world, sess, '"The Bathroom is free now," she calls.');
    assert.equal(sess.playerLocation, 'hall', 'spoken dialogue moved the player');
});

// Preset hygiene --------------------------------------------------------------

test('preset prompts that emit raw markup are disabled by default', () => {
    const presets = fs.readFileSync(path.join(__dirname, '..', 'presets.js'), 'utf8');
    [['🌈 Colored Dialogue VN', 'font color tags fight the app\'s own dialogue colouring'],
     ['🎭Immersive Graphics', 'RAW_INLINE_HTML dumps div/style code into the chat'],
     ['📲Twitter X Feed', 'emits styled HTML feeds']].forEach(([name, why]) => {
        const at = presets.indexOf(name);
        assert(at >= 0, `preset prompt "${name}" not found`);
        const flag = presets.slice(presets.indexOf('"enabled":', at), presets.indexOf('"enabled":', at) + 16);
        assert(flag.includes('false'), `"${name}" is enabled but ${why}`);
    });
});

test('the preset keeps the prompts that make it good', () => {
    const presets = fs.readFileSync(path.join(__dirname, '..', 'presets.js'), 'utf8');
    ['🎭 VAD Emotional System', '🧠 Realism Mode Chain of Thought', '🎭Absolute Character Adherence'].forEach(name => {
        const at = presets.indexOf(name);
        assert(at >= 0, `preset prompt "${name}" not found`);
        const flag = presets.slice(presets.indexOf('"enabled":', at), presets.indexOf('"enabled":', at) + 16);
        assert(flag.includes('true'), `"${name}" was disabled — that is quality, not styling`);
    });
});

// --- narrated outfit ---------------------------------------------------------
// The outfit field only changed on an explicit tool call, and nothing in the
// prompt ever told the DM to make one — so the ordinary case, prose describing
// the player getting changed, left the HUD showing yesterday's clothes.

test('the ordinary ways prose describes getting dressed are all read', () => {
    [
        ['You change into the deep green riding dress.', 'deep green riding dress'],
        ['You slip into your travelling leathers and belt on the sword.', 'travelling leathers'],
        ['You pull on a heavy wool cloak against the rain.', 'heavy wool cloak'],
        ['You put on the borrowed servant\'s livery.', 'borrowed servant\'s livery'],
        ['You don the iron half-mask.', 'iron half-mask'],
        ['You are now wearing the midnight-blue gown.', 'midnight-blue gown'],
        ["You're dressed in a plain brown habit.", 'plain brown habit'],
        ['You shrug into a borrowed coat.', 'borrowed coat']
    ].forEach(([prose, expected]) => {
        assert.equal(context.detectNarratedOutfit(prose), expected,
            `"${prose}" was not read as a change of clothes`);
    });
});

test('losing the clothes is a change too', () => {
    ['You strip out of the soaked gown and stand bare before the fire.',
     'You undress, peeling off the mud-caked leathers.'].forEach(prose => {
        assert(context.detectNarratedOutfit(prose), `"${prose}" was not read as a change at all`);
    });
});

test('somebody talking about clothes does not redress the player', () => {
    // Dialogue is the single most common false positive: an NPC saying it is
    // not the player doing it.
    [
        '"You should change into something warmer," she says, not looking up.',
        '"You are wearing my coat," Bree said flatly.',
        '"Put on the mask," the smuggler hissed.'
    ].forEach(prose => {
        assert.equal(context.detectNarratedOutfit(prose), null,
            `dialogue redressed the player: ${prose}`);
    });
});

test('somebody else getting dressed does not redress the player', () => {
    ['Emily changes into a riding dress and leaves.',
     'She puts on her cloak by the door.',
     'The guard dons his helm.'].forEach(prose => {
        assert.equal(context.detectNarratedOutfit(prose), null,
            `another character's clothes were put on the player: ${prose}`);
    });
});

test('prose that merely mentions clothing changes nothing', () => {
    ['Your cloak is soaked through.',
     'The dress hangs on the back of the door.',
     'You look at the armour for a long moment.',
     'You think about changing.',
     'You reach for it.'].forEach(prose => {
        assert.equal(context.detectNarratedOutfit(prose), null,
            `a passing mention rewrote the outfit: ${prose}`);
    });
});

test('a trailing clause is not treated as part of the garment', () => {
    const outfit = context.detectNarratedOutfit(
        'You change into the grey wool dress, which Maera had left out for you.');
    assert.equal(outfit, 'grey wool dress', `captured too much: "${outfit}"`);
});

test('a pronoun is never accepted as a garment', () => {
    ['You put on it.', 'You change into something.', 'You are wearing that.'].forEach(prose => {
        assert.equal(context.detectNarratedOutfit(prose), null,
            `a pronoun became an outfit: ${prose}`);
    });
});

test('real narration, not just tidy one-liners', () => {
    // The one-sentence cases all passed while multi-clause prose — which is
    // what a DM actually writes — captured half the next sentence. These are
    // the exact passages that were wrong.
    [
        [`You change into the grey wool servant's dress, folding your own travel-stained clothes into the sack. "Better," she says.`,
         "grey wool servant's dress"],
        [`Rain hammers the shutters. You pull on a heavy oiled cloak against the weather and step out into the yard.`,
         'heavy oiled cloak'],
        [`You are dressed in the deep blue court gown, and the Duchess-Regent's eyes move over you once, appraising.`,
         'deep blue court gown'],
        [`The cellar is cold.\n\nYou change into the plain brown habit and pull the hood up. Outside, the bell begins to ring.`,
         'plain brown habit'],
        [`You slip into your travelling leathers and belt on the sword.`, 'travelling leathers'],
        [`You don the blackened mail hauberk and take up the shield.`, 'blackened mail hauberk'],
        [`Emily pulls on her cloak. You change into the borrowed livery and follow her out.`, 'borrowed livery']
    ].forEach(([prose, expected]) => {
        assert.equal(context.detectNarratedOutfit(prose), expected,
            `real prose was read wrongly: ${JSON.stringify(prose.slice(0, 60))}`);
    });
});

test('a participle is a garment, not a clause', () => {
    // "riding breeches", "evening gown", "travelling leathers" — treating every
    // -ing word as a verb threw all of these away.
    [['You change into your evening gown.', 'evening gown'],
     ['You slip into travelling leathers.', 'travelling leathers'],
     ['You pull on riding boots.', 'riding boots']].forEach(([prose, expected]) => {
        assert.equal(context.detectNarratedOutfit(prose), expected,
            `a participle adjective was mistaken for a verb: ${prose}`);
    });
});

test('a genuine list of garments is kept whole', () => {
    assert.equal(
        context.detectNarratedOutfit('You change into a white linen shirt, black riding breeches and tall boots.'),
        'white linen shirt, black riding breeches and tall boots',
        'a listed outfit was truncated to its first item');
});

test('the capture never runs past the garment', () => {
    // The failure mode that matters: a long wrong string goes into the HUD and
    // into every later prompt, so over-capturing is worse than capturing less.
    const scenes = [
        `You change into the grey dress, folding your clothes into the sack.`,
        `You put on the cloak, and she watches you from the doorway.`,
        `You don the mask and step through the archway into the dark.`
    ];
    scenes.forEach(prose => {
        const outfit = context.detectNarratedOutfit(prose);
        assert(outfit, `nothing was read from: ${prose}`);
        assert(outfit.split(/\s+/).length <= 6,
            `captured a whole clause instead of a garment: "${outfit}"`);
        assert(!/\b(?:she|he|they|folding|watches|step)\b/i.test(outfit),
            `the next clause leaked into the outfit: "${outfit}"`);
    });
});

test('applying sets the outfit and reports what changed', () => {
    const sess = { outfit: 'Travel-stained roads clothes.' };
    const change = context.applyNarratedOutfit(sess, 'You change into the deep green riding dress.');
    assert(change, 'nothing was applied');
    assert.equal(sess.outfit, 'deep green riding dress');
    assert.equal(change.from, 'Travel-stained roads clothes.');
});

test('prose restating what they already wear does not churn the field', () => {
    const sess = { outfit: 'grey wool dress' };
    assert.equal(context.applyNarratedOutfit(sess, 'You are wearing the grey wool dress.'), null,
        'the same outfit was written again, and would be reported as a change');
});

test('an explicit tool call always outranks the prose', () => {
    // The rescue must not second-guess an outfit_update that already ran.
    const source = app.slice(app.indexOf('const narratedOutfit'), app.indexOf('const narratedOutfit') + 260);
    assert(/!outfitChangedThisTurn/.test(source),
        'the prose could overwrite an outfit the DM had already recorded properly');
    assert(/turnSnapshot\?\.session\?\.outfit/.test(app),
        'there is no way to tell whether the tool call already changed it this turn');
});

test('the DM is actually told to record an outfit change', () => {
    // This was the whole reason it never fired: the field existed, the handler
    // worked, and nothing in the prompt ever asked for it.
    assert(/Appearance Is State/.test(app),
        'the mandate never mentions outfit, so the model has no reason to send one');
    assert(/outfit events for the correct actor/i.test(app),
        'the mandate does not say when to record it');
});

test('the rescue is visible, not silent', () => {
    assert(/outfit read from the prose/.test(app),
        'the player is never told the outfit was inferred rather than recorded');
});

let failures = 0;
for (const { name, fn } of tests) {
    try { fn(); console.log(`✓ ${name}`); }
    catch (error) { failures++; console.error(`✗ ${name}\n  ${error.message}`); }
}
if (failures) {
    console.error(`\n${failures} narrated-presence check(s) failed.`);
    process.exit(1);
}
console.log(`\n${tests.length} narrated presence checks passed.`);
