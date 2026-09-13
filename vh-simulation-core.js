/* Shared VH simulation core. Browser and local host execute these same functions.
 * No DOM, provider calls, storage access or global application state.
 * Extracted from app.js; keep new simulation rules in this module. */
var VHWorldEngine = typeof module === 'object' && module.exports ? require('./vh-world-engine') : globalThis.VHWorldEngine;

function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    // Object literals can cross a browser iframe, worker, or test VM boundary,
    // where their realm's Object.prototype is not reference-equal to ours.
    return proto === null || Object.prototype.toString.call(value) === '[object Object]';
}

function livingClamp(value, min, max) {
    const n = Number(value);
    const fallback = min <= 0 && max >= 0 ? 0 : min;
    return Math.max(min, Math.min(max, Number.isFinite(n) ? n : fallback));
}

function livingId(prefix, value) {
    const clean = String(value || '').trim().toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 48);
    return `${prefix}_${clean || Math.random().toString(36).slice(2, 10)}`;
}

const COMPANION_MOOD_LABELS = Object.freeze([
    'content', 'happy', 'excited', 'affectionate', 'flirty', 'playful',
    'bored', 'tired', 'anxious', 'sad', 'hurt', 'angry', 'jealous',
    'lonely', 'overwhelmed', 'numb'
]);

const COMPANION_INTIMACY_AFTEREFFECTS = Object.freeze([
    'none', 'satisfied', 'awkward', 'conflicted', 'regretful', 'rejected', 'frustrated'
]);

const COMPANION_EMOTIONS = Object.freeze([
    'joy', 'trust', 'fear', 'surprise', 'sadness', 'disgust', 'anger', 'anticipation'
]);

const COMPANION_SLEEP_HOURS = Object.freeze({
    early_riser: [22, 5],
    normal: [0, 7],
    night_owl: [3, 10]
});

const COMPANION_ACTIVITIES = Object.freeze([
    { id: 'home', label: 'at home', busy: false },
    { id: 'work', label: 'at work', busy: true },
    { id: 'commuting', label: 'commuting', busy: true },
    { id: 'gym', label: 'at the gym', busy: true },
    { id: 'out_friends', label: 'out with friends', busy: true },
    { id: 'errands', label: 'running errands', busy: true },
    { id: 'studying', label: 'studying', busy: true },
    { id: 'relaxing', label: 'relaxing at home', busy: false }
]);

function normalizeCompanionTrauma(raw) {
    return {
        id: String(raw?.id || livingId('trauma', raw?.label)).slice(0, 80),
        label: String(raw?.label || '').trim().slice(0, 200),
        severity: livingClamp(raw?.severity == null ? 50 : raw.severity, 0, 100),
        addedAt: Number.isFinite(raw?.addedAt) ? raw.addedAt : Date.now()
    };
}

function normalizeCompanionLifeEvent(raw) {
    return {
        id: String(raw?.id || livingId('vh_life', raw?.text || Date.now())).slice(0, 100),
        text: String(raw?.text || '').trim().slice(0, 500),
        createdAt: Number.isFinite(raw?.createdAt) ? raw.createdAt : Date.now(),
        source: ['turn', 'autonomy', 'call', 'manual', 'relationship'].includes(raw?.source) ? raw.source : 'turn'
    };
}

const COMPANION_WEEKDAYS = Object.freeze(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);

const COMPANION_LIFE_AVAILABILITY = Object.freeze(['available', 'busy', 'private', 'asleep']);

const COMPANION_PLACE_KINDS = Object.freeze(['home', 'work', 'study', 'social', 'errand', 'outdoor', 'transit', 'other']);

function normalizeCompanionLifePlace(raw, index = 0) {
    const place = isPlainObject(raw) ? raw : {};
    const label = String(place.label || place.name || '').trim().slice(0, 160);
    return {
        id: String(place.id || livingId('vh_place', label || index)).slice(0, 80),
        label,
        photo: typeof place.photo === 'string' ? place.photo : '',
        referenceDisabled: place.referenceDisabled===true,
        encounterScope: ['nearby','area'].includes(place.encounterScope)?place.encounterScope:(place.kind==='home'?'nearby':'area'),
        noticeMinutes: livingClamp(Number.isFinite(Number(place.noticeMinutes))?Number(place.noticeMinutes):2,0,120),
        parentPlaceId: String(place.parentPlaceId||'').slice(0,80),
        referenceRole: ['bedroom','bathroom','kitchen','living room','home exterior','gym','work','campus'].includes(place.referenceRole)?place.referenceRole:'',
        referenceAliases: String(place.referenceAliases||'').slice(0,500),
        referenceDescription: String(place.referenceDescription || '').slice(0,1500),
        mapCoordinates: Array.isArray(place.mapCoordinates) && place.mapCoordinates.length===2 && place.mapCoordinates.every(Number.isFinite) && Math.abs(place.mapCoordinates[0])<=180 && Math.abs(place.mapCoordinates[1])<=90 ? [...place.mapCoordinates] : null,
        googlePlaceId: /^[A-Za-z0-9_-]{1,300}$/.test(String(place.googlePlaceId || "")) ? String(place.googlePlaceId) : "",
        kind: COMPANION_PLACE_KINDS.includes(place.kind) ? place.kind : 'other',
        detail: String(place.detail || '').trim().slice(0, 500),
        travelMode: ['WALK','DRIVE','BICYCLE','TRANSIT','RIDESHARE'].includes(place.travelMode)?place.travelMode:'WALK',
        travelOverride: place.travelOverride===true,
        travelMinutesFromHome: livingClamp(Math.round(Number(place.travelMinutesFromHome) || 0), 0, 360)
    };
}

function normalizeCompanionSocialPerson(raw, index = 0) {
    const person = isPlainObject(raw) ? raw : {};
    const name = String(person.name || '').trim().slice(0, 100);
    return {
        id: String(person.id || livingId('vh_person', name || index)).slice(0, 80),
        name,
        relationship: String(person.relationship || '').trim().slice(0, 120),
        role: ['friend', 'family', 'coworker', 'classmate', 'partner', 'ex', 'neighbor', 'acquaintance', 'other']
            .includes(person.role) ? person.role : 'other',
        closeness: livingClamp(Math.round(Number(person.closeness) || 0), -100, 100),
        trust: livingClamp(Math.round(Number.isFinite(Number(person.trust)) ? Number(person.trust) : Math.max(0, Number(person.closeness) || 0)), -100, 100),
        tension: livingClamp(Math.round(Number(person.tension) || 0), 0, 100),
        influence: livingClamp(Math.round(Number.isFinite(Number(person.influence)) ? Number(person.influence) : 35), 0, 100),
        contactFrequency: ['daily', 'few_week', 'weekly', 'monthly', 'rare'].includes(person.contactFrequency)
            ? person.contactFrequency : 'weekly',
        contactWindows: (Array.isArray(person.contactWindows) ? person.contactWindows : []).slice(0, 14).map(window => ({
            days: (Array.isArray(window?.days) ? window.days : []).filter(day => Number.isInteger(day) && day >= 0 && day <= 6),
            startMinute: livingClamp(Number(window?.startMinute) || 0, 0, 1439),
            endMinute: livingClamp(Number(window?.endMinute) || 0, 0, 1440)
        })).filter(window => window.days.length && window.endMinute > window.startMinute),
        description: String(person.description || '').trim().slice(0, 500),
        appearance: String(person.appearance || person.visualDescription || '').trim().slice(0, 2000),
        age: person.age !== '' && person.age != null && Number.isFinite(Number(person.age)) && Number(person.age) >= 0 && Number(person.age) <= 120 ? Number(person.age) : null,
        currentTension: String(person.currentTension || '').trim().slice(0, 400),
        knowsPlayer: person.knowsPlayer === true,
        playerContext: String(person.playerContext || '').trim().slice(0, 400)
    };
}

function normalizeCompanionSocialRelationshipRuntime(raw, person, index = 0) {
    const value = isPlainObject(raw) ? raw : {};
    return {
        personId: String(value.personId || person?.id || `person_${index}`).slice(0, 80),
        closeness: livingClamp(Math.round(Number.isFinite(Number(value.closeness)) ? Number(value.closeness) : Number(person?.closeness) || 0), -100, 100),
        trust: livingClamp(Math.round(Number.isFinite(Number(value.trust)) ? Number(value.trust) : Number(person?.trust) || 0), -100, 100),
        tension: livingClamp(Math.round(Number.isFinite(Number(value.tension)) ? Number(value.tension) : Number(person?.tension) || 0), 0, 100),
        currentSituation: String(value.currentSituation || '').trim().slice(0, 300),
        lastInteractionAt: Number.isFinite(value.lastInteractionAt) ? value.lastInteractionAt : 0,
        nextInteractionAt: Number.isFinite(value.nextInteractionAt) ? value.nextInteractionAt : 0,
        relationshipEvents: (Array.isArray(value.relationshipEvents) ? value.relationshipEvents : []).map(event => ({
            id: String(event?.id || livingId('vh_social_event', `${value.personId || person?.id}|${event?.createdAt || index}`)).slice(0, 100),
            summary: String(event?.summary || '').trim().slice(0, 400),
            closenessDelta: livingClamp(Math.round(Number(event?.closenessDelta) || 0), -5, 5),
            tensionDelta: livingClamp(Math.round(Number(event?.tensionDelta) || 0), -5, 5),
            createdAt: Number.isFinite(event?.createdAt) ? event.createdAt : Date.now()
        })).filter(event => event.summary).slice(-30)
    };
}

function normalizeCompanionSocialWorldRuntime(raw, socialCircle = []) {
    const value = isPlainObject(raw) ? raw : {};
    const byId = new Map((Array.isArray(value.people) ? value.people : []).map(person => [String(person?.personId || ''), person]));
    return {
        lastAdvancedAt: Number.isFinite(value.lastAdvancedAt) ? value.lastAdvancedAt : 0,
        people: socialCircle.map((person, index) => normalizeCompanionSocialRelationshipRuntime(byId.get(person.id), person, index)),
        interactions: (Array.isArray(value.interactions) ? value.interactions : []).map(item => ({
            id: String(item?.id || livingId('vh_social_interaction', `${item?.personId}|${item?.createdAt}`)).slice(0, 100),
            personId: String(item?.personId || '').slice(0, 80),
            summary: String(item?.summary || '').trim().slice(0, 500),
            createdAt: Number.isFinite(item?.createdAt) ? item.createdAt : Date.now()
        })).filter(item => item.personId && item.summary).slice(-120),
        gossip: (Array.isArray(value.gossip) ? value.gossip : []).map(item => ({
            id: String(item?.id || livingId('vh_gossip', `${item?.sourcePersonId}|${item?.createdAt}`)).slice(0, 100),
            sourcePersonId: String(item?.sourcePersonId || '').slice(0, 80),
            subjectPersonId: String(item?.subjectPersonId || '').slice(0, 80),
            summary: String(item?.summary || '').trim().slice(0, 400),
            createdAt: Number.isFinite(item?.createdAt) ? item.createdAt : Date.now(),
            expiresAt: Number.isFinite(item?.expiresAt) ? item.expiresAt : 0
        })).filter(item => item.sourcePersonId && item.summary).slice(-40)
    };
}

function normalizeCompanionWardrobeLook(raw, index = 0) {
    const look = isPlainObject(raw) ? raw : {};
    const label = String(look.label || '').trim().slice(0, 100);
    return {
        id: String(look.id || livingId('vh_look', label || index)).slice(0, 80),
        label,
        context: ['sleep', 'home', 'work', 'social', 'active', 'formal', 'weather'].includes(look.context)
            ? look.context : 'home',
        items: String(look.items || look.description || '').trim().slice(0, 500),
        notes: String(look.notes || '').trim().slice(0, 300)
    };
}

function normalizeCompanionScheduleBlock(raw, index = 0) {
    const block = isPlainObject(raw) ? raw : {};
    let days = (Array.isArray(block.days) ? block.days : [block.day])
        .map(value => Number(value)).filter(value => Number.isInteger(value) && value >= 0 && value <= 6);
    days = [...new Set(days)];
    const startMinute = livingClamp(Math.round(Number(block.startMinute) || 0), 0, 1439);
    let endMinute = livingClamp(Math.round(Number(block.endMinute) || 0), 0, 1440);
    if (endMinute === startMinute) endMinute = Math.min(1440, startMinute + 60);
    const activity = String(block.activity || '').trim().slice(0, 240);
    return {
        ...VHWorldEngine.calendarFields(block),
        id: String(block.id || livingId('vh_schedule', `${activity}|${days.join(',')}|${startMinute}|${index}`)).slice(0, 100),
        days,
        startMinute,
        endMinute,
        activity,
        breakAllowed:block.breakAllowed!==false,
        departureCosts:VHActivityEngine.resources(block.departureCosts),
        effects: VHActivityEngine.effects(block.effects, block.availability, block.withIds?.length > 0),
        placeId: String(block.placeId || '').trim().slice(0, 80),
        placeLabel: String(block.placeLabel || '').trim().slice(0, 160),
        withIds: (Array.isArray(block.withIds) ? block.withIds : [])
            .map(value => String(value).slice(0, 80)).filter(Boolean).slice(0, 8),
        availability: COMPANION_LIFE_AVAILABILITY.includes(block.availability) ? block.availability : 'busy',
        flexibility: ['fixed', 'soft', 'optional'].includes(block.flexibility) ? block.flexibility : 'soft',
        outfitContext: ['sleep', 'home', 'work', 'social', 'active', 'formal', 'weather'].includes(block.outfitContext)
            ? block.outfitContext : 'home'
    };
}

function normalizeCompanionLifeProfile(raw) {
    const life = isPlainObject(raw) ? raw : {};
    const supplyIds=new Set();
    // Match the reviewed life-proposal contract. Smaller legacy display limits
    // silently discarded accepted authoring, including on later reloads.
    const description = value => Array.from(String(value || '').trim()).slice(0, 4000).join('');
    return {
        version: 1,
        world: VHWorldEngine.config(life.world),
        initializedAt: Number.isFinite(life.initializedAt) ? life.initializedAt : 0,
        seed: String(life.seed || '').slice(0, 100),
        fashionSense: description(life.fashionSense),
        grooming: description(life.grooming),
        foodHabits: description(life.foodHabits),
        mediaHabits: description(life.mediaHabits),
        moneyPattern: description(life.moneyPattern),
        healthRoutine: description(life.healthRoutine),
        digitalLife: description(life.digitalLife),
        seasonalVariation: description(life.seasonalVariation),
        ...(Array.isArray(life.personalCalendar)?{personalCalendar:life.personalCalendar.filter(r=>r&&typeof r==='object').slice(0,200).map(r=>Object.fromEntries(['id','title','date','kind','recurrence','personId','reminderDays','notes','source','enabled'].filter(k=>r[k]!==undefined).map(k=>[k,r[k]])))}:{}),
        workweekDays: (Array.isArray(life.workweekDays) ? life.workweekDays : [1, 2, 3, 4, 5])
            .map(Number).filter(day => Number.isInteger(day) && day >= 0 && day <= 6).slice(0, 7),
        places: (Array.isArray(life.places) ? life.places : []).map(normalizeCompanionLifePlace)
            .filter(place => place.label).slice(0, 550),
        travelLegs: (Array.isArray(life.travelLegs) ? life.travelLegs : []).slice(0, 5100).map(leg => ({
            from: String(leg.from || '').slice(0,80), to: String(leg.to || '').slice(0,80),
            source: String(leg.source || '').slice(0,160),
            geometry: VHWorldEngine.routeGeometry(leg.geometry),
            cost: livingClamp(Number(leg.cost) || 0, 0, 100000),
            mode: ['WALK','DRIVE','BICYCLE','TRANSIT','RIDESHARE'].includes(leg.mode) ? leg.mode : 'WALK',
            minutes: livingClamp(Math.round(Number(leg.minutes) || 0), 0, 360)
        })).filter(leg => leg.from && leg.to && leg.from !== leg.to && leg.minutes > 0),
        socialCircle: (Array.isArray(life.socialCircle) ? life.socialCircle : []).map(normalizeCompanionSocialPerson)
            .filter(person => person.name).slice(0, 30),
        wardrobe: (Array.isArray(life.wardrobe) ? life.wardrobe : []).map(normalizeCompanionWardrobeLook)
            .filter(look => look.items).slice(0, 30),
        supplies:(Array.isArray(life.supplies)?life.supplies:[]).filter(x=>x&&/^[a-z][a-z0-9_]{0,39}$/.test(x.id)&&!['constructor','prototype'].includes(x.id)&&!supplyIds.has(x.id)&&supplyIds.add(x.id)).slice(0,30).map(x=>({id:x.id,label:String(x.label||x.id).slice(0,80),quantity:livingClamp(x.quantity,0,10000)})),
        sleepPolicy:VHActivityEngine.sleepPolicy(life.sleepPolicy),
        breakPolicy:VHActivityEngine.breakPolicy(life.breakPolicy),
        decisionPolicy: VHActivityEngine.policy(life.decisionPolicy),
        activityOptions: VHActivityEngine.normalizeOpportunities(life.activityOptions),
        weeklySchedule: (Array.isArray(life.weeklySchedule) ? life.weeklySchedule : []).map(normalizeCompanionScheduleBlock)
            .filter(block => block.activity && block.days.length).slice(0, 160)
    };
}

function normalizeCompanionEnvironment(raw) {
    const environment = isPlainObject(raw) ? raw : {};
    return {
        fetchedAt: Number.isFinite(environment.fetchedAt) ? environment.fetchedAt : 0,
        temperature: Number.isFinite(Number(environment.temperature)) ? Number(environment.temperature) : null,
        apparentTemperature: Number.isFinite(Number(environment.apparentTemperature))
            ? Number(environment.apparentTemperature) : null,
        weatherCode: Number.isFinite(Number(environment.weatherCode)) ? Number(environment.weatherCode) : null,
        precipitation: Number.isFinite(Number(environment.precipitation)) ? Number(environment.precipitation) : 0,
        cloudCover: Number.isFinite(Number(environment.cloudCover)) ? Number(environment.cloudCover) : null,
        windSpeed: Number.isFinite(Number(environment.windSpeed)) ? Number(environment.windSpeed) : null,
        isDay: environment.isDay === 0 ? false : environment.isDay === 1 ? true : null,
        sunrise: String(environment.sunrise || '').slice(0, 40),
        sunset: String(environment.sunset || '').slice(0, 40),
        stale: environment.stale === true
    };
}

function normalizeCompanionLifeRuntime(raw, socialCircle = []) {
    const runtime = isPlainObject(raw) ? raw : {};
    const pending = isPlainObject(runtime.pendingInitiative) ? runtime.pendingInitiative : null;
    const temporary = isPlainObject(runtime.temporarySituation) ? runtime.temporarySituation : null;
    return {
        world: VHWorldEngine.runtime(runtime.world),
        lastSimulatedAt: Number.isFinite(runtime.lastSimulatedAt) ? runtime.lastSimulatedAt : Date.now(),
        currentSituationKey: String(runtime.currentSituationKey || '').slice(0, 240),
        lastLabsBeatAt: Number.isFinite(runtime.lastLabsBeatAt) ? runtime.lastLabsBeatAt : 0,
        pendingInitiative: pending ? {
            text: String(pending.text || '').trim().slice(0, 500),
            createdAt: Number.isFinite(pending.createdAt) ? pending.createdAt : 0,
            expiresAt: Number.isFinite(pending.expiresAt) ? pending.expiresAt : 0
        } : null,
        temporarySituation: temporary ? {
            activity: String(temporary.activity || '').trim().slice(0, 240),
            placeLabel: String(temporary.placeLabel || '').trim().slice(0, 160),
            withNames: (Array.isArray(temporary.withNames) ? temporary.withNames : [])
                .map(value => String(value).trim().slice(0, 100)).filter(Boolean).slice(0, 8),
            availability: COMPANION_LIFE_AVAILABILITY.includes(temporary.availability)
                ? temporary.availability : 'available',
            outfit: String(temporary.outfit || '').trim().slice(0, 500),
            startedAt: Number.isFinite(temporary.startedAt) ? temporary.startedAt : 0,
            endsAt: Number.isFinite(temporary.endsAt) ? temporary.endsAt : 0,
            reason: String(temporary.reason || '').trim().slice(0, 300)
        } : null,
        environment: normalizeCompanionEnvironment(runtime.environment),
        socialWorld: normalizeCompanionSocialWorldRuntime(runtime.socialWorld, socialCircle),
        activities: VHActivityEngine.normalize(runtime.activities),
        dayPlan: (Array.isArray(runtime.dayPlan) ? runtime.dayPlan : []).map((item, index) => ({
            id: String(item?.id || livingId('vh_life_plan', `${item?.dateKey}|${item?.kind}|${index}`)).slice(0, 100),
            dateKey: String(item?.dateKey || '').slice(0, 20),
            kind: ['schedule', 'relationship', 'obligation', 'opportunity', 'recovery'].includes(item?.kind)
                ? item.kind : 'schedule',
            summary: String(item?.summary || '').trim().slice(0, 500),
            cause: String(item?.cause || '').trim().slice(0, 500),
            personId: String(item?.personId || '').slice(0, 80),
            dueAt: Number.isFinite(item?.dueAt) ? item.dueAt : 0,
            status: ['planned', 'active', 'completed', 'cancelled'].includes(item?.status) ? item.status : 'planned',
            createdAt: Number.isFinite(item?.createdAt) ? item.createdAt : Date.now(),
            resolvedAt: Number.isFinite(item?.resolvedAt) ? item.resolvedAt : 0
        })).filter(item => item.summary).slice(-80),
        plannedDateKey: String(runtime.plannedDateKey || '').slice(0, 20),
        simulationLedger: (Array.isArray(runtime.simulationLedger) ? runtime.simulationLedger : []).map(item => ({
            id: String(item?.id || livingId('vh_sim', item?.createdAt || Date.now())).slice(0, 100),
            kind: ['schedule', 'travel', 'social', 'wildcard', 'initiative', 'post', 'provider', 'warning'].includes(item?.kind) ? item.kind : 'schedule',
            summary: String(item?.summary || '').trim().slice(0, 400),
            createdAt: Number.isFinite(item?.createdAt) ? item.createdAt : Date.now(),
            costCalls: livingClamp(Math.round(Number(item?.costCalls) || 0), 0, 20)
        })).filter(item => item.summary).slice(-500)
    };
}

const COMPANION_CONTINUITY_EVENT_TYPES = Object.freeze([
    'message_sent', 'message_delivered', 'message_seen', 'message_batch_seen', 'response_sent',
    'response_withheld', 'initiative', 'social_post', 'social_interaction', 'life_event',
    'commitment', 'episode', 'origin', 'belief_revision', 'intention_change', 'thread_change', 'system'
]);

function normalizeCompanionContinuityEvent(raw, index = 0) {
    const event = isPlainObject(raw) ? raw : {};
    const createdAt = Number.isFinite(event.createdAt) ? event.createdAt : Date.now();
    return {
        id: String(event.id || livingId('vh_event', `${createdAt}|${event.type || 'system'}|${index}`)).slice(0, 100),
        type: COMPANION_CONTINUITY_EVENT_TYPES.includes(event.type) ? event.type : 'system',
        summary: String(event.summary || '').trim().slice(0, 700),
        interpretation: String(event.interpretation || '').trim().slice(0, 700),
        certainty: livingClamp(Number.isFinite(Number(event.certainty)) ? Number(event.certainty) : 100, 0, 100),
        sourceMessageIds: (Array.isArray(event.sourceMessageIds) ? event.sourceMessageIds : [])
            .map(value => String(value).slice(0, 100)).filter(Boolean).slice(0, 20),
        sourceResponseGroupId: String(event.sourceResponseGroupId || '').slice(0, 100),
        dedupeKey: String(event.dedupeKey || '').trim().slice(0, 180),
        createdAt,
        perceivedAt: Number.isFinite(event.perceivedAt) ? event.perceivedAt : 0,
        resolvedAt: Number.isFinite(event.resolvedAt) ? event.resolvedAt : 0
    };
}

function normalizeCompanionBelief(raw, index = 0) {
    const belief = isPlainObject(raw) ? raw : {};
    const proposition = String(belief.proposition || belief.text || '').trim().slice(0, 700);
    return {
        id: String(belief.id || livingId('vh_belief', `${belief.subject || 'player'}|${proposition}|${index}`)).slice(0, 100),
        subject: String(belief.subject || 'player').trim().slice(0, 120),
        proposition,
        confidence: livingClamp(Number.isFinite(Number(belief.confidence)) ? Number(belief.confidence) : 50, 0, 100),
        basis: String(belief.basis || '').trim().slice(0, 500),
        evidence: (Array.isArray(belief.evidence) ? belief.evidence : []).map(item => ({
            summary: String(item?.summary || '').trim().slice(0, 500),
            stance: item?.stance === 'contradicts' ? 'contradicts' : 'supports',
            strength: livingClamp(Number.isFinite(Number(item?.strength)) ? Number(item.strength) : 50, 0, 100),
            sourceEventId: String(item?.sourceEventId || '').slice(0, 100),
            createdAt: Number.isFinite(item?.createdAt) ? item.createdAt : Date.now()
        })).filter(item => item.summary).slice(-20),
        revisionCount: Math.max(0, Math.round(Number(belief.revisionCount) || 0)),
        supersededBy: String(belief.supersededBy || '').slice(0, 100),
        status: ['active', 'revised', 'discarded'].includes(belief.status) ? belief.status : 'active',
        sourceEventId: String(belief.sourceEventId || '').slice(0, 100),
        createdAt: Number.isFinite(belief.createdAt) ? belief.createdAt : Date.now(),
        updatedAt: Number.isFinite(belief.updatedAt) ? belief.updatedAt : Date.now()
    };
}

function normalizeCompanionIntention(raw, index = 0) {
    const intention = isPlainObject(raw) ? raw : {};
    const action = String(intention.action || intention.text || '').trim().slice(0, 600);
    return {
        id: String(intention.id || livingId('vh_intent', `${action}|${intention.createdAt || Date.now()}|${index}`)).slice(0, 100),
        kind: ['reply', 'relationship', 'life', 'social', 'commitment', 'avoidance'].includes(intention.kind)
            ? intention.kind : 'life',
        action,
        reason: String(intention.reason || '').trim().slice(0, 600),
        status: ['planned', 'active', 'completed', 'abandoned', 'blocked'].includes(intention.status)
            ? intention.status : 'planned',
        priority: livingClamp(Number.isFinite(Number(intention.priority)) ? Number(intention.priority) : 50, 0, 100),
        channel: ['text', 'photo', 'voice', 'call', 'social', 'internal'].includes(intention.channel)
            ? intention.channel : 'internal',
        executionMode: ['reach_out', 'social_post', 'remind', 'commitment', 'internal'].includes(intention.executionMode)
            ? intention.executionMode : 'internal',
        attempts: Math.max(0, Math.round(Number(intention.attempts) || 0)),
        lastAttemptAt: Number.isFinite(intention.lastAttemptAt) ? intention.lastAttemptAt : 0,
        outcome: String(intention.outcome || '').trim().slice(0, 500),
        sourceEventId: String(intention.sourceEventId || '').slice(0, 100),
        sourceMessageId: String(intention.sourceMessageId || '').slice(0, 100),
        createdAt: Number.isFinite(intention.createdAt) ? intention.createdAt : Date.now(),
        dueAt: Number.isFinite(intention.dueAt) ? intention.dueAt : 0,
        resolvedAt: Number.isFinite(intention.resolvedAt) ? intention.resolvedAt : 0
    };
}

function normalizeCompanionEpisode(raw, index = 0) {
    const episode = isPlainObject(raw) ? raw : {};
    const summary = String(episode.summary || '').trim().slice(0, 1000);
    const createdAt = Number.isFinite(episode.createdAt) ? episode.createdAt : Date.now();
    return {
        id: String(episode.id || livingId('vh_episode', `${episode.title || summary}|${createdAt}|${index}`)).slice(0, 100),
        title: String(episode.title || summary.slice(0, 80) || 'Remembered moment').trim().slice(0, 160),
        summary,
        emotionalMeaning: String(episode.emotionalMeaning || '').trim().slice(0, 700),
        participants: (Array.isArray(episode.participants) ? episode.participants : [])
            .map(value => String(value).trim().slice(0, 100)).filter(Boolean).slice(0, 12),
        sourceEventIds: (Array.isArray(episode.sourceEventIds) ? episode.sourceEventIds : [])
            .map(value => String(value).slice(0, 100)).filter(Boolean).slice(-20),
        unresolvedThreadIds: (Array.isArray(episode.unresolvedThreadIds) ? episode.unresolvedThreadIds : [])
            .map(value => String(value).slice(0, 100)).filter(Boolean).slice(0, 12),
        importance: livingClamp(Number.isFinite(Number(episode.importance)) ? Number(episode.importance) : 50, 0, 100),
        emotionalTone: String(episode.emotionalTone || '').trim().slice(0, 120),
        relationshipImpact: livingClamp(Number.isFinite(Number(episode.relationshipImpact)) ? Number(episode.relationshipImpact) : 0, -100, 100),
        status: ['active', 'reinterpreted', 'archived'].includes(episode.status) ? episode.status : 'active',
        createdAt,
        updatedAt: Number.isFinite(episode.updatedAt) ? episode.updatedAt : createdAt,
        lastRecalledAt: Number.isFinite(episode.lastRecalledAt) ? episode.lastRecalledAt : 0,
        recallCount: Math.max(0, Math.round(Number(episode.recallCount) || 0))
    };
}

function normalizeCompanionOpenThread(raw, index = 0) {
    const thread = isPlainObject(raw) ? raw : {};
    const topic = String(thread.topic || thread.summary || '').trim().slice(0, 240);
    return {
        id: String(thread.id || livingId('vh_thread', `${topic}|${thread.createdAt || Date.now()}|${index}`)).slice(0, 100),
        topic,
        summary: String(thread.summary || topic).trim().slice(0, 700),
        stakes: String(thread.stakes || '').trim().slice(0, 500),
        status: ['open', 'escalating', 'dormant', 'resolved'].includes(thread.status) ? thread.status : 'open',
        salience: livingClamp(Number.isFinite(Number(thread.salience)) ? Number(thread.salience) : 50, 0, 100),
        createdAt: Number.isFinite(thread.createdAt) ? thread.createdAt : Date.now(),
        updatedAt: Number.isFinite(thread.updatedAt) ? thread.updatedAt : Date.now(),
        resolvedAt: Number.isFinite(thread.resolvedAt) ? thread.resolvedAt : 0
    };
}

function normalizeCompanionDecisionEvidence(raw) {
    const decision = isPlainObject(raw) ? raw : {};
    return {
        decision: String(decision.decision || '').trim().slice(0, 400),
        perceived: String(decision.perceived || '').trim().slice(0, 700),
        interpretation: String(decision.interpretation || '').trim().slice(0, 700),
        pressures: (Array.isArray(decision.pressures) ? decision.pressures : [])
            .map(value => String(value).trim().slice(0, 240)).filter(Boolean).slice(0, 12),
        confidence: livingClamp(Number.isFinite(Number(decision.confidence)) ? Number(decision.confidence) : 50, 0, 100),
        source: ['kernel', 'model', 'mixed', 'manual'].includes(decision.source) ? decision.source : 'kernel',
        createdAt: Number.isFinite(decision.createdAt) ? decision.createdAt : 0
    };
}

function normalizeCompanionPlayerModelEntry(raw, index = 0) {
    const item = isPlainObject(raw) ? raw : {};
    const statement = String(item.statement || item.proposition || '').trim().slice(0, 700);
    return {
        id: String(item.id || livingId('vh_player_model', `${item.kind || 'inference'}|${statement}|${index}`)).slice(0, 100),
        personaId: String(item.personaId||'').slice(0,100),
        kind: ['public_claim', 'stated_fact', 'demonstrated_pattern', 'inferred_motive', 'perceived_player_view']
            .includes(item.kind) ? item.kind : 'inferred_motive',
        statement,
        source: ['persona', 'player_statement', 'observed_behavior', 'social_interaction', 'third_party', 'inference']
            .includes(item.source) ? item.source : 'inference',
        confidence: livingClamp(Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : 50, 0, 100),
        evidence: (Array.isArray(item.evidence) ? item.evidence : []).map(value => String(value).trim().slice(0, 400)).filter(Boolean).slice(-12),
        status: ['active', 'revised', 'discarded'].includes(item.status) ? item.status : 'active',
        createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
        updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : Date.now()
    };
}

function normalizeCompanionBoundary(raw, index = 0) {
    const item = isPlainObject(raw) ? raw : {};
    const topic = String(item.topic || '').trim().slice(0, 240);
    return {
        id: String(item.id || livingId('vh_boundary', `${topic}|${index}`)).slice(0, 100),
        topic,
        rule: String(item.rule || '').trim().slice(0, 600),
        strength: ['preference', 'soft', 'firm', 'hard'].includes(item.strength) ? item.strength : 'soft',
        source: ['authored', 'stated', 'inferred', 'event'].includes(item.source) ? item.source : 'event',
        tests: Math.max(0, Math.round(Number(item.tests) || 0)),
        respected: Math.max(0, Math.round(Number(item.respected) || 0)),
        violated: Math.max(0, Math.round(Number(item.violated) || 0)),
        sensitivity: livingClamp(Number.isFinite(Number(item.sensitivity)) ? Number(item.sensitivity) : 35, 0, 100),
        status: item.status === 'retired' ? 'retired' : 'active',
        createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
        updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : Date.now()
    };
}

function normalizeCompanionTruthEntry(raw, index = 0) {
    const item = isPlainObject(raw) ? raw : {};
    const truth = String(item.truth || '').trim().slice(0, 700);
    return {
        id: String(item.id || livingId('vh_truth', `${truth}|${index}`)).slice(0, 100),
        truth,
        toldPlayer: String(item.toldPlayer || item.told_player || '').trim().slice(0, 700),
        coverStory: String(item.coverStory || item.cover_story || '').trim().slice(0, 700),
        disclosure: ['secret', 'omitted', 'partial', 'disclosed', 'discovered'].includes(item.disclosure)
            ? item.disclosure : 'secret',
        discoveryRisk: livingClamp(Number.isFinite(Number(item.discoveryRisk ?? item.discovery_risk))
            ? Number(item.discoveryRisk ?? item.discovery_risk) : 20, 0, 100),
        emotionalCost: livingClamp(Number.isFinite(Number(item.emotionalCost ?? item.emotional_cost))
            ? Number(item.emotionalCost ?? item.emotional_cost) : 20, 0, 100),
        createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
        updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : Date.now()
    };
}

function normalizeCompanionMilestone(raw, index = 0) {
    const item = isPlainObject(raw) ? raw : {};
    const summary = String(item.summary || '').trim().slice(0, 600);
    return {
        id: String(item.id || livingId('vh_milestone', `${item.type || 'other'}|${summary}|${index}`)).slice(0, 100),
        type: ['first_message', 'first_joke', 'first_photo', 'first_voice_note', 'first_call', 'first_conflict',
            'first_apology', 'first_secret', 'first_meeting', 'betrayal', 'reconciliation', 'other'].includes(item.type)
            ? item.type : 'other',
        summary,
        createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now()
    };
}

function normalizeCompanionContinuityRuntime(raw, nowMs = Date.now()) {
    const runtime = isPlainObject(raw) ? raw : {};
    return {
        version: 7,
        conversation: VHConversationEngine.normalize(runtime.conversation),
        lastExchangeAt: Math.max(0, Number(runtime.lastExchangeAt) || 0),
        lastHandoffKey: String(runtime.lastHandoffKey || '').slice(0, 200),
        lastHandoffAttemptAt: Math.max(0, Number(runtime.lastHandoffAttemptAt) || 0),
        revision: Math.max(0, Math.round(Number(runtime.revision) || 0)),
        originScenarioConsumedAt: Number.isFinite(runtime.originScenarioConsumedAt)
            ? runtime.originScenarioConsumedAt : 0,
        originEpisodeId: String(runtime.originEpisodeId || '').slice(0, 100),
        playerPersonaId: String(runtime.playerPersonaId||'').slice(0,100),
        playerFacts: (Array.isArray(runtime.playerFacts)?runtime.playerFacts:[]).filter(f=>f&&f.key&&f.value).slice(-160).map(f=>({personaId:String(f.personaId||'__none__').slice(0,100),key:String(f.key).slice(0,40),value:String(f.value).slice(0,500),statement:String(f.statement||'').slice(0,700),messageId:String(f.messageId||'').slice(0,100),at:Number(f.at)||0})),
        playerModel: (Array.isArray(runtime.playerModel) ? runtime.playerModel : [])
            .map(normalizeCompanionPlayerModelEntry).filter(item => item.statement).slice(-160),
        boundaries: (Array.isArray(runtime.boundaries) ? runtime.boundaries : [])
            .map(normalizeCompanionBoundary).filter(item => item.topic && item.rule).slice(-100),
        truthLedger: (Array.isArray(runtime.truthLedger) ? runtime.truthLedger : [])
            .map(normalizeCompanionTruthEntry).filter(item => item.truth).slice(-100),
        milestones: (Array.isArray(runtime.milestones) ? runtime.milestones : [])
            .map(normalizeCompanionMilestone).filter(item => item.summary).slice(-120),
        conversationGoal: {
            type: String(runtime.conversationGoal?.type || '').trim().slice(0, 80),
            objective: String(runtime.conversationGoal?.objective || '').trim().slice(0, 400),
            reason: String(runtime.conversationGoal?.reason || '').trim().slice(0, 500),
            chosenAt: Number.isFinite(runtime.conversationGoal?.chosenAt) ? runtime.conversationGoal.chosenAt : 0
        },
        eventLedger: (Array.isArray(runtime.eventLedger) ? runtime.eventLedger : [])
            .map(normalizeCompanionContinuityEvent).filter(event => event.summary).slice(-500),
        beliefs: (Array.isArray(runtime.beliefs) ? runtime.beliefs : [])
            .map(normalizeCompanionBelief).filter(belief => belief.proposition).slice(-120),
        intentions: (Array.isArray(runtime.intentions) ? runtime.intentions : [])
            .map(normalizeCompanionIntention).filter(intention => intention.action).slice(-100),
        episodes: (Array.isArray(runtime.episodes) ? runtime.episodes : [])
            .map(normalizeCompanionEpisode).filter(episode => episode.summary).slice(-120),
        openThreads: (Array.isArray(runtime.openThreads) ? runtime.openThreads : [])
            .map(normalizeCompanionOpenThread).filter(thread => thread.topic).slice(-80),
        lastDecision: normalizeCompanionDecisionEvidence(runtime.lastDecision),
        lastAdvancedAt: Number.isFinite(runtime.lastAdvancedAt) ? runtime.lastAdvancedAt : nowMs
    };
}

function companionRecordEpisode(companion, raw, nowMs = Date.now()) {
    const runtime = companionContinuity(companion);
    const candidate = normalizeCompanionEpisode({ ...raw, createdAt: raw?.createdAt || nowMs }, runtime.episodes.length);
    if (!candidate.summary) return null;
    const key = `${candidate.title}|${candidate.summary}`.toLowerCase().replace(/\s+/g, ' ').slice(0, 500);
    const existing = runtime.episodes.find(item => item.id === raw?.id)
        || runtime.episodes.find(item => `${item.title}|${item.summary}`.toLowerCase().replace(/\s+/g, ' ').slice(0, 500) === key);
    if (existing) {
        existing.emotionalMeaning = candidate.emotionalMeaning || existing.emotionalMeaning;
        existing.importance = Math.max(existing.importance, candidate.importance);
        existing.emotionalTone = candidate.emotionalTone || existing.emotionalTone;
        existing.relationshipImpact = Math.abs(candidate.relationshipImpact) > Math.abs(existing.relationshipImpact)
            ? candidate.relationshipImpact : existing.relationshipImpact;
        existing.sourceEventIds = [...new Set([...existing.sourceEventIds, ...candidate.sourceEventIds])].slice(-20);
        existing.unresolvedThreadIds = [...new Set([...existing.unresolvedThreadIds, ...candidate.unresolvedThreadIds])].slice(0, 12);
        existing.updatedAt = nowMs;
        return existing;
    }
    runtime.episodes.push(candidate);
    runtime.episodes = runtime.episodes.slice(-120);
    companionRecordContinuityEvent(companion, {
        type: 'episode', summary: `Remembered: ${candidate.title}`,
        interpretation: candidate.emotionalMeaning || candidate.summary,
        certainty: 100, createdAt: nowMs, perceivedAt: nowMs,
        dedupeKey: `episode:${candidate.id}`
    });
    return candidate;
}

function companionContinuity(companion) {
    const current = companion.continuityRuntime;
    const normalized = normalizeCompanionContinuityRuntime(current);
    // Preserve the runtime object identity while helper functions compose a
    // single transaction. Replacing it here made an earlier helper's local
    // reference stale, so a later decision write could silently discard an
    // intention or belief added moments before it.
    if (isPlainObject(current)) {
        const preserveEntries = (previous, next) => next.map(item => {
            const existing = Array.isArray(previous) ? previous.find(candidate => candidate?.id === item.id) : null;
            if (!isPlainObject(existing)) return item;
            Object.assign(existing, item);
            return existing;
        });
        normalized.eventLedger = preserveEntries(current.eventLedger, normalized.eventLedger);
        normalized.beliefs = preserveEntries(current.beliefs, normalized.beliefs);
        normalized.intentions = preserveEntries(current.intentions, normalized.intentions);
        normalized.episodes = preserveEntries(current.episodes, normalized.episodes);
        normalized.openThreads = preserveEntries(current.openThreads, normalized.openThreads);
        normalized.playerModel = preserveEntries(current.playerModel, normalized.playerModel);
        normalized.boundaries = preserveEntries(current.boundaries, normalized.boundaries);
        normalized.truthLedger = preserveEntries(current.truthLedger, normalized.truthLedger);
        normalized.milestones = preserveEntries(current.milestones, normalized.milestones);
        Object.assign(current, normalized);
        return current;
    }
    companion.continuityRuntime = normalized;
    return companion.continuityRuntime;
}

function companionRecordContinuityEvent(companion, raw) {
    const runtime = companionContinuity(companion);
    const event = normalizeCompanionContinuityEvent(raw, runtime.eventLedger.length);
    if (!event.summary) return null;
    if (event.dedupeKey && runtime.eventLedger.some(item => item.dedupeKey === event.dedupeKey)) return null;
    runtime.eventLedger.push(event);
    runtime.eventLedger = runtime.eventLedger.slice(-500);
    runtime.lastAdvancedAt = Math.max(runtime.lastAdvancedAt, event.createdAt);
    return event;
}

function companionSetDecisionEvidence(companion, raw) {
    const runtime = companionContinuity(companion);
    runtime.lastDecision = normalizeCompanionDecisionEvidence({ ...raw, createdAt: raw?.createdAt || Date.now() });
    runtime.lastAdvancedAt = Math.max(runtime.lastAdvancedAt, runtime.lastDecision.createdAt);
    return runtime.lastDecision;
}

function normalizeCompanionHumanDynamics(raw, nowMs = Date.now()) {
    const dynamics = isPlainObject(raw) ? raw : {};
    return {
        sleep:VHActivityEngine.normalizeSleep(dynamics.sleep),
        illnessSeverity: livingClamp(Number(dynamics.illnessSeverity)||0,0,100),
        heatDiscomfort: Number.isFinite(dynamics.heatDiscomfort)?livingClamp(dynamics.heatDiscomfort,0,100):null,
        hunger: livingClamp(Number.isFinite(Number(dynamics.hunger)) ? Number(dynamics.hunger) : 30, 0, 100),
        energy: livingClamp(Number.isFinite(Number(dynamics.energy)) ? Number(dynamics.energy) : 70, 0, 100),
        stress: livingClamp(Number.isFinite(Number(dynamics.stress)) ? Number(dynamics.stress) : 22, 0, 100),
        socialNeed: livingClamp(Number.isFinite(Number(dynamics.socialNeed)) ? Number(dynamics.socialNeed) : 28, 0, 100),
        anger: livingClamp(Number.isFinite(Number(dynamics.anger)) ? Number(dynamics.anger) : 0, 0, 100),
        intoxication: livingClamp(Number.isFinite(Number(dynamics.intoxication)) ? Number(dynamics.intoxication) : 0, 0, 100),
        inhibition: livingClamp(Number.isFinite(Number(dynamics.inhibition)) ? Number(dynamics.inhibition) : 72, 0, 100),
        desire: livingClamp(Number.isFinite(Number(dynamics.desire)) ? Number(dynamics.desire) : 20, 0, 100),
        sexualArousal: livingClamp(Number.isFinite(Number(dynamics.sexualArousal)) ? Number(dynamics.sexualArousal) : 0, 0, 100),
        sexualFrustration: livingClamp(Number.isFinite(Number(dynamics.sexualFrustration)) ? Number(dynamics.sexualFrustration) : 0, 0, 100),
        postIntimacyCalm: livingClamp(Number.isFinite(Number(dynamics.postIntimacyCalm)) ? Number(dynamics.postIntimacyCalm) : 0, 0, 100),
        sexualCooldownUntil: Number.isFinite(dynamics.sexualCooldownUntil) ? Math.max(0, dynamics.sexualCooldownUntil) : 0,
        intimacyAftereffect: COMPANION_INTIMACY_AFTEREFFECTS.includes(dynamics.intimacyAftereffect)
            ? dynamics.intimacyAftereffect : 'none',
        intimacyAftereffectUntil: Number.isFinite(dynamics.intimacyAftereffectUntil)
            ? Math.max(0, dynamics.intimacyAftereffectUntil) : 0,
        lastIntimacyAt: Number.isFinite(dynamics.lastIntimacyAt) ? Math.max(0, dynamics.lastIntimacyAt) : 0,
        cooldownUntil: Number.isFinite(dynamics.cooldownUntil) ? Math.max(0, dynamics.cooldownUntil) : 0,
        cooldownReason: String(dynamics.cooldownReason || '').trim().slice(0, 240),
        lastUpdated: Number.isFinite(dynamics.lastUpdated) ? dynamics.lastUpdated : nowMs
    };
}

function normalizeCompanionEmotionVector(raw, fallback = null) {
    const source = isPlainObject(raw) ? raw : {};
    const base = isPlainObject(fallback) ? fallback : {};
    return Object.fromEntries(COMPANION_EMOTIONS.map(emotion => [emotion,
        livingClamp(Number.isFinite(Number(source[emotion])) ? Number(source[emotion])
            : Number.isFinite(Number(base[emotion])) ? Number(base[emotion]) : 0, 0, 100)
    ]));
}

function normalizeCompanionEmotionDeltaVector(raw) {
    const source = isPlainObject(raw) ? raw : {};
    return Object.fromEntries(COMPANION_EMOTIONS.map(emotion => [emotion,
        livingClamp(Number.isFinite(Number(source[emotion])) ? Number(source[emotion]) : 0, -100, 100)
    ]));
}

function companionEmotionVectorFromMood(rawMood) {
    const mood = isPlainObject(rawMood) ? rawMood : {};
    const intensity = livingClamp(Math.abs(Number(mood.valence) || 20) * 0.55
        + Math.abs(Number(mood.arousal) || 0) * 0.25 + 12, 0, 72);
    const vector = normalizeCompanionEmotionVector({});
    const mapped = {
        content: ['joy'], happy: ['joy'], excited: ['joy', 'anticipation'],
        affectionate: ['joy', 'trust'], flirty: ['joy', 'anticipation'], playful: ['joy', 'surprise'],
        bored: ['disgust'], tired: ['sadness'], anxious: ['fear', 'anticipation'],
        sad: ['sadness'], hurt: ['sadness', 'anger'], angry: ['anger'],
        jealous: ['anger', 'sadness', 'fear'], lonely: ['sadness', 'anticipation'],
        overwhelmed: ['fear', 'surprise'], numb: ['sadness']
    }[mood.label] || (Number(mood.valence) < 0 ? ['sadness'] : ['joy']);
    mapped.forEach((emotion, index) => { vector[emotion] = livingClamp(intensity - index * 8, 0, 100); });
    return vector;
}

function normalizeCompanionEmotionReaction(raw, index = 0) {
    const reaction = isPlainObject(raw) ? raw : {};
    return {
        id: String(reaction.id || livingId('vh_emotion', `${reaction.dueAt || Date.now()}|${index}`)).slice(0, 100),
        dueAt: Number.isFinite(reaction.dueAt) ? Math.max(0, reaction.dueAt) : 0,
        felt: normalizeCompanionEmotionDeltaVector(reaction.felt),
        towardPlayer: normalizeCompanionEmotionDeltaVector(reaction.towardPlayer),
        reason: String(reaction.reason || '').trim().slice(0, 300)
    };
}

function normalizeCompanionEmotionState(raw, seedMood = null, nowMs = Date.now()) {
    const state = isPlainObject(raw) ? raw : {};
    const seed = companionEmotionVectorFromMood(seedMood);
    const appraisal = isPlainObject(state.lastAppraisal) ? state.lastAppraisal : {};
    return {
        felt: normalizeCompanionEmotionVector(state.felt, seed),
        towardPlayer: normalizeCompanionEmotionVector(state.towardPlayer),
        expressed: normalizeCompanionEmotionVector(state.expressed, seed),
        masking: livingClamp(Number.isFinite(Number(state.masking)) ? Number(state.masking) : 18, 0, 100),
        lastUpdated: Number.isFinite(state.lastUpdated) ? state.lastUpdated : nowMs,
        lastAppraisal: {
            summary: String(appraisal.summary || '').trim().slice(0, 300),
            responsibility: ['player', 'self', 'other', 'circumstance', 'unclear'].includes(appraisal.responsibility)
                ? appraisal.responsibility : 'unclear',
            goalImpact: livingClamp(Number.isFinite(Number(appraisal.goalImpact)) ? Number(appraisal.goalImpact) : 0, -100, 100),
            threat: livingClamp(Number.isFinite(Number(appraisal.threat)) ? Number(appraisal.threat) : 0, 0, 100),
            loss: livingClamp(Number.isFinite(Number(appraisal.loss)) ? Number(appraisal.loss) : 0, 0, 100),
            novelty: livingClamp(Number.isFinite(Number(appraisal.novelty)) ? Number(appraisal.novelty) : 0, 0, 100),
            normViolation: livingClamp(Number.isFinite(Number(appraisal.normViolation)) ? Number(appraisal.normViolation) : 0, 0, 100),
            control: livingClamp(Number.isFinite(Number(appraisal.control)) ? Number(appraisal.control) : 50, 0, 100),
            socialSafety: livingClamp(Number.isFinite(Number(appraisal.socialSafety)) ? Number(appraisal.socialSafety) : 50, 0, 100),
            at: Number.isFinite(appraisal.at) ? appraisal.at : 0
        },
        pendingReactions: (Array.isArray(state.pendingReactions) ? state.pendingReactions : [])
            .map(normalizeCompanionEmotionReaction).filter(item => item.dueAt).slice(-20)
    };
}

function companionSeededRoll(seed) {
    let hash = 0x811c9dc5;
    const str = String(seed);
    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return ((hash >>> 0) % 1000000) / 1000000;
}

function decayCompanionMood(companion, nowMs) {
    const elapsed = Math.max(0, nowMs - companion.mood.lastUpdated);
    if (elapsed === 0) return companion.mood;
    const HALF_LIFE_MS = 4 * 60 * 60 * 1000;
    const retained = Math.pow(0.5, elapsed / HALF_LIFE_MS);
    const settle = (current, base) => base + (current - base) * retained;
    companion.mood.valence = livingClamp(Math.round(settle(companion.mood.valence, companion.moodBaseline.valence-(companion.humanDynamics?.sleep?.irritability||0)*.2)), -100, 100);
    companion.mood.arousal = livingClamp(Math.round(settle(companion.mood.arousal, companion.moodBaseline.arousal)), -100, 100);
    companion.mood.lastUpdated = nowMs;
    return companion.mood;
}

function normalizeCompanionRelationshipDimensions(dynamics = {}, startingRelationship = 0, knownBeforeDays = 0) {
    dynamics = isPlainObject(dynamics) ? dynamics : {};
    startingRelationship = livingClamp(Number(startingRelationship) || 0, -100, 100);
    return {
            trust: livingClamp(dynamics.trust == null ? Math.max(0, startingRelationship) : dynamics.trust, -100, 100),
            warmth: livingClamp(dynamics.warmth == null ? startingRelationship : dynamics.warmth, -100, 100),
            attraction: livingClamp(dynamics.attraction == null ? 0 : dynamics.attraction, -100, 100),
            resentment: livingClamp(dynamics.resentment == null ? Math.max(0, -startingRelationship) : dynamics.resentment, 0, 100),
            stability: livingClamp(dynamics.stability == null ? 50 : dynamics.stability, 0, 100),
            familiarity: livingClamp(dynamics.familiarity == null ? Math.min(100, Number(knownBeforeDays || 0) * 2) : dynamics.familiarity, 0, 100),
            respect: livingClamp(dynamics.respect == null ? Math.max(0, startingRelationship * 0.35) : dynamics.respect, -100, 100),
            comfort: livingClamp(dynamics.comfort == null ? Math.max(0, startingRelationship * 0.4) : dynamics.comfort, 0, 100),
            dependence: livingClamp(dynamics.dependence == null ? 0 : dynamics.dependence, 0, 100),
            fear: livingClamp(dynamics.fear == null ? Math.max(0, -startingRelationship * 0.2) : dynamics.fear, 0, 100),
            obligation: livingClamp(dynamics.obligation == null ? 0 : dynamics.obligation, 0, 100),
            powerImbalance: livingClamp(dynamics.powerImbalance == null ? 0 : dynamics.powerImbalance, -100, 100),
            compatibility: livingClamp(dynamics.compatibility == null ? 0 : dynamics.compatibility, -100, 100)
            };
}

function companionRelationshipDeltaCap(update, field, requested) {
    const appraisal = isPlainObject(update?.emotion_appraisal) ? update.emotion_appraisal : {};
    const certainty = livingClamp(Number(appraisal.certainty) || 0, 0, 100);
    const playerResponsible = appraisal.responsibility === 'player';
    const harm = Math.max(Number(appraisal.threat) || 0, Number(appraisal.loss) || 0,
        Number(appraisal.norm_violation) || 0, -(Number(appraisal.goal_impact) || 0));
    const benefit = Math.max(0, Number(appraisal.goal_impact) || 0, Number(appraisal.social_safety) || 0);
    const severeHarm = playerResponsible && certainty >= 60 && harm >= 70;
    const strongBenefit = certainty >= 65 && benefit >= 70;
    let cap = severeHarm && requested < 0 ? 6 : strongBenefit && requested > 0 ? 4 : 2;
    if (['familiarity', 'dependence', 'obligation'].includes(field)) cap = severeHarm ? 3 : 2;
    if (field === 'attraction') cap = Math.min(cap, 3);
    if (field === 'fear' && requested > 0) cap = severeHarm ? 7 : 2;
    if (field === 'resentment' && requested > 0) cap = severeHarm ? 7 : 2;
    if (field === 'stability' && requested < 0) cap = severeHarm ? 6 : 2;
    return livingClamp(Number(requested) || 0, -cap, cap);
}

function applyCompanionMoodUpdate(companion, update, nowMs) {
    // A delayed receipt may never rewind any of the physiological clocks.
    nowMs = Math.max(nowMs, Number(companion.mood?.lastUpdated) || 0);
    decayCompanionMood(companion, nowMs);
    const u = isPlainObject(update) ? update : {};
    if (Number.isFinite(u.valence_change)) {
        companion.mood.valence = livingClamp(companion.mood.valence + livingClamp(u.valence_change, -40, 40), -100, 100);
    }
    if (Number.isFinite(u.arousal_change)) {
        companion.mood.arousal = livingClamp(companion.mood.arousal + livingClamp(u.arousal_change, -40, 40), -100, 100);
    }
    if (COMPANION_MOOD_LABELS.includes(u.mood_label)) companion.mood.label = u.mood_label;
    if (Number.isFinite(u.relationship_change)) {
        companion.mood.relationship = livingClamp(companion.mood.relationship
            + companionRelationshipDeltaCap(u, 'relationship', u.relationship_change), -100, 100);
    }
    const dimensions = [
        ['trust_change', 'trust', -100, 100],
        ['warmth_change', 'warmth', -100, 100],
        ['attraction_change', 'attraction', -100, 100],
        ['resentment_change', 'resentment', 0, 100],
        ['stability_change', 'stability', 0, 100],
        ['familiarity_change', 'familiarity', 0, 100],
        ['respect_change', 'respect', -100, 100],
        ['comfort_change', 'comfort', 0, 100],
        ['dependence_change', 'dependence', 0, 100],
        ['fear_change', 'fear', 0, 100],
        ['obligation_change', 'obligation', 0, 100],
        ['power_imbalance_change', 'powerImbalance', -100, 100],
        ['compatibility_change', 'compatibility', -100, 100]
    ];
    dimensions.forEach(([input, field, min, max]) => {
        if (!Number.isFinite(u[input])) return;
        companion.relationshipDynamics[field] = livingClamp(
            companion.relationshipDynamics[field] + companionRelationshipDeltaCap(u, field, u[input]), min, max);
    });
    if (u.trauma_add && String(u.trauma_add.label || '').trim()) {
        companion.trauma.push(normalizeCompanionTrauma({ ...u.trauma_add, addedAt: nowMs }));
        companion.trauma = companion.trauma.slice(-20);
    }
    applyCompanionDynamicsUpdate(companion, u, nowMs);
    applyCompanionEmotionUpdate(companion, u, nowMs);
    companion.mood.lastUpdated = nowMs;
    return companion.mood;
}

function companionRegulationFactors(companion) {
    const sensitivity = {
        steady: 0.72, typical: 1, sensitive: 1.22, volatile: 1.5
    }[companion.regulationProfile] || 1;
    const recovery = {
        quick: 0.58, normal: 1, slow: 1.55, grudge: 2.35
    }[companion.conflictRecovery] || 1;
    return { sensitivity, recovery };
}

function companionEmotionFactors(companion) {
    const rumination = { low: 0.65, normal: 1, high: 1.55, sticky: 2.35 }[companion.ruminationStyle] || 1;
    const reactionDelay = { immediate: 0, mixed: 0.45, delayed: 0.8 }[companion.reactionTiming] || 0.45;
    const expressionMask = { transparent: 0.08, guarded: 0.34, masked: 0.68, performative: 0.52 }[companion.emotionExpression] || 0.34;
    return { rumination, reactionDelay, expressionMask };
}

function companionExpressedEmotionVector(companion, emotionState = null) {
    const stateNow = emotionState || companion.emotionState;
    const felt = normalizeCompanionEmotionVector(stateNow?.felt);
    const targeted = normalizeCompanionEmotionVector(stateNow?.towardPlayer);
    const { expressionMask } = companionEmotionFactors(companion);
    const intoxication = Number(companion.humanDynamics?.intoxication) || 0;
    const deliberateMask = livingClamp((Number(stateNow?.masking) || 0) / 100, 0, 1);
    const mask = livingClamp((expressionMask + deliberateMask) / 2 - intoxication / 220, 0, 0.92);
    const combined = Object.fromEntries(COMPANION_EMOTIONS.map(emotion => [emotion,
        livingClamp(Math.max(felt[emotion], targeted[emotion] * 0.9), 0, 100)
    ]));
    return Object.fromEntries(COMPANION_EMOTIONS.map(emotion => {
        let visibility = 1 - mask;
        if (['fear', 'sadness', 'trust'].includes(emotion)) visibility *= 0.82;
        if (companion.emotionExpression === 'transparent') visibility = Math.max(visibility, 0.82);
        if (companion.emotionExpression === 'performative') {
            if (emotion === 'joy') return [emotion, livingClamp(Math.max(combined.joy * 0.82, 24), 0, 100)];
            if (['fear', 'sadness'].includes(emotion)) visibility *= 0.35;
        }
        return [emotion, livingClamp(combined[emotion] * visibility, 0, 100)];
    }));
}

function companionAppraisalEmotionDeltas(companion, rawAppraisal) {
    const input = isPlainObject(rawAppraisal) ? rawAppraisal : {};
    const { sensitivity } = companionRegulationFactors(companion);
    const value = (key, min = 0, max = 100, fallback = 0) => livingClamp(
        Number.isFinite(Number(input[key])) ? Number(input[key]) : fallback, min, max);
    const goal = value('goal_impact', -100, 100);
    const threat = value('threat');
    const loss = value('loss');
    const novelty = value('novelty');
    const norm = value('norm_violation');
    const control = value('control', 0, 100, 50);
    const safety = value('social_safety', 0, 100, 50);
    const certainty = value('certainty', 0, 100, 50);
    const deltas = normalizeCompanionEmotionVector({});
    if (goal > 0) deltas.joy += goal * 0.16;
    if (goal < 0) {
        deltas.sadness += Math.abs(goal) * 0.1;
        deltas.anger += Math.abs(goal) * 0.07 * (0.55 + control / 100);
    }
    deltas.fear += threat * 0.17 * (1.25 - control / 125);
    deltas.sadness += loss * 0.18;
    deltas.surprise += novelty * 0.17;
    deltas.anticipation += novelty * 0.07 + certainty * 0.04;
    deltas.disgust += norm * 0.14;
    deltas.anger += norm * 0.1;
    deltas.trust += safety * 0.11;
    if (safety < 35) deltas.fear += (35 - safety) * 0.12;
    return Object.fromEntries(COMPANION_EMOTIONS.map(emotion => [emotion,
        livingClamp(deltas[emotion] * sensitivity, 0, 30)
    ]));
}

function advanceCompanionEmotionState(companion, nowMs = Date.now()) {
    if(companion.__vh2View)return companion.emotionState;
    companion.emotionState = normalizeCompanionEmotionState(companion.emotionState, companion.mood, nowMs);
    const emotionState = companion.emotionState;
    const elapsedMs = Math.max(0, nowMs - emotionState.lastUpdated);
    if (elapsedMs < 5 * 60 * 1000 && !emotionState.pendingReactions.some(item => item.dueAt <= nowMs)) {
        emotionState.expressed = companionExpressedEmotionVector(companion, emotionState);
        return emotionState;
    }
    const hours = Math.min(168, elapsedMs / (60 * 60 * 1000));
    const { rumination } = companionEmotionFactors(companion);
    const halfLives = {
        joy: 3.5, trust: 7, fear: 4.5, surprise: 0.75,
        sadness: 7.5 * rumination, disgust: 9 * rumination,
        anger: 3.5 * rumination * companionRegulationFactors(companion).recovery,
        anticipation: 4
    };
    const baselineJoy = livingClamp(Math.max(0, companion.moodBaseline?.valence || 0) * 0.3, 0, 25);
    COMPANION_EMOTIONS.forEach(emotion => {
        const retained = Math.pow(0.5, hours / halfLives[emotion]);
        const baseline = emotion === 'joy' ? baselineJoy : 0;
        emotionState.felt[emotion] = livingClamp(baseline
            + (emotionState.felt[emotion] - baseline) * retained, 0, 100);
        const targetRetained = Math.pow(0.5, hours / (halfLives[emotion] * 1.65));
        emotionState.towardPlayer[emotion] = livingClamp(emotionState.towardPlayer[emotion] * targetRetained, 0, 100);
    });
    const due = emotionState.pendingReactions.filter(item => item.dueAt <= nowMs);
    due.forEach(reaction => {
        COMPANION_EMOTIONS.forEach(emotion => {
            emotionState.felt[emotion] = livingClamp(emotionState.felt[emotion] + reaction.felt[emotion], 0, 100);
            emotionState.towardPlayer[emotion] = livingClamp(emotionState.towardPlayer[emotion]
                + reaction.towardPlayer[emotion], 0, 100);
        });
    });
    emotionState.pendingReactions = emotionState.pendingReactions.filter(item => item.dueAt > nowMs).slice(-20);
    emotionState.expressed = companionExpressedEmotionVector(companion, emotionState);
    emotionState.lastUpdated = nowMs;
    return emotionState;
}

function applyCompanionEmotionUpdate(companion, update, nowMs = Date.now()) {
    nowMs = Math.max(nowMs, Number(companion.emotionState?.lastUpdated) || 0);
    const stateNow = advanceCompanionEmotionState(companion, nowMs);
    const input = isPlainObject(update) ? update : {};
    const appraisal = isPlainObject(input.emotion_appraisal) ? input.emotion_appraisal : null;
    const direct = isPlainObject(input.emotion_changes) ? normalizeCompanionEmotionVector(input.emotion_changes) : null;
    const targeted = isPlainObject(input.toward_player_emotions)
        ? normalizeCompanionEmotionVector(input.toward_player_emotions) : null;
    const hasModernUpdate = !!(appraisal || direct || targeted);
    let feltDelta = appraisal ? companionAppraisalEmotionDeltas(companion, appraisal) : normalizeCompanionEmotionVector({});
    if (direct) COMPANION_EMOTIONS.forEach(emotion => {
        feltDelta[emotion] = livingClamp(feltDelta[emotion] + livingClamp(Number(input.emotion_changes[emotion]) || 0, -30, 30), -30, 30);
    });
    if (!hasModernUpdate && COMPANION_MOOD_LABELS.includes(input.mood_label)) {
        const legacy = companionEmotionVectorFromMood({
            label: input.mood_label,
            valence: Number(input.valence_change) || 0,
            arousal: Number(input.arousal_change) || 0
        });
        COMPANION_EMOTIONS.forEach(emotion => { feltDelta[emotion] = legacy[emotion] * 0.32; });
    }
    const targetDelta = normalizeCompanionEmotionVector({});
    if (targeted) COMPANION_EMOTIONS.forEach(emotion => {
        targetDelta[emotion] = livingClamp(Number(input.toward_player_emotions[emotion]) || 0, -30, 30);
    });
    if (appraisal && appraisal.responsibility === 'player') {
        COMPANION_EMOTIONS.forEach(emotion => {
            if (['anger', 'disgust', 'fear', 'sadness', 'trust', 'joy'].includes(emotion)) {
                targetDelta[emotion] = livingClamp(targetDelta[emotion] + feltDelta[emotion] * 0.75, -30, 30);
            }
        });
    }
    const requestedDelay = livingClamp(Math.round(Number(input.delayed_reaction_minutes) || 0), 0, 72 * 60);
    const { reactionDelay } = companionEmotionFactors(companion);
    const delayMinutes = requestedDelay || (hasModernUpdate && reactionDelay >= 0.8
        ? 30 + Math.round(companionSeededRoll(`${companion.id}|delayed-emotion|${nowMs}`) * 180) : 0);
    const immediateShare = delayMinutes > 0 ? 1 - reactionDelay * 0.72 : 1;
    COMPANION_EMOTIONS.forEach(emotion => {
        stateNow.felt[emotion] = livingClamp(stateNow.felt[emotion] + feltDelta[emotion] * immediateShare, 0, 100);
        stateNow.towardPlayer[emotion] = livingClamp(stateNow.towardPlayer[emotion]
            + targetDelta[emotion] * immediateShare, 0, 100);
    });
    if (delayMinutes > 0) {
        stateNow.pendingReactions.push(normalizeCompanionEmotionReaction({
            dueAt: nowMs + delayMinutes * 60 * 1000,
            felt: Object.fromEntries(COMPANION_EMOTIONS.map(emotion => [emotion, feltDelta[emotion] * (1 - immediateShare)])),
            towardPlayer: Object.fromEntries(COMPANION_EMOTIONS.map(emotion => [emotion, targetDelta[emotion] * (1 - immediateShare)])),
            reason: input.emotional_trigger || appraisal?.summary || 'a delayed emotional reaction'
        }, stateNow.pendingReactions.length));
        stateNow.pendingReactions = stateNow.pendingReactions.slice(-20);
    }
    if (Number.isFinite(Number(input.masking_change))) {
        stateNow.masking = livingClamp(stateNow.masking + livingClamp(Number(input.masking_change), -30, 30), 0, 100);
    }
    if (appraisal) {
        stateNow.lastAppraisal = normalizeCompanionEmotionState({ lastAppraisal: {
            summary: input.emotional_trigger || appraisal.summary || '',
            responsibility: appraisal.responsibility,
            goalImpact: appraisal.goal_impact,
            threat: appraisal.threat,
            loss: appraisal.loss,
            novelty: appraisal.novelty,
            normViolation: appraisal.norm_violation,
            control: appraisal.control,
            socialSafety: appraisal.social_safety,
            at: nowMs
        } }, null, nowMs).lastAppraisal;
    }
    stateNow.expressed = companionExpressedEmotionVector(companion, stateNow);
    stateNow.lastUpdated = nowMs;
    const combined = Object.fromEntries(COMPANION_EMOTIONS.map(emotion => [emotion,
        Math.max(stateNow.felt[emotion], stateNow.towardPlayer[emotion])
    ]));
    const dominant = COMPANION_EMOTIONS.map(emotion => [emotion, combined[emotion]])
        .sort((a, b) => b[1] - a[1])[0];
    const moodMap = { joy: 'happy', trust: 'affectionate', fear: 'anxious', surprise: 'excited',
        sadness: 'sad', disgust: 'hurt', anger: 'angry', anticipation: 'excited' };
    if (hasModernUpdate && dominant[1] >= 18) companion.mood.label = moodMap[dominant[0]];
    const positive = combined.joy * 0.65 + combined.trust * 0.35;
    const negative = combined.sadness * 0.35 + combined.fear * 0.2 + combined.anger * 0.25 + combined.disgust * 0.2;
    if (hasModernUpdate) companion.mood.valence = livingClamp(Math.round(positive - negative), -100, 100);
    if (hasModernUpdate) companion.mood.arousal = livingClamp(Math.round(
        combined.anger * 0.28 + combined.fear * 0.26 + combined.surprise * 0.22
        + combined.anticipation * 0.18 + combined.joy * 0.08 - combined.sadness * 0.08), -100, 100);
    companion.humanDynamics.anger = livingClamp(Math.max(
        companion.humanDynamics.anger, stateNow.felt.anger, stateNow.towardPlayer.anger
    ), 0, 100);
    return stateNow;
}

function companionSexualSystemActive(companion) {
    return companion?.libidoEnabled === true && companionCurrentAge(companion) >= 18;
}

function companionCurrentAge(companion, person = companion) {
    if (!person) return null;
    const id = person === companion || person.id === companion?.id ? 'self' : person.id;
    const records = companion?.vh2Calendar?.ages || {};
    const value = Object.hasOwn(records, id) ? records[id].currentAge : person.age;
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 130 ? value : null;
}

function companionAgeConfirmationMatches(companion, person, recordedAge) {
    const age = companionCurrentAge(companion, person);
    if (age === null || age < 18 || !Number.isInteger(recordedAge) || recordedAge < 18) return false;
    return Object.hasOwn(companion?.vh2Calendar?.ages || {}, person.id) ? recordedAge <= age : recordedAge === age;
}

function companionSexualFactors(companion) {
    const baseline = {
        very_low: 8, low: 24, moderate: 45, high: 68, very_high: 84
    }[companion.libidoBaseline] ?? 45;
    const spontaneous = {
        spontaneous: 1.25, responsive: 0.45, mixed: 0.85
    }[companion.desirePattern] ?? 0.85;
    const responsive = {
        spontaneous: 0.65, responsive: 1.3, mixed: 1
    }[companion.desirePattern] ?? 1;
    const confidence = {
        inhibited: 0.42, cautious: 0.7, natural: 1, direct: 1.25
    }[companion.sexualConfidence] ?? 1;
    const risk = {
        low: 0.48, moderate: 1, high: 1.45
    }[companion.sexualRiskAppetite] ?? 1;
    return { baseline, spontaneous, responsive, confidence, risk };
}

function companionSexualContext(companion, nowMs = Date.now()) {
    const situation = companionSituationAt(companion, nowMs);
    const place = (companion.lifeProfile?.places || []).find(item=>item.id===situation.placeId);
    const withPeople = Array.isArray(situation.withNames) && situation.withNames.length > 0;
    const available = situation.availability === 'available' && situation.source !== 'travel';
    // Location names are identifiers, not evidence that an intimate event occurred.
    const privatePlace = place?.kind === 'home' || ['bedroom','bathroom'].includes(place?.referenceRole);
    const privateOpportunity = !withPeople && available && privatePlace;
    const activity = String(situation.activity || '').toLowerCase();
    const intimateContext = available && /\b(?:flirting|kissing|making out|intimacy)\b/.test(activity)
        && !/\b(?:not|no|avoid|avoiding|discuss|discussing|class|lecture|workshop)\b/.test(activity);
    return { situation, privateOpportunity, intimateContext, withPeople };
}

function companionAlcoholContext(companion, nowMs = Date.now()) {
    if (companion.alcoholPattern === 'none') return false;
    const situation = companionSituationAt(companion, nowMs);
    const text = [situation.activity, situation.label, situation.placeLabel].join(' ').toLowerCase();
    return /\b(?:drink|drinks|drinking|bar|pub|club|party|cocktail|wine|beer|liquor|booze|happy hour|wedding reception)\b/.test(text);
}

function advanceCompanionHumanDynamics(companion, nowMs = Date.now()) {
    if(companion.__vh2View)return companion.humanDynamics;
    companion.humanDynamics = normalizeCompanionHumanDynamics(companion.humanDynamics, nowMs);
    const quantum = 5 * 60 * 1000;
    // Match online ticks during catch-up rather than applying the final
    // activity to the entire absence. Retain the existing 72-hour work bound.
    if (nowMs - companion.humanDynamics.lastUpdated > 72 * 60 * 60 * 1000) {
        companion.humanDynamics.lastUpdated = nowMs - 72 * 60 * 60 * 1000;
    }
    while (companion.humanDynamics.lastUpdated + quantum <= nowMs) {
        advanceCompanionHumanDynamicsStep(companion, companion.humanDynamics.lastUpdated + quantum);
    }
    return companion.humanDynamics;
}

function advanceCompanionHumanDynamicsStep(companion, nowMs) {
    companion.humanDynamics = normalizeCompanionHumanDynamics(companion.humanDynamics, nowMs);
    const dynamics = companion.humanDynamics;
    const elapsedMs = Math.max(0, nowMs - dynamics.lastUpdated);
    if (elapsedMs < 5 * 60 * 1000) return dynamics;
    const hours = Math.min(72, elapsedMs / (60 * 60 * 1000));
    if(companion.lifeProfile?.initializedAt&&companion.lifeProfile.sleepPolicy?.enabled!==false){
        const local=companionLocalMinuteInfo(companion,nowMs),[bedHour,wakeHour]=COMPANION_SLEEP_HOURS[companion.sleepArchetype]||COMPANION_SLEEP_HOURS.normal;
        const base=companionBaseSituationAt(companion,nowMs,true,true);
        const active=companion.lifeRuntime?.activities?.goals?.find(g=>g.status==='active');
        const recent=Number(companion.continuityRuntime?.lastExchangeAt)||0;
        const engaged=recent>0&&nowMs-recent<3*60000||(companion.lifeRuntime?.activities?.conversationUntil||0)>nowMs;
        const place=companion.lifeProfile.places.find(p=>p.id===base.placeId);
        const restingPlace=place?.kind==='home'||['bedroom'].includes(place?.referenceRole)||(!base.placeId&&['home','relaxing'].includes(base.activity));
        const preferred=isCompanionAsleep(companion.sleepArchetype,local.hour);
        const previousSleepStage=dynamics.sleep?.stage;
        dynamics.sleep=VHActivityEngine.advanceSleep(dynamics.sleep,nowMs,{policy:companion.lifeProfile.sleepPolicy,energy:dynamics.energy,stress:dynamics.stress,hunger:dynamics.hunger,preferred,engaged,hoursUntilBed:(bedHour-local.hour-local.minute/60+24)%24,hoursSinceWake:(local.hour+local.minute/60-wakeHour+24)%24,hoursIntoSleep:(local.hour+local.minute/60-bedHour+24)%24,wasAsleep:preferred&&restingPlace&&!engaged&&base.availability==='available'&&!base.withNames?.length&&!companion.lifeRuntime?.world?.journey&&!active,
            canRest:restingPlace&&base.availability==='available'&&!base.withNames?.length&&!companion.lifeRuntime?.world?.journey,
            occupied:!!active&&!['recovery','leisure'].includes(active.kind),boring:active?.kind==='leisure'&&!engaged});
        if(previousSleepStage&&previousSleepStage!==dynamics.sleep.stage&&['winding_down','asleep','waking'].includes(dynamics.sleep.stage))companionRecordContinuityEvent(companion,{type:'life_event',summary:({winding_down:'Started winding down because of tiredness.',asleep:'Fell asleep.',waking:'Woke up; still groggy.'})[dynamics.sleep.stage],createdAt:nowMs,perceivedAt:nowMs,dedupeKey:`sleep:${nowMs}:${dynamics.sleep.stage}`});
    }
    if(companion.lifeProfile?.sleepPolicy?.enabled===false)dynamics.sleep=null;
    const life = companionLifeState(companion, dynamics.lastUpdated);
    const asleep = life.availability === 'asleep';
    const effects = VHActivityEngine.effects(life.situation?.effects, life.availability,
        !!life.situation?.withNames?.length);
    const { recovery } = companionRegulationFactors(companion);

    if (!companionSexualSystemActive(companion)) {
        dynamics.desire = 0;
        dynamics.sexualArousal = 0;
        dynamics.sexualFrustration = 0;
        dynamics.postIntimacyCalm = 0;
        dynamics.sexualCooldownUntil = 0;
        dynamics.intimacyAftereffect = 'none';
        dynamics.intimacyAftereffectUntil = 0;
    }

    dynamics.energy = livingClamp(dynamics.energy + effects.energyPerHour * hours, 0, 100);
    const stressTarget = effects.stressTarget;
    const stressRetained = Math.pow(0.5, hours / (asleep ? 2.5 : 8));
    dynamics.stress = livingClamp(stressTarget + (dynamics.stress - stressTarget) * stressRetained, 0, 100);
    dynamics.socialNeed = livingClamp(dynamics.socialNeed + effects.socialPerHour * hours, 0, 100);

    dynamics.hunger = livingClamp(dynamics.hunger + effects.hungerPerHour * hours, 0, 100);
    const angerHalfLife = 2.5 * recovery;
    dynamics.anger = livingClamp(dynamics.anger * Math.pow(0.5, hours / angerHalfLife), 0, 100);
    if (companionAlcoholContext(companion, nowMs)) {
        const intakeRate = { rare: 5, social: 11, frequent: 16 }[companion.alcoholPattern] || 0;
        dynamics.intoxication = livingClamp(dynamics.intoxication + intakeRate * hours, 0, 100);
    } else {
        dynamics.intoxication = livingClamp(dynamics.intoxication * Math.pow(0.5, hours / 1.7), 0, 100);
    }
    const inhibitionTarget = livingClamp(74 - dynamics.intoxication * 0.68 - dynamics.stress * 0.12, 8, 82);
    dynamics.inhibition = livingClamp(inhibitionTarget + (dynamics.inhibition - inhibitionTarget) * Math.pow(0.5, hours / 1.2), 0, 100);
    if (companionSexualSystemActive(companion)) {
        const factors = companionSexualFactors(companion);
        const local = companionLocalDateInfo(companion, nowMs);
        const context = companionSexualContext(companion, nowMs);
        const pulseRoll = companionSeededRoll(`${companion.id}|desire-pulse|${local.dateKey}`);
        const pulseHour = 6 + Math.floor(pulseRoll * 17);
        const pulseActive = Math.abs(local.hour - pulseHour) <= 1;
        const circadianLift = local.hour >= 21 || local.hour <= 1 ? 5 : local.hour >= 6 && local.hour <= 9 ? 3 : 0;
        const spontaneousLift = pulseActive ? 12 * factors.spontaneous : 0;
        const desireTarget = livingClamp(factors.baseline + circadianLift + spontaneousLift
            - dynamics.stress * 0.18 - Math.max(0, 30 - dynamics.energy) * 0.35
            - dynamics.postIntimacyCalm * 0.52, 0, 100);
        const desireRetained = Math.pow(0.5, hours / 8);
        dynamics.desire = livingClamp(desireTarget + (dynamics.desire - desireTarget) * desireRetained, 0, 100);

        // Momentary sexual arousal falls quickly unless a concrete intimate
        // context is established. Generic friendliness or trust cannot raise it.
        const arousalTarget = context.intimateContext
            ? livingClamp(dynamics.desire * factors.responsive + 12, 0, 100)
            : pulseActive && companion.desirePattern !== 'responsive'
                ? livingClamp(dynamics.desire * 0.42, 0, 48) : 0;
        const arousalRetained = Math.pow(0.5, hours / 0.8);
        dynamics.sexualArousal = livingClamp(arousalTarget
            + (dynamics.sexualArousal - arousalTarget) * arousalRetained, 0, 100);
        const frustrationRate = dynamics.desire >= 62 && dynamics.postIntimacyCalm < 20 ? 0.7 : -1.4;
        dynamics.sexualFrustration = livingClamp(dynamics.sexualFrustration + frustrationRate * hours, 0, 100);
        dynamics.postIntimacyCalm = livingClamp(dynamics.postIntimacyCalm * Math.pow(0.5, hours / 5), 0, 100);
        // Private self-regulation can resolve sustained pressure without an API
        // call, another person, or a fabricated relationship event. It remains
        // internal unless the person later chooses to disclose it.
        const privateRegulationRoll = companionSeededRoll(`${companion.id}|private-regulation|${local.dateKey}`);
        const enoughTimeSinceIntimacy = !dynamics.lastIntimacyAt
            || nowMs - dynamics.lastIntimacyAt >= 18 * 60 * 60 * 1000;
        const privateRegulationChance = livingClamp(0.06 + factors.baseline / 360, 0.06, 0.32);
        if (context.privateOpportunity && pulseActive && enoughTimeSinceIntimacy
            && (dynamics.sexualArousal >= 58 || dynamics.desire >= 78)
            && privateRegulationRoll < privateRegulationChance) {
            dynamics.postIntimacyCalm = livingClamp(dynamics.postIntimacyCalm + 58, 0, 100);
            dynamics.sexualArousal = livingClamp(dynamics.sexualArousal - 62, 0, 100);
            dynamics.desire = livingClamp(dynamics.desire - 28, 0, 100);
            dynamics.sexualFrustration = livingClamp(dynamics.sexualFrustration - 52, 0, 100);
            dynamics.sexualCooldownUntil = nowMs + 45 * 60 * 1000;
            dynamics.intimacyAftereffect = 'satisfied';
            dynamics.intimacyAftereffectUntil = nowMs + 3 * 60 * 60 * 1000;
            dynamics.lastIntimacyAt = nowMs;
        }
        if (dynamics.sexualCooldownUntil && nowMs >= dynamics.sexualCooldownUntil) dynamics.sexualCooldownUntil = 0;
        if (dynamics.intimacyAftereffectUntil && nowMs >= dynamics.intimacyAftereffectUntil) {
            dynamics.intimacyAftereffect = 'none';
            dynamics.intimacyAftereffectUntil = 0;
        }
    }
    if (dynamics.cooldownUntil && nowMs >= dynamics.cooldownUntil && dynamics.anger < 48) {
        dynamics.cooldownUntil = 0;
        dynamics.cooldownReason = '';
    }
    dynamics.lastUpdated = nowMs;
    return dynamics;
}

function applyCompanionDynamicsUpdate(companion, update, nowMs = Date.now()) {
    nowMs = Math.max(nowMs, Number(companion.humanDynamics?.lastUpdated) || 0);
    const dynamics = advanceCompanionHumanDynamics(companion, nowMs);
    const input = isPlainObject(update) ? update : {};
    const { sensitivity, recovery } = companionRegulationFactors(companion);
    const deltas = [
        ['energy_change', 'energy', 0.8],
        ['stress_change', 'stress', sensitivity],
        ['social_need_change', 'socialNeed', 1],
        ['anger_change', 'anger', sensitivity],
        ['intoxication_change', 'intoxication', 1]
    ];
    deltas.forEach(([source, target, multiplier]) => {
        if (!Number.isFinite(Number(input[source]))) return;
        const bounded = livingClamp(Number(input[source]), -30, 30) * multiplier;
        dynamics[target] = livingClamp(dynamics[target] + bounded, 0, 100);
    });
    if (companionSexualSystemActive(companion)) {
        const sexualDeltas = [
            ['desire_change', 'desire'],
            ['sexual_arousal_change', 'sexualArousal'],
            ['sexual_frustration_change', 'sexualFrustration']
        ];
        sexualDeltas.forEach(([source, target]) => {
            if (!Number.isFinite(Number(input[source]))) return;
            dynamics[target] = livingClamp(dynamics[target]
                + livingClamp(Number(input[source]), -30, 30), 0, 100);
        });
        const outcome = COMPANION_INTIMACY_AFTEREFFECTS.includes(input.intimacy_outcome)
            ? input.intimacy_outcome : 'none';
        if (outcome !== 'none') {
            dynamics.intimacyAftereffect = outcome;
            dynamics.intimacyAftereffectUntil = nowMs + 6 * 60 * 60 * 1000;
            if (outcome === 'satisfied') {
                dynamics.postIntimacyCalm = livingClamp(dynamics.postIntimacyCalm + 70, 0, 100);
                dynamics.sexualArousal = livingClamp(dynamics.sexualArousal - 65, 0, 100);
                dynamics.desire = livingClamp(dynamics.desire - 35, 0, 100);
                dynamics.sexualFrustration = livingClamp(dynamics.sexualFrustration - 70, 0, 100);
                dynamics.lastIntimacyAt = nowMs;
            } else if (['rejected', 'frustrated'].includes(outcome)) {
                dynamics.sexualFrustration = livingClamp(dynamics.sexualFrustration + 18, 0, 100);
            }
        }
        const sexualCooldownMinutes = livingClamp(Math.round(Number(input.sexual_cooldown_minutes) || 0), 0, 24 * 60);
        if (sexualCooldownMinutes > 0) {
            dynamics.sexualCooldownUntil = Math.max(dynamics.sexualCooldownUntil || 0,
                nowMs + sexualCooldownMinutes * 60 * 1000);
        }
    }
    const explicitCoolOff = livingClamp(Math.round(Number(input.cool_off_minutes) || 0), 0, 24 * 60);
    if (explicitCoolOff > 0 || (Number(input.anger_change) > 0 && dynamics.anger >= 58)) {
        const inferredMinutes = Math.round((25 + dynamics.anger * 2.2) * recovery);
        const duration = Math.max(explicitCoolOff, inferredMinutes);
        dynamics.cooldownUntil = Math.max(dynamics.cooldownUntil || 0, nowMs + duration * 60 * 1000);
        dynamics.cooldownReason = String(input.cooldown_reason || 'they need time to regulate before continuing').trim().slice(0, 240);
    }
    const inhibitionTarget = livingClamp(74 - dynamics.intoxication * 0.68 - dynamics.stress * 0.12, 8, 82);
    dynamics.inhibition = livingClamp(Math.round((dynamics.inhibition + inhibitionTarget) / 2), 0, 100);
    dynamics.lastUpdated = nowMs;
    return dynamics;
}

function isCompanionAsleep(sleepArchetype, hour) {
    const [start, end] = COMPANION_SLEEP_HOURS[sleepArchetype] || COMPANION_SLEEP_HOURS.normal;
    return start > end ? (hour >= start || hour < end) : (hour >= start && hour < end);
}

function companionUsesFixedTimezoneOffset(companion) {
    return companion?.locationMode === 'custom'
        && Number.isFinite(Number(companion.timezoneOffsetMinutes));
}

function companionFixedOffsetDate(companion, atMs) {
    return new Date(atMs + Number(companion?.timezoneOffsetMinutes || 0) * 60 * 1000);
}

function companionClockProfileAt(companion,atMs){
    const change=companion?.vh2Travel?.clockHistory?.filter(x=>x.at<=atMs).at(-1);
    return change?.timeZone?{...companion,locationMode:'timezone',timezone:change.timeZone}:companion;
}
function companionLocalDateInfo(companion, atMs) {
    companion=companionClockProfileAt(companion,atMs);
    if (companionUsesFixedTimezoneOffset(companion)) {
        const date = companionFixedOffsetDate(companion, atMs);
        return {
            hour: date.getUTCHours(),
            weekday: date.getUTCDay(),
            dateKey: date.toISOString().slice(0, 10)
        };
    }
    const timezone = String(companion?.timezone || '').trim();
    try {
        const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
            timeZone: timezone || undefined,
            year: 'numeric', month: '2-digit', day: '2-digit',
            weekday: 'short', hour: '2-digit', hourCycle: 'h23'
        }).formatToParts(new Date(atMs)).filter(part => part.type !== 'literal')
            .map(part => [part.type, part.value]));
        const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        return {
            hour: parseInt(parts.hour) || 0,
            weekday: weekdays.indexOf(parts.weekday),
            dateKey: `${parts.year}-${parts.month}-${parts.day}`
        };
    } catch (error) {
        const date = new Date(atMs);
        return { hour: date.getHours(), weekday: date.getDay(), dateKey: date.toDateString() };
    }
}

function companionLocalMinuteInfo(companion, atMs) {
    companion=companionClockProfileAt(companion,atMs);
    if (companionUsesFixedTimezoneOffset(companion)) {
        const date = companionFixedOffsetDate(companion, atMs);
        return {
            hour: date.getUTCHours(),
            minute: date.getUTCMinutes(),
            weekday: date.getUTCDay(),
            dateKey: date.toISOString().slice(0, 10)
        };
    }
    const timezone = String(companion?.timezone || '').trim();
    try {
        const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
            timeZone: timezone || undefined,
            year: 'numeric', month: '2-digit', day: '2-digit',
            weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
        }).formatToParts(new Date(atMs)).filter(part => part.type !== 'literal')
            .map(part => [part.type, part.value]));
        const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        return {
            hour: parseInt(parts.hour) || 0,
            minute: parseInt(parts.minute) || 0,
            weekday: weekdays.indexOf(parts.weekday),
            dateKey: `${parts.year}-${parts.month}-${parts.day}`
        };
    } catch (error) {
        const date = new Date(atMs);
        return {
            hour: date.getHours(), minute: date.getMinutes(),
            weekday: date.getDay(), dateKey: date.toISOString().slice(0, 10)
        };
    }
}

function companionDefaultWorkweek(countryCode) {
    const code = String(countryCode || '').toUpperCase();
    if (['AF', 'DZ', 'BH', 'EG', 'IQ', 'IR', 'IL', 'JO', 'KW', 'LY', 'OM', 'QA', 'SA', 'SD', 'SY', 'YE'].includes(code)) {
        return [0, 1, 2, 3, 4];
    }
    if (code === 'BN') return [1, 2, 3, 4, 6];
    return [1, 2, 3, 4, 5];
}

function buildProceduralCompanionLifeProfile(companion, atMs = Date.now()) {
    const id = companion.id || companion.name || 'person';
    const authored = `${companion.occupation || ''} ${companion.routine || ''} ${companion.habits || ''}`.toLowerCase();
    const student = /\b(student|university|college|school|classes|studying)\b/.test(authored);
    const remote = /\b(remote|works? from home|freelance)\b/.test(authored);
    const active = /\b(gym|run|running|training|fitness|climb|swim|yoga|sport)\b/.test(authored);
    const social = /\b(friend|friends|social|band|club|team|family)\b/.test(authored);
    const workweekDays = companionDefaultWorkweek(companion.locationCountryCode);
    const weekendDays = [0, 1, 2, 3, 4, 5, 6].filter(day => !workweekDays.includes(day));
    const places = [
        { id: 'home', label: companion.locationLabel ? `home in ${companion.locationLabel}` : 'home', kind: 'home', detail: 'their ordinary private living space', travelMinutesFromHome: 0 },
        { id: student ? 'campus' : 'work', label: remote ? 'home workspace' : student ? 'campus' : 'workplace', kind: student ? 'study' : 'work', detail: companion.occupation || 'their main weekday obligation', travelMinutesFromHome: remote ? 0 : 25 },
        { id: 'local_social', label: 'a familiar local spot', kind: 'social', detail: 'somewhere they return to often enough to have preferences', travelMinutesFromHome: 15 }
    ];
    if (active) places.push({ id: 'active_place', label: 'their usual exercise spot', kind: 'outdoor', detail: 'a regular place for exercise', travelMinutesFromHome: 15 });
    const wardrobe = [
        { id: 'home_look', label: 'ordinary home clothes', context: 'home', items: 'comfortable, repeatedly worn home clothes that fit their authored appearance', notes: 'practical rather than styled for the camera' },
        { id: 'work_look', label: 'weekday work look', context: 'work', items: 'a credible work or study outfit consistent with their occupation, means and fashion sense', notes: 'changes through small combinations rather than becoming a costume' },
        { id: 'social_look', label: 'going-out look', context: 'social', items: 'a slightly more intentional casual outfit using clothes they realistically own', notes: 'still recognizably their taste' },
        { id: 'sleep_look', label: 'sleepwear', context: 'sleep', items: 'ordinary sleepwear', notes: '' }
    ];
    const weeklySchedule = [];
    workweekDays.forEach(day => {
        weeklySchedule.push(
            { days: [day], startMinute: 420, endMinute: 510, activity: 'waking up, getting ready and having a normal morning', placeId: 'home', availability: 'private', flexibility: 'soft', outfitContext: 'home' },
            { days: [day], startMinute: 540, endMinute: 1020, activity: student ? 'classes, study and campus obligations' : remote ? 'working from home' : 'working', placeId: student ? 'campus' : 'work', availability: 'busy', flexibility: 'fixed', outfitContext: 'work' },
            { days: [day], startMinute: 1020, endMinute: 1140, activity: active && companionSeededRoll(`${id}|active|${day}`) > 0.45 ? 'exercising after the day’s main obligations' : 'commuting, errands and decompressing', placeId: active ? 'active_place' : 'local_social', availability: 'busy', flexibility: 'soft', outfitContext: active ? 'active' : 'home' },
            { days: [day], startMinute: 1140, endMinute: 1380, activity: social && companionSeededRoll(`${id}|social|${day}`) > 0.6 ? 'spending the evening with people they know' : 'having an ordinary evening at home', placeId: social ? 'local_social' : 'home', availability: 'available', flexibility: 'optional', outfitContext: social ? 'social' : 'home' }
        );
    });
    weekendDays.forEach(day => weeklySchedule.push(
        { days: [day], startMinute: 540, endMinute: 720, activity: 'a slower morning and personal chores', placeId: 'home', availability: 'available', flexibility: 'soft', outfitContext: 'home' },
        { days: [day], startMinute: 720, endMinute: 1080, activity: active ? 'exercise, errands and unstructured personal time' : 'errands and unstructured personal time', placeId: active ? 'active_place' : 'local_social', availability: 'busy', flexibility: 'soft', outfitContext: active ? 'active' : 'home' },
        { days: [day], startMinute: 1080, endMinute: 1380, activity: social ? 'seeing friends or family' : 'a quiet evening at home', placeId: social ? 'local_social' : 'home', availability: 'available', flexibility: 'optional', outfitContext: social ? 'social' : 'home' }
    ));
    weeklySchedule.forEach(block => { block.id = `routine_${block.days.join('_')}_${block.startMinute}`; });
    return normalizeCompanionLifeProfile({
        initializedAt: atMs,
        seed: `${id}|${atMs}`,
        fashionSense: 'A practical, repeatable personal style derived from their appearance, occupation, finances, habits and social confidence.',
        grooming: 'A consistent everyday grooming routine with realistic variation when rushed, tired or going out.',
        foodHabits: 'Ordinary meals, repeated favorites and convenience choices shaped by schedule and budget.',
        mediaHabits: 'A small set of recurring music, video, reading or scrolling habits rather than constant trend awareness.',
        moneyPattern: 'Spending choices remain consistent with their occupation, obligations and stated values.',
        healthRoutine: active ? 'Exercise is part of their week but can be skipped when tired, busy or emotionally depleted.' : 'Health maintenance is ordinary and inconsistent rather than optimized.',
        digitalLife: 'Phone use varies with work, company, mood and privacy; being online does not mean being available.',
        seasonalVariation: 'Clothing, daylight, transport and leisure adapt to local conditions when real weather is available.',
        workweekDays, places, socialCircle: [], wardrobe, weeklySchedule
    });
}

function companionScheduleBlockAt(companion, atMs) {
    const life = companion.lifeProfile?.initializedAt
        ? companion.lifeProfile : buildProceduralCompanionLifeProfile(companion, companion.createdAt || atMs);
    const local = companionLocalMinuteInfo(companion, atMs);
    const minute = local.hour * 60 + local.minute;
    const candidates = (globalThis.VH2Geography?.schedule(companion)||life.weeklySchedule).filter(block => VHWorldEngine.activeOn(block,local.dateKey) && block.days.includes(local.weekday)
        && (block.endMinute > block.startMinute
            ? minute >= block.startMinute && minute < block.endMinute
            : minute >= block.startMinute || minute < block.endMinute));
    if (!candidates.length) return null;
    return candidates.sort((a, b) => {
        const flexibility = { fixed: 3, soft: 2, optional: 1 };
        return (flexibility[b.flexibility] || 0) - (flexibility[a.flexibility] || 0)
            || a.startMinute - b.startMinute;
    })[0];
}

function companionSituationAt(companion, atMs) {
    const situation = companionBaseSituationAt(companion, atMs);
    if(companion.lifeRuntime?.world?.outfit?.label&&situation.availability!=='asleep')situation.outfit=companion.lifeRuntime.world.outfit.label;
    const activities = companion.lifeRuntime?.activities;
    const active = activities?.goals?.find(goal => goal.status === 'active');
    // A current activity is evidence only near its last simulated time, never
    // a replacement for historical schedule samples during catch-up.
    if (active && situation.source!=='sleep_transition' && situation.availability === 'available' && atMs >= activities.lastAdvancedAt
        && atMs < activities.lastAdvancedAt + 60000) {
        const step = active.steps[active.stepIndex];
        if (step) return { ...situation, source: 'activity', activity: step.label, label: step.label,
            availability: 'busy', startedAt: activities.lastAdvancedAt - step.progressMs,
            endsAt: activities.lastAdvancedAt + step.durationMs - step.progressMs };
    }
    return situation;
}

// Explicit directional legs reserve travel after the previous commitment, including
// lateness when the gap is too short. No network access or randomness in this kernel.
function companionScheduledJourneyAt(companion, atMs) {
    const life = companion.lifeProfile;
    if (!life?.travelLegs?.length) return null;
    const local = companionLocalMinuteInfo(companion, atMs);
    const minute = local.hour * 60 + local.minute;
    const blocks = (globalThis.VH2Geography?.schedule(companion)||life.weeklySchedule).filter(b => VHWorldEngine.activeOn(b,local.dateKey) && b.days.includes(local.weekday)).sort((a,b) => a.startMinute-b.startMinute);
    let previousArrival = 0;
    for (let i=1; i<blocks.length; i++) {
        const previous=blocks[i-1], next=blocks[i];
        const leg=life.travelLegs.find(l => l.from===previous.placeId && l.to===next.placeId);
        if (!leg || previous.endMinute>next.startMinute) continue;
        const start=Math.max(previous.endMinute,previousArrival,next.startMinute-leg.minutes), end=start+leg.minutes;
        previousArrival=end;
        if (minute<start || minute>=end) continue;
        const from=life.places.find(p=>p.id===leg.from), to=life.places.find(p=>p.id===leg.to);
        if (!from || !to) continue;
        return {source:'travel',activity:`Travelling by ${leg.mode.toLowerCase()} to ${to.label}`,label:`Travelling to ${to.label}`,
            availability:'busy',placeId:'',placeLabel:`Between ${from.label} and ${to.label}`,withNames:[],
            startedAt:atMs-(minute-start)*60000,endsAt:atMs+(end-minute)*60000,
            lateMinutes:Math.max(0,end-next.startMinute),outfit:companion.currentOutfit || '',environment:companion.lifeRuntime?.environment || null};
    }
    return null;
}

function companionBaseSituationAt(companion, atMs, skipWorld = false, skipSleep = false, skipBreak = false) {
    const spatial = !skipWorld && VHWorldEngine.situation(companion, atMs);
    if (spatial) return spatial;
    const local = companionLocalMinuteInfo(companion, atMs);
    const temporary = companion.lifeRuntime?.temporarySituation;
    if (temporary?.startedAt <= atMs && temporary?.endsAt > atMs) {
        return {
            source: 'temporary', activity: temporary.activity || 'dealing with a change of plans',
            label: temporary.activity || 'dealing with a change of plans',
            availability: temporary.availability, placeId: '',
            placeLabel: temporary.placeLabel || companion.currentLocationDetail || companion.locationLabel,
            withNames: temporary.withNames || [], startedAt: temporary.startedAt, endsAt: temporary.endsAt,
            outfit: temporary.outfit || companion.currentOutfit || '',
            environment: companion.lifeRuntime?.environment || null
        };
    }
    const sleep=companion.lifeProfile?.sleepPolicy?.enabled!==false&&companion.humanDynamics?.sleep;
    if(!skipSleep&&sleep&&atMs>=sleep.lastAt-5*60000){
        if(sleep.stage==='asleep'||sleep.stage==='winding_down'){
            const home=companion.lifeProfile.places.find(p=>p.kind==='home');
            return {source:'sleep_transition',activity:sleep.stage==='asleep'?'asleep':'winding down for sleep',label:sleep.stage==='asleep'?'asleep':'winding down for sleep',availability:sleep.stage==='asleep'?'asleep':'available',placeId:companion.lifeRuntime?.world?.placeId||home?.id||'',placeLabel:companion.lifeProfile.places.find(p=>p.id===companion.lifeRuntime?.world?.placeId)?.label||home?.label||companion.currentLocationDetail||'',withNames:[],startedAt:sleep.stage==='asleep'?sleep.sleepStartedAt:sleep.windDownAt,endsAt:sleep.stage==='asleep'?companionNextWakeAt(companion,atMs):sleep.windDownAt+(companion.lifeProfile.sleepPolicy?.windDownMinutes||10)*60000,outfit:companion.currentOutfit||'',environment:companion.lifeRuntime?.environment||null};
        }
    }
    if (!skipSleep && !sleep && isCompanionAsleep(companion.sleepArchetype, local.hour)) {
        const look = companion.lifeProfile?.wardrobe?.find(item => item.context === 'sleep');
        return {
            source: 'sleep', activity: 'asleep', label: 'asleep', availability: 'asleep',
            placeId: (!skipWorld&&companion.lifeProfile?.world?.transport.enabled&&companion.lifeRuntime?.world?.placeId)||'home', placeLabel: (!skipWorld&&companion.lifeProfile?.world?.transport.enabled&&companion.lifeProfile.places.find(p=>p.id===companion.lifeRuntime?.world?.placeId)?.label)||companion.locationLabel || 'home',
            withNames: [], startedAt: 0, endsAt: companionNextWakeAt(companion, atMs),
            outfit: look?.items || companion.currentOutfit || 'ordinary sleepwear',
            environment: companion.lifeRuntime?.environment || null
        };
    }
    if (!companion.lifeProfile?.initializedAt) {
        const fallback = companionLifeStateLegacy(companion, atMs, skipSleep || !!sleep);
        return {
            source: 'fallback', activity: fallback.activity, label: fallback.label,
            availability: fallback.availability, placeId: '',
            placeLabel: companion.currentLocationDetail || companion.locationLabel,
            withNames: [], startedAt: 0, endsAt: 0,
            outfit: companion.currentOutfit || '',
            environment: companion.lifeRuntime?.environment || null
        };
    }
    const journey = !companion.lifeProfile?.world?.transport?.enabled && companionScheduledJourneyAt(companion, atMs);
    if (journey) return journey;
    const trip=globalThis.VH2Travel?.active(companion);
    if(trip && ['staying','blocked','waiting'].includes(trip.status)){
        const place=companion.lifeProfile.places.find(p=>p.id===companion.lifeRuntime.world.placeId);
        return {source:'trip_stay',activity:'free time during '+trip.label,label:'Free time at '+(place?.label||'current place'),availability:'available',placeId:place?.id||'',placeLabel:place?.label||'',withNames:[],outfit:companion.currentOutfit||'',environment:companion.lifeRuntime.environment||null};
    }
    const block = companionScheduleBlockAt(companion, atMs);
    if (!block) {
        if(companion.lifeProfile?.initializedAt){
            const place=companion.lifeProfile.places.find(p=>p.id===companion.lifeRuntime?.world?.placeId)||companion.lifeProfile.places.find(p=>p.kind==='home');
            return {source:'free',activity:'free time',label:'Free time at '+(place?.label||'the current location'),availability:'available',placeId:place?.id||'',placeLabel:place?.label||companion.currentLocationDetail||companion.locationLabel,withNames:[],startedAt:0,endsAt:0,outfit:companion.currentOutfit||'',environment:companion.lifeRuntime?.environment||null};
        }
        const spatialRuntime=companion.lifeRuntime?.world;
        const actual=!skipWorld&&companion.lifeProfile?.world?.transport.enabled&&spatialRuntime?.lastAt&&atMs>=spatialRuntime.lastAt&&atMs<spatialRuntime.lastAt+60000&&companion.lifeProfile.places.find(p=>p.id===spatialRuntime.placeId);
        if(actual)return {source:'spatial',activity:`Free time at ${actual.label}`,label:'Free time',availability:'available',placeId:actual.id,placeLabel:actual.label,withNames:[],startedAt:spatialRuntime.lastAt,endsAt:0,outfit:spatialRuntime.outfit?.label||companion.currentOutfit||'',environment:companion.lifeRuntime.environment};
        const fallback = companionLifeStateLegacy(companion, atMs, skipSleep || !!sleep);
        return {
            source: 'fallback', activity: fallback.activity, label: fallback.label,
            availability: fallback.availability, placeId: '', placeLabel: companion.currentLocationDetail || companion.locationLabel,
            withNames: [], startedAt: 0, endsAt: 0, outfit: companion.currentOutfit || '',
            environment: companion.lifeRuntime?.environment || null
        };
    }
    const life = companion.lifeProfile;
    const place = life.places.find(item => item.id === block.placeId);
    const world = companion.lifeRuntime?.world;
    if (!skipWorld && life.world?.transport.enabled && world?.lastAt && atMs >= world.lastAt && atMs < world.lastAt + 60000 && world.placeId && world.placeId !== block.placeId) {
        const actual = life.places.find(p=>p.id===world.placeId);
        return {source:'spatial',activity:`At ${actual?.label || world.placeId}; unable to attend ${block.activity} yet`,label:'Away from scheduled commitment',availability:'available',placeId:world.placeId,placeLabel:actual?.label || world.placeId,withNames:[],startedAt:world.lastAt,endsAt:0,outfit:world.outfit?.label || companion.currentOutfit || '',environment:companion.lifeRuntime.environment};
    }
    const activeBreak=companion.lifeRuntime?.activities?.break;
    if(!skipBreak&&activeBreak?.goalId&&atMs>=activeBreak.startedAt&&atMs<activeBreak.endsAt&&activeBreak.blockKey===`${Math.floor(atMs/60000)-((local.hour*60+local.minute-block.startMinute+1440)%1440)}:${block.id}`){
        const goal=companion.lifeRuntime.activities.goals.find(g=>g.id===activeBreak.goalId);
        return {source:'break',activity:goal?.label||'Taking a break',label:goal?.label||'Taking a break',availability:'available',placeId:block.placeId,placeLabel:place?.label||block.placeLabel,withNames:[],startedAt:activeBreak.startedAt,endsAt:activeBreak.endsAt,outfit:companion.currentOutfit||'',environment:companion.lifeRuntime.environment};
    }
    const people = block.withIds.map(id => life.socialCircle.find(person => person.id === id)?.name).filter(Boolean);
    const looks = life.wardrobe.filter(item => item.context === block.outfitContext);
    const look = looks.length ? looks[Math.floor(companionSeededRoll(`${companion.id}|outfit|${local.dateKey}|${block.id}`) * looks.length)] : null;
    const elapsedMinutes = Math.max(0, (block.endMinute - (local.hour * 60 + local.minute)));
    return {
        source: 'schedule', blockId:block.id, breakAllowed:block.breakAllowed, activity: block.activity, label: block.activity, effects: block.effects,
        availability: block.availability, placeId: block.placeId,
        placeLabel: place?.label || block.placeLabel || companion.locationLabel,
        withNames: people, startedAt: Math.floor(atMs/60000)*60000 - ((local.hour*60+local.minute-block.startMinute+1440)%1440)*60000,
        endsAt: atMs + elapsedMinutes * 60000,
        outfit: (!skipWorld && companion.lifeRuntime?.world?.outfit?.label) || look?.items || companion.currentOutfit || '',
        outfitContext: block.outfitContext,
        environment: companion.lifeRuntime?.environment || null
    };
}

function companionActivityPool(companion, local) {
    if (local && typeof local.getHours === 'function' && typeof local.getDay === 'function') {
        local = { hour: local.getHours(), weekday: local.getDay(), dateKey: local.toDateString() };
    }
    const hour = local.hour;
    const weekday = local.weekday >= 1 && local.weekday <= 5;
    const isDaytime = hour >= 9 && hour < 18;
    const isEvening = hour >= 18 && hour < 23;
    let pool = isDaytime
        ? (weekday
            ? ['work', 'work', 'errands', 'gym', 'studying', 'commuting']
            : ['home', 'errands', 'gym', 'out_friends', 'relaxing'])
        : isEvening
            ? ['home', 'out_friends', 'gym', 'relaxing', 'relaxing']
            : ['home', 'relaxing'];
    const authoredLife = `${companion.occupation || ''} ${companion.routine || ''}`.toLowerCase();
    if (/\b(student|studying|study|class|classes|university|college|school)\b/.test(authoredLife)) {
        pool.push('studying', 'studying');
    }
    if (/\b(gym|workout|training|run|running|fitness)\b/.test(authoredLife)) {
        pool.push('gym');
    }
    if (/\b(friend|friends|social|band|club|team)\b/.test(authoredLife) && isEvening) {
        pool.push('out_friends');
    }
    if (/\b(remote|works? from home|freelance)\b/.test(authoredLife) && isDaytime) {
        pool = pool.map(activity => activity === 'commuting' ? 'home' : activity);
        pool.push('home');
    }
    return pool;
}

function companionLifeStateLegacy(companion, atMs, skipSleep = false) {
    const local = companionLocalDateInfo(companion, atMs);
    const hour = local.hour;
    if (!skipSleep && isCompanionAsleep(companion.sleepArchetype, hour)) {
        return { activity: 'asleep', label: 'asleep', availability: 'asleep' };
    }
    // A weighted, deterministic pick from the day-part plus their authored
    // occupation/routine. Weekends no longer look like generic workdays.
    const pool = companionActivityPool(companion, local);
    const seed = `${companion.id}|life|${local.dateKey}|${hour}`;
    const pick = pool[Math.floor(companionSeededRoll(seed) * pool.length)];
    const activity = COMPANION_ACTIVITIES.find(a => a.id === pick) || COMPANION_ACTIVITIES[0];
    return { activity: activity.id, label: activity.label, availability: activity.busy ? 'busy' : 'available' };
}

function companionLifeState(companion, atMs) {
    if(companion.__vh2View&&companion.__vh2Present){const p=companion.__vh2Present;return {...p,label:p.activity,situation:{...p,label:p.activity,source:'vh2'}};}
    const situation = companionSituationAt(companion, atMs);
    return {
        activity: situation.activity,
        label: situation.label,
        availability: situation.availability === 'private' ? 'busy' : situation.availability,
        situation
    };
}

function companionNextWakeAt(companion, atMs) {
    const sleep=companion.humanDynamics?.sleep;
    if(companion.lifeProfile?.sleepPolicy?.enabled!==false&&sleep?.stage==='asleep')return Math.max(atMs+5*60000,sleep.sleepStartedAt+(sleep.nap ? 0.5 :companion.lifeProfile.sleepPolicy?.sleepNeedHours||8)*3600000);

    const [, wakeHour] = COMPANION_SLEEP_HOURS[companion.sleepArchetype] || COMPANION_SLEEP_HOURS.normal;
    const localHour = companionLocalDateInfo(companion, atMs).hour;
    let hoursUntilWake = wakeHour - localHour;
    if (hoursUntilWake <= 0) hoursUntilWake += 24;
    return atMs + hoursUntilWake * 60 * 60 * 1000;
}

function normalizeCompanionAttention(raw) {
    if (!raw || raw.version !== 1) return null;
    const number = value => Number.isFinite(value) ? Math.max(0, value) : 0;
    return {
        version: 1,
        stage: ['waiting', 'deferred', 'composing', 'ready', 'withheld', 'forgotten', 'answered'].includes(raw.stage) ? raw.stage : 'waiting',
        nextCheckAt: number(raw.nextCheckAt), noticedAt: number(raw.noticedAt),
        composeUntil: number(raw.composeUntil), lastEvaluatedAt: number(raw.lastEvaluatedAt),
        contextKey: String(raw.contextKey || '').slice(0, 800),
        inboxKey: String(raw.inboxKey || '').slice(0, 1000),
        reason: String(raw.reason || '').slice(0, 400),
        trace: (Array.isArray(raw.trace) ? raw.trace : []).slice(-8).map(item => ({
            at: number(item.at), stage: String(item.stage || '').slice(0, 30),
            reason: String(item.reason || '').slice(0, 400)
        }))
    };
}

function companionAttentionContext(companion, nowMs, experience) {
    const dynamics = companion.humanDynamics || {};
    const relationship = companion.relationshipDynamics || {};
    const life = experience.realTimeLife ? companionLifeState(companion, nowMs)
        : { activity: 'available', label: 'available to chat', availability: 'available', situation: {} };
    const situation = life.situation || {};
    const value = (raw, fallback) => Number.isFinite(raw) ? livingClamp(raw, 0, 100) : fallback;
    const energy = value(dynamics.energy, 65);
    const stress = value(dynamics.stress, 20);
    const anger = value(dynamics.anger, 0);
    const warmth = value(relationship.warmth, 35);
    const resentment = value(relationship.resentment, 0);
    const socialNeed = value(dynamics.socialNeed, 45);
    const company = (situation.withNames || []).length;
    const lastReplyAt = Number(companion.continuityRuntime?.lastExchangeAt) || 0;
    const engaged = lastReplyAt > 0 && nowMs >= lastReplyAt && nowMs - lastReplyAt < 3 * 60000;
    const reaction = VHConversationEngine.reactionContext(companion.continuityRuntime?.conversation, nowMs);
    const interest = reaction ? (Number(reaction.engagement) || 0) * Math.max(0, 1 - (nowMs - reaction.createdAt) / (15 * 60000)) : 0;
    // Due promises favor returning to contact. They do not fulfill themselves.
    const promiseDue = (companion.commitments || []).some(item => item.status === 'pending'
        && ['text', 'call', 'message'].includes(item.medium) && item.dueAt > 0 && item.dueAt <= nowMs);
    const sleepPenalty=dynamics.sleep?({awake:0,tired:6,drowsy:18,winding_down:25,asleep:100,waking:14}[dynamics.sleep.stage]||0):0;
    const capacity = livingClamp(energy * 0.7 + (100 - stress) * 0.3-sleepPenalty, 0, 100);
    const willingness = livingClamp(45 + warmth * 0.3 + socialNeed * 0.25
        - resentment * 0.45 - anger * 0.5 + Math.min(20, interest * 0.2) + (promiseDue ? 20 : 0), 0, 100);
    const cooldownUntil = experience.allowNoReply ? Number(dynamics.cooldownUntil) || 0 : 0;
    const pressure = experience.allowNoReply && (cooldownUntil > nowMs || willingness < 22);
    const availability = situation.availability || life.availability;
    const activeGoal = companion.lifeRuntime?.activities?.goals?.find(goal => goal.status === 'active');
    const canMakeTime = situation.source === 'activity' && activeGoal?.kind !== 'contact'
        && capacity >= 30 && !pressure && (engaged || interest >= 55);
    const key = [availability, life.activity, Math.floor((situation.endsAt || 0) / 60000), company,
        Math.floor(capacity / 15), Math.floor(willingness / 15), pressure, promiseDue, engaged, canMakeTime, Math.floor(interest / 20)].join('|');
    return { life, availability, capacity, willingness, cooldownUntil, pressure, company, promiseDue, engaged, interest, canMakeTime, key };
}

function decideCompanionAttention(companion, message, nowMs, experience, context) {
    const previous = normalizeCompanionAttention(message.attention);
    const attention = previous || { version: 1, stage: 'waiting', nextCheckAt: 0,
        noticedAt: message.deliveryState === 'read' ? (message.readAt || nowMs) : 0,
        composeUntil: 0, lastEvaluatedAt: 0, contextKey: '', inboxKey: '', reason: '', trace: [] };
    const inboxChanged = attention.inboxKey !== (context.inboxKey || '');
    if (['answered', 'forgotten'].includes(attention.stage)) return attention;
    if (nowMs < Number(message.deliveredAt || message.timestamp || nowMs)) return attention;
    if (previous && nowMs < attention.lastEvaluatedAt) return attention;
    if (previous && !inboxChanged && attention.stage === 'ready' && context.key === attention.contextKey) return attention;
    if (previous && !inboxChanged && context.key === attention.contextKey && nowMs < attention.nextCheckAt) return attention;
    const set = (stage, reason, nextCheckAt, composeUntil = 0) => {
        if (attention.stage !== stage || attention.reason !== reason) {
            attention.trace.push({ at: nowMs, stage, reason });
            attention.trace = attention.trace.slice(-8);
        }
        return { ...attention, stage, reason, nextCheckAt, composeUntil,
            lastEvaluatedAt: nowMs, contextKey: context.key, inboxKey: context.inboxKey || '' };
    };
    if (!experience.replyDelays) {
        attention.noticedAt ||= nowMs;
        return set('ready', 'Immediate replies are enabled.', nowMs);
    }
    const endsAt = Number(context.life.situation?.endsAt) || 0;
    const checkpoint = fallback => endsAt > nowMs ? Math.min(endsAt, fallback) : fallback;
    if (context.availability === 'asleep') {
        return set(attention.noticedAt ? 'deferred' : 'waiting', 'Asleep; the conversation cannot hold attention.',
            endsAt > nowMs ? endsAt : companionNextWakeAt(companion, nowMs));
    }
    const occupied = ['busy', 'private'].includes(context.availability);
    if (!attention.noticedAt && (context.engaged || context.canMakeTime) && (!occupied || context.canMakeTime)) attention.noticedAt = nowMs;
    if (!attention.noticedAt) {
        if (!previous || previous.contextKey !== context.key) {
            const noticeSeconds = occupied ? 60 + context.company * 45 + (100 - context.capacity) * 2
                : 2 + (100 - context.capacity) / 5;
            return set('waiting', occupied ? 'The notification is waiting for a phone check.' : 'The notification has not been opened yet.',
                checkpoint(nowMs + noticeSeconds * 1000 * (companion.lifeProfile?.world?.voice?.cadence || 1)));
        }
        attention.noticedAt = nowMs;
    }
    if (context.pressure) {
        return set('withheld', context.cooldownUntil > nowMs ? 'Taking space after conflict; reconsider when the pressure eases.'
            : 'Current anger and relationship tension outweigh the wish to engage.',
            context.cooldownUntil > nowMs ? context.cooldownUntil : nowMs + 30 * 60000);
    }
    const effort = 8 + Math.min(28, String(message.text || '').length / 90)
        + (message.type && message.type !== 'text' ? 12 : 0);
    const interruptionCost = context.availability === 'private' ? 100 : occupied ? 65 + context.company * 8 : 0;
    const waitingMinutes = Math.max(0, nowMs - attention.noticedAt) / 60000;
    // Busy describes divided attention, not a prohibition on using a phone.
    // Sustained waiting creates a brief check-in opportunity even when one
    // broad routine block follows another. Private time and sleep stay closed.
    const breakAfterMinutes = 1 + context.company * 1.5 + (100 - context.capacity) * 0.025;
    const phoneBreak = context.availability === 'busy' && waitingMinutes >= breakAfterMinutes
        && context.capacity >= 24 && context.willingness >= 30;
    const canInterrupt = !occupied || context.canMakeTime || phoneBreak
        || (context.promiseDue && context.willingness > interruptionCost && context.capacity > 45);
    const briefResponse = waitingMinutes >= breakAfterMinutes && context.capacity >= 24;
    const requiredCapacity = briefResponse ? Math.min(effort + 12, 24) : effort + 12;
    if (!canInterrupt || context.capacity < requiredCapacity) {
        if (experience.allowNoReply && attention.noticedAt && nowMs - attention.noticedAt > 24 * 60 * 60000
            && !context.promiseDue && context.willingness < 45) {
            return set('forgotten', 'Repeated postponement let this conversation fall out of attention.', 0);
        }
        return set('deferred', !canInterrupt ? `Attention remains with ${context.life.label || 'the current activity'}${context.company ? ' and the people present' : ''}.`
            : 'There is not enough energy and attention for this message yet.',
            checkpoint(Math.min(nowMs + 5 * 60000,
                attention.noticedAt + breakAfterMinutes * 60000 > nowMs
                    ? attention.noticedAt + breakAfterMinutes * 60000 : nowMs + 5 * 60000)));
    }
    // Generation is the composing work. Do not charge a second simulated
    // typing delay before the provider has even started producing the reply.
    return set('ready', context.canMakeTime ? 'Making time for an engaging exchange during an interruptible activity.' : phoneBreak ? 'Taking a brief phone break; a short response fits this activity.'
        : context.engaged ? 'Continuing the active conversation.'
        : briefResponse ? 'Making room for a brief response.'
        : 'Attention is available; begin responding.', nowMs);

}

function advanceCompanionMessageAttention(companion, message, nowMs, experience, inbox = [message]) {
    if (message.role !== 'user' || message.invalidated || !message.awaitingReply || message.replyJobId) return false;
    const context = companionAttentionContext(companion, nowMs, experience);
    const delivered = inbox.filter(item => item.role === 'user' && !item.invalidated && item.awaitingReply
        && Number(item.deliveredAt || item.timestamp) <= nowMs);
    // Assess the delivered inbox together. A short ready message must not
    // bypass the attention cost of a longer follow-up joining the batch.
    context.inboxKey = delivered.map(item => item.id).slice(-10).join('|').slice(0, 1000);
    const attentionInput = { ...message, text: delivered.map(item => item.text || '').join('\n').slice(0, 8000),
        type: delivered.some(item => item.type && item.type !== 'text') ? 'media' : 'text' };
    const before = JSON.stringify(message.attention);
    const attention = decideCompanionAttention(companion, attentionInput, nowMs, experience, context);
    if (attention.stage === 'ready' && context.canMakeTime && companion.lifeRuntime?.activities) {
        VHActivityEngine.reserveAttention(companion.lifeRuntime.activities, nowMs, context.inboxKey,
            20000 + String(attentionInput.text || '').length * 180 + context.interest * 200
                + (attentionInput.type === 'media' ? 20000 : 0));
    }
    message.attention = attention;
    message.readAt = attention.noticedAt;
    message.replyDueAt = attention.stage === 'ready' ? (message.replyDueAt || nowMs) : 0;
    message.deferredReason = attention.stage === 'withheld' ? 'mood' : context.life.availability;
    if (attention.stage === 'forgotten') message.awaitingReply = false;
    const changed = before !== JSON.stringify(attention);
    if (changed && (!before || message.attention.trace.length)) {
        companionSetDecisionEvidence(companion, {
            decision: attention.reason, perceived: attention.noticedAt ? String(message.text || `[${message.type}]`).slice(0, 700)
                : 'A notification; its contents have not been read.',
            interpretation: '', pressures: [`Attention capacity ${Math.round(context.capacity)}/100`,
                `Willingness to engage ${Math.round(context.willingness)}/100`, context.life.label],
            confidence: 100, source: 'kernel', createdAt: nowMs
        });
    }
    return changed;
}

function companionSocialContactIntervalMs(person, seed) {
    const ranges = {
        daily: [18, 34], few_week: [42, 90], weekly: [120, 240],
        monthly: [480, 960], rare: [960, 2160]
    }[person.contactFrequency] || [120, 240];
    return (ranges[0] + companionSeededRoll(seed) * (ranges[1] - ranges[0])) * 60 * 60 * 1000;
}

function companionSocialWorldState(companion) {
    const life = companion.lifeProfile || normalizeCompanionLifeProfile({});
    const runtime = companion.lifeRuntime ||= normalizeCompanionLifeRuntime({}, life.socialCircle);
    runtime.socialWorld = normalizeCompanionSocialWorldRuntime(runtime.socialWorld, life.socialCircle);
    return runtime.socialWorld;
}

function advanceCompanionSocialWorld(companion, nowMs = Date.now(), options = {}) {
    if(companion.__vh2View)return false;
    if (!companion.lifeProfile?.initializedAt) return [];
    const world = companionSocialWorldState(companion);
    let changed = false;
    const startAt = world.lastAdvancedAt || companion.lifeProfile.initializedAt || nowMs;
    const maxCatchupMs = livingClamp(Number(options.maxDays) || 28, 1, 90) * 86400000;
    const boundedStart = Math.max(startAt, nowMs - maxCatchupMs);
    const firstDay = Math.floor(boundedStart / 86400000);
    const lastDay = Math.floor(nowMs / 86400000);
    const events = [];

    for (const relation of world.people) {
        const person = companion.lifeProfile.socialCircle.find(item => item.id === relation.personId);
        if (!person) continue;
        // An executable contact opportunity is the sole owner of this person's
        // new interactions; the legacy clock must not invent a second contact.
        if (companion.lifeProfile.activityOptions?.some(option => option.kind === 'contact' && option.participantId === person.id)) continue;
        if (!relation.nextInteractionAt) {
            relation.nextInteractionAt = boundedStart + companionSocialContactIntervalMs(
                person, `${companion.lifeProfile.seed}|social-first|${person.id}|${firstDay}`);
            changed = true;
        }
        let guard = 0;
        while (relation.nextInteractionAt <= nowMs && guard++ < 40) {
            changed = true;
            const at = relation.nextInteractionAt;
            const dayKey = Math.floor(at / 86400000);
            const warmthRoll = companionSeededRoll(`${companion.lifeProfile.seed}|social-tone|${person.id}|${dayKey}`);
            const closenessDelta = warmthRoll < 0.16 ? -2 : warmthRoll > 0.78 ? 2 : warmthRoll > 0.58 ? 1 : 0;
            const tensionDelta = warmthRoll < 0.10 ? 2 : warmthRoll < 0.24 ? 1 : warmthRoll > 0.76 ? -1 : 0;
            relation.closeness = livingClamp(relation.closeness + closenessDelta, -100, 100);
            relation.trust = livingClamp(relation.trust + Math.sign(closenessDelta), -100, 100);
            relation.tension = livingClamp(relation.tension + tensionDelta, 0, 100);
            relation.lastInteractionAt = at;
            relation.currentSituation = tensionDelta > 0
                ? 'Their latest ordinary contact left some friction.'
                : closenessDelta > 0 ? 'Recent contact felt easy or supportive.'
                : 'They remain part of each other’s ordinary life.';
            const meaningful = Math.abs(closenessDelta) >= 2 || tensionDelta >= 2;
            const summary = meaningful
                ? `${companion.name} and ${person.name} had ordinary contact that ${closenessDelta > 0 ? 'brought them a little closer' : 'created some distance'}${tensionDelta > 0 ? ' and left mild tension' : ''}.`
                : `${companion.name} and ${person.name} stayed in ordinary contact.`;
            const event = {
                id: livingId('vh_social_event', `${companion.id}|${person.id}|${dayKey}|${guard}`),
                summary, closenessDelta, tensionDelta, createdAt: at
            };
            relation.relationshipEvents.push(event);
            relation.relationshipEvents = relation.relationshipEvents.slice(-30);
            world.interactions.push({ id: event.id, personId: person.id, summary, createdAt: at });
            if (meaningful) events.push({ ...event, person, relation });

            // Gossip is allowed only when it can point back to an authored
            // tension. The deterministic engine never invents a secret or a
            // fresh accusation just to make the social graph look active.
            const gossipSubject = companion.lifeProfile.socialCircle.find(subject =>
                subject.id !== person.id && subject.currentTension
                && companionSeededRoll(`${companion.lifeProfile.seed}|gossip-subject|${person.id}|${subject.id}|${dayKey}`) > 0.82);
            if (meaningful && gossipSubject) {
                const gossipId = livingId('vh_gossip', `${companion.id}|${person.id}|${gossipSubject.id}|${dayKey}`);
                if (!world.gossip.some(item => item.id === gossipId)) {
                    world.gossip.push({
                        id: gossipId,
                        sourcePersonId: person.id,
                        subjectPersonId: gossipSubject.id,
                        summary: `${person.name} brought up the already-established situation involving ${gossipSubject.name}: ${gossipSubject.currentTension}`,
                        createdAt: at,
                        expiresAt: at + 14 * 86400000
                    });
                }
            }
            relation.nextInteractionAt = at + companionSocialContactIntervalMs(
                person, `${companion.lifeProfile.seed}|social-next|${person.id}|${dayKey}|${guard}`);
        }
    }
    world.interactions = world.interactions.slice(-120);
    const activeGossip = world.gossip.filter(item => !item.expiresAt || item.expiresAt > nowMs).slice(-40);
    if (activeGossip.length !== world.gossip.length) changed = true;
    world.gossip = activeGossip;
    // A five-second poll is not a simulation event. Moving this marker on an
    // idle pass made the entire companion record dirty, so installations with
    // embedded photos/videos rewrote hundreds of megabytes to IndexedDB over
    // and over. Only persist an advancement marker when canonical social state
    // actually changed.
    if (changed) world.lastAdvancedAt = nowMs;

    if (!options.preview) {
        events.slice(-3).forEach(event => {
            const id = `vh_social_${event.id}`.slice(0, 100);
            if (!companion.lifeEvents.some(item => item.id === id)) {
                companion.lifeEvents.push(normalizeCompanionLifeEvent({
                    id, text: event.summary, createdAt: event.createdAt, source: 'relationship'
                }));
            }
            const influence = livingClamp(Number(event.person.influence) || 35, 0, 100) / 100;
            applyCompanionMoodUpdate(companion, {
                valence_change: Math.round(event.closenessDelta * influence),
                arousal_change: Math.round(Math.max(0, event.tensionDelta) * influence),
                relationship_change: 0,
                stress_change: Math.round(event.tensionDelta * influence),
                social_need_change: event.closenessDelta > 0 ? -1 : 1,
                mood_label: companion.mood?.label || 'content'
            }, event.createdAt);
        });
        companion.lifeRuntime.simulationLedger.push(...events.slice(-8).map(event => ({
            id: event.id, kind: 'social', summary: event.summary, createdAt: event.createdAt, costCalls: 0
        })));
        companion.lifeRuntime.simulationLedger = companion.lifeRuntime.simulationLedger.slice(-500);
        companion.lifeEvents = companion.lifeEvents.slice(-200);
    }
    return events;
}

function companionPlanLifeDay(companion, nowMs = Date.now()) {
    const runtime = companion.lifeRuntime;
    const local = companionLocalMinuteInfo(companion, nowMs);
    if (runtime.plannedDateKey === local.dateKey && runtime.dayPlan.some(item => item.dateKey === local.dateKey)) {
        return runtime.dayPlan.filter(item => item.dateKey === local.dateKey);
    }
    const localMidnight = nowMs - (local.hour * 60 + local.minute) * 60000;
    const schedule = (companion.lifeProfile?.weeklySchedule || []).filter(block => VHWorldEngine.activeOn(block,local.dateKey) && block.days.includes(local.weekday))
        .sort((left, right) => left.startMinute - right.startMinute).slice(0, 12);
    const plan = schedule.map(block => ({
        id: livingId('vh_life_plan', `${companion.id}|${local.dateKey}|schedule|${block.id}`),
        dateKey: local.dateKey, kind: 'schedule',
        summary: `${block.activity}${block.placeLabel ? ` at ${block.placeLabel}` : ''}`,
        cause: `Authored ${COMPANION_WEEKDAYS[local.weekday]} routine`,
        personId: block.withIds?.[0] || '', dueAt: localMidnight + block.startMinute * 60000,
        status: 'planned', createdAt: nowMs, resolvedAt: 0
    }));
    companion.commitments.filter(item => item.status === 'pending' && item.dueAt > 0
        && companionLocalMinuteInfo(companion, item.dueAt).dateKey === local.dateKey).slice(0, 6).forEach(item => {
        plan.push({
            id: livingId('vh_life_plan', `${companion.id}|${local.dateKey}|commitment|${item.id}`),
            dateKey: local.dateKey, kind: 'obligation', summary: item.text,
            cause: 'A promise to the player remains due', personId: '', dueAt: item.dueAt,
            status: 'planned', createdAt: nowMs, resolvedAt: 0
        });
    });
    const socialWorld = companionSocialWorldState(companion);
    socialWorld.people.filter(person => person.nextInteractionAt > 0
        && companionLocalMinuteInfo(companion, person.nextInteractionAt).dateKey === local.dateKey)
        .sort((left, right) => left.nextInteractionAt - right.nextInteractionAt).slice(0, 4).forEach(person => {
        const authored = companion.lifeProfile.socialCircle.find(item => item.id === person.personId);
        if (!authored) return;
        plan.push({
            id: livingId('vh_life_plan', `${companion.id}|${local.dateKey}|relationship|${person.personId}`),
            dateKey: local.dateKey, kind: 'relationship',
            summary: `Likely contact with ${authored.name}${authored.currentTension ? ` around ${authored.currentTension}` : ''}`,
            cause: `${authored.contactFrequency.replace('_', ' ')} contact pattern${authored.currentTension ? ' and unresolved tension' : ''}`,
            personId: person.personId, dueAt: person.nextInteractionAt,
            status: 'planned', createdAt: nowMs, resolvedAt: 0
        });
    });
    runtime.dayPlan = [...runtime.dayPlan.filter(item => item.dateKey !== local.dateKey), ...plan]
        .sort((left, right) => left.dueAt - right.dueAt).slice(-80);
    runtime.plannedDateKey = local.dateKey;
    return plan;
}

function advanceCompanionLifePlan(companion, nowMs = Date.now()) {
    if(companion.__vh2View)return false;
    const plan = companionPlanLifeDay(companion, nowMs);
    let changed = false;
    plan.forEach(item => {
        if (item.status === 'planned' && item.dueAt <= nowMs) {
            item.status = 'active';
            changed = true;
        }
        if (item.status === 'active' && item.kind === 'relationship') {
            const interaction = companionSocialWorldState(companion).interactions
                .find(event => event.personId === item.personId && event.createdAt >= item.dueAt - 60000);
            if (interaction) {
                item.status = 'completed'; item.resolvedAt = interaction.createdAt;
                item.summary = interaction.summary; changed = true;
            }
        }
    });
    return changed;
}

function advanceCompanionActivities(companion, nowMs = Date.now(), options = {}) {
    if(companion.__vh2View)return null;
    const runtime = companion.lifeRuntime;
    if (!runtime) return false;
    runtime.activities ||= VHActivityEngine.normalize();
    const activities = runtime.activities;
    if(!activities.suppliesSeeded){for(const supply of companion.lifeProfile?.supplies||[])if(!(supply.id in activities.resources))activities.resources[supply.id]=supply.quantity;activities.suppliesSeeded=true;}
    activities.plannerStartedAt ||= nowMs;
    let dynamics = companion.humanDynamics || {};
    // A local simulation tick, not a prose classifier, proposes supported goals.
    if (!activities.lastAdvancedAt) { activities.lastAdvancedAt = nowMs; return true; }
    const before = JSON.stringify(activities);
    const previousEvents = new Set(activities.events.map(event => event.id));
    let cursor = Math.max(activities.lastAdvancedAt, nowMs - 72 * 3600000);
    // Fixed one-minute intervals preserve progress across repeated ticks and
    // reloads. Historical authored constraints decide whether work can occur.
    activities.lastAdvancedAt = cursor;
    while (cursor + 60000 <= nowMs) {
        advanceCompanionWorld(companion, cursor);
        advanceCompanionHumanDynamics(companion, cursor);
        dynamics = companion.humanDynamics;
        if(globalThis.VH2Geography?.enabled(companion)) VH2Geography.propose(companion,cursor,companionLocalMinuteInfo);
        if (companion.lifeProfile?.initializedAt) VHActivityEngine.proposeNeeds(activities, cursor, globalThis.VH2Geography?.enabled(companion)?{...dynamics,hunger:0}:dynamics);
        if(!globalThis.VH2Geography?.enabled(companion))VHActivityEngine.advanceBreak(activities,cursor,{policy:companion.lifeProfile.breakPolicy,situation:companionBaseSituationAt(companion,cursor,false,false,true),energy:dynamics.energy,hunger:dynamics.hunger,stress:dynamics.stress});
        let situation = companionBaseSituationAt(companion, cursor);
        if(globalThis.VH2Geography?.enabled(companion)&&situation.source==='schedule'&&(dynamics.hunger>=65||dynamics.stress>=75||dynamics.energy<25))situation={...situation,availability:'available'};
        const local = companionLocalMinuteInfo(companion, cursor);
        const minute = local.hour * 60 + local.minute;
        if (companion.lifeProfile?.initializedAt && cursor >= activities.plannerStartedAt) {
            const authored = companion.lifeProfile.activityOptions || [];
            const options = authored.length ? authored : [
                { id: 'personal_focus', kind: 'focus', label: 'a personal task', startMinute: 600, endMinute: 1020, priority: 30 },
                { id: 'personal_interest', kind: 'leisure', label: 'Spend time on a personal interest', startMinute: 1080, endMinute: 1380, priority: 25 }
            ];
            VHActivityEngine.plan(activities, cursor, { dateKey: local.dateKey, weekday: local.weekday,
                midnight: Math.floor(cursor / 60000) * 60000 - minute * 60000,
                seed: companion.lifeProfile.seed || companion.id, opportunities: options,
                people: companion.lifeProfile.socialCircle.map(person => {
                    const relation = runtime.socialWorld?.people?.find(item => item.personId === person.id);
                    return { ...person, availableAfter: relation?.lastInteractionAt
                        ? relation.lastInteractionAt + companionSocialContactIntervalMs(person, `${companion.lifeProfile.seed}|contact|${person.id}|${relation.lastInteractionAt}`) : 0 };
                }), commitments: companion.commitments });
        }
        const availablePeople = (companion.lifeProfile?.socialCircle || []).filter(person =>
            (!companion.lifeRuntime.world?.people?.[person.id] || (companion.lifeRuntime.world.people[person.id].energy >= (companion.lifeProfile.world.adaptation?.socialRecoveryEnergy??25)&&!(companion.lifeRuntime.world.people[person.id].restUntil>cursor))) && person.contactWindows?.some(window => window.days.includes(local.weekday)
                && minute >= window.startMinute && minute < window.endMinute)).map(person => person.id);
        const priorActivityEvents = new Set(activities.events.map(event => event.id));
        const geographicCash=activities.resources.vh_cash;
        const delta = VHActivityEngine.advance(activities, cursor + 60000, {
            selectAction:options.selectAction,
            meetingAvailable:typeof VH2Plans!=='undefined'?(id,at)=>VH2Plans.canMeet(companion,id,at,companionLocalMinuteInfo):undefined,
            routeForGoal:globalThis.VH2Geography?.enabled(companion)?(goal,at)=>VH2Geography.routeGoal(companion,goal,at,companionLocalMinuteInfo):companion.lifeProfile.world?.transport.goalTravel?(goal,at)=>VHWorldEngine.goalRoute(companion,goal,at,Math.min(...(companion.commitments||[]).filter(c=>c.status==='pending'&&c.dueAt>at).map(c=>c.dueAt),...(globalThis.VH2Geography?.schedule(companion)||companion.lifeProfile.weeklySchedule||[]).filter(b=>VHWorldEngine.activeOn(b,local.dateKey)&&b.days.includes(local.weekday)&&b.startMinute>minute).map(b=>cursor+(b.startMinute-minute)*60000)),companionLocalMinuteInfo):undefined,
            startTravel:(goal,at,route)=>{
                if(route?.geographic)return VH2Geography.start(companion,goal,at,route);
                const prior=new Set(companion.lifeRuntime.world.events.map(e=>e.id));
                const started=VHWorldEngine.startGoalTrip(companion,goal,at,route);
                for(const event of companion.lifeRuntime.world.events.filter(e=>!prior.has(e.id))){
                    companionRecordContinuityEvent(companion,{type:'life_event',summary:event.summary,createdAt:event.at,perceivedAt:event.at,dedupeKey:`world:${event.id}`});
                    companion.lifeEvents ||= [];
                    if(!companion.lifeEvents.some(e=>e.id===event.id))companion.lifeEvents.push(normalizeCompanionLifeEvent({id:event.id,text:event.summary,createdAt:event.at,source:'autonomy'}));
                }
                companion.lifeEvents=(companion.lifeEvents||[]).slice(-200);return started;
            },
            onlyGoalId:situation.source==='break'?activities.break.goalId:'',
            availability: situation.source==='sleep_transition'?'private':situation.availability, label: situation.label, energy: Math.max(0,dynamics.energy-(dynamics.sleep?.stage==='drowsy'?15:0)), stress:dynamics.stress, hunger: dynamics.hunger, socialNeed: dynamics.socialNeed, availablePeople,
            requirements:(globalThis.VH2Geography?.schedule(companion)||companion.lifeProfile.weeklySchedule||[]).filter(b=>VHWorldEngine.activeOn(b,local.dateKey)&&b.days.includes(local.weekday)&&b.endMinute>minute).map(b=>{
                const leg=companion.lifeProfile.travelLegs?.filter(l=>l.from===situation.placeId&&l.to===b.placeId).sort((a,b)=>a.minutes-b.minutes)[0];
                return {resources:b.departureCosts,dueAt:cursor+(b.startMinute-minute-(leg?.minutes||0))*60000,endsAt:cursor+(b.endMinute-minute)*60000};
            }),
            policy:companion.lifeProfile.decisionPolicy,seed:companion.lifeProfile.seed||companion.id,placeId:situation.placeId,
            nextCommitmentAt:Math.min(...(companion.commitments||[]).filter(c=>c.status==='pending'&&c.dueAt>cursor).map(c=>c.dueAt),...(globalThis.VH2Geography?.schedule(companion)||companion.lifeProfile.weeklySchedule||[]).filter(b=>VHWorldEngine.activeOn(b,local.dateKey)&&b.days.includes(local.weekday)&&b.startMinute>minute).map(b=>cursor+(b.startMinute-minute)*60000))
        });
        if(globalThis.VH2Geography?.enabled(companion))VH2Geography.settle(companion,geographicCash);
        dynamics.energy = livingClamp((Number(dynamics.energy) || 0) + delta.energy, 0, 100);
        dynamics.stress = livingClamp((Number(dynamics.stress) || 0) + delta.stress, 0, 100);
        dynamics.hunger = livingClamp((Number(dynamics.hunger) || 0) + delta.hunger, 0, 100);
        activities.events.filter(event => event.kind === 'completed' && !priorActivityEvents.has(event.id)).forEach(event => {
            const goal = activities.goals.find(goal => goal.id === event.goalId);
            if (goal?.kind === 'contact' && goal.participantId) {
                const social = companionSocialWorldState(companion);
                const relation = social.people.find(person => person.personId === goal.participantId);
                if (relation && !social.interactions.some(item => item.id === event.id)) {
                    social.interactions.push({ id: event.id, personId: goal.participantId, summary: event.summary, createdAt: event.at });
                    social.interactions = social.interactions.slice(-120);
                    relation.lastInteractionAt = event.at;
                    relation.currentSituation = 'Made time for a conversation.';
                    companion.humanDynamics.socialNeed = livingClamp(companion.humanDynamics.socialNeed - 8, 0, 100);
                }
            }
        });
        cursor += 60000;
    }
    activities.events.filter(event => !previousEvents.has(event.id)).forEach(event => {
        companionRecordContinuityEvent(companion, { type: 'life_event', summary: event.summary,
            createdAt: event.at, perceivedAt: event.at, dedupeKey: `activity:${event.id}` });
        if (event.kind === 'completed' || event.kind === 'project_completed') {
            companion.lifeEvents.push(normalizeCompanionLifeEvent({ id: event.id, text: event.summary,
                createdAt: event.at, source: 'autonomy' }));
            companion.lifeEvents = companion.lifeEvents.slice(-100);
            companionRecordEpisode(companion, { id: event.id, title: event.summary, summary: event.summary,
                emotionalMeaning: 'An intention was carried through to its recorded outcome.', importance: 35,
                sourceEventIds: [event.id] }, event.at);
        }
    });
    return before !== JSON.stringify(activities);
}

function advanceCompanionWorld(companion, nowMs) {
    if(companion.__vh2View)return null;
    const settings=companion.lifeProfile?.world;
    if (!settings || !(settings.socialAgent?.enabled || settings.transport.enabled || settings.gifts.enabled || settings.closet.mode==='items' || settings.people.length || companion.lifeRuntime?.world?.connection?.state==='pending')) return;
    const result = VHWorldEngine.advance(companion, nowMs, companionLocalMinuteInfo, (c,t)=>companionBaseSituationAt(c,t,true));
    if (companion.humanDynamics) {
        companion.humanDynamics.stress = livingClamp((companion.humanDynamics.stress || 0) + result.stress,0,100);
        companion.humanDynamics.energy = livingClamp((companion.humanDynamics.energy || 0) + result.energy,0,100);
    }
    for (const event of result.events) {
        companionRecordContinuityEvent(companion,{type:'life_event',summary:event.summary,createdAt:event.at,perceivedAt:event.at,dedupeKey:`world:${event.id}`});
        companion.lifeEvents ||= [];
        if (!companion.lifeEvents.some(e=>e.id===event.id)) companion.lifeEvents.push(normalizeCompanionLifeEvent({id:event.id,text:event.summary,createdAt:event.at,source:'autonomy'}));
        if(event.kind==='recovery_action'&&companion.lifeRuntime.activities)VHActivityEngine.addGoal(companion.lifeRuntime.activities,event.action,`world:${event.id}`,event.at,event.action==='preparation'?'Make a new plan after the disruption':'');
        if (event.kind==='encounter') {
            const person=companion.lifeRuntime.socialWorld?.people?.find(p=>p.personId===event.personId);
            if(person)person.lastInteractionAt=Math.max(person.lastInteractionAt||0,event.at);
        }
    }
    companion.lifeEvents = (companion.lifeEvents || []).slice(-200);
}

function advanceCompanionLife(companion, nowMs = Date.now()) {
    if(companion.__vh2View)return null;
    if (companion.lifeProfile?.initializedAt || companion.lifeRuntime?.activities?.goals?.length) advanceCompanionActivities(companion, nowMs);
    advanceCompanionWorld(companion, nowMs);
    // Uninitialized life is a pure fallback computed from the clock. Merely
    // observing it must not dirty persistent state on every agency poll.
    if (!companion.lifeProfile?.initializedAt) return null;
    const runtime = companion.lifeRuntime;
    const priorSimulatedAt = runtime.lastSimulatedAt || nowMs;
    let changed = false;
    if (advanceCompanionLifePlan(companion, nowMs)) changed = true;
    const socialBefore = JSON.stringify(runtime.socialWorld || null);
    advanceCompanionSocialWorld(companion, nowMs);
    if (socialBefore !== JSON.stringify(runtime.socialWorld || null)) changed = true;
    const situation = companionSituationAt(companion, nowMs);
    const situationKey = [situation.source, situation.placeId || situation.placeLabel, situation.activity].join('|').slice(0, 240);
    if (situationKey && situationKey !== runtime.currentSituationKey) {
        const previous = runtime.currentSituationKey ? companionSituationAt(companion, priorSimulatedAt) : null;
        const placeChanged = previous && (previous.placeId || previous.placeLabel) !== (situation.placeId || situation.placeLabel);
        const transitionSummary = previous
            ? `${companion.name}'s routine advanced from ${previous.activity}${previous.placeLabel ? ` at ${previous.placeLabel}` : ''} to ${situation.activity}${situation.placeLabel ? ` at ${situation.placeLabel}` : ''}.`
            : `${companion.name}'s current routine is ${situation.activity}${situation.placeLabel ? ` at ${situation.placeLabel}` : ''}.`;
        runtime.simulationLedger.push({
            id: livingId('vh_schedule_transition', `${companion.id}|${situationKey}|${nowMs}`),
            kind: placeChanged ? 'travel' : 'schedule', summary: transitionSummary,
            createdAt: nowMs, costCalls: 0
        });
        runtime.simulationLedger = runtime.simulationLedger.slice(-500);
        runtime.currentSituationKey = situationKey;
        changed = true;
    }
    if (runtime.pendingInitiative?.expiresAt <= nowMs) {runtime.pendingInitiative=null;changed=true;}
    if (changed) runtime.lastSimulatedAt = nowMs;
    return null;
}

function companionConversationTransition(companion, messages, nowMs) {
    const current = companionSituationAt(companion, nowMs);
    const recent = messages.filter(message => !message.invalidated && Number(message.timestamp) <= nowMs);
    const lastReply = [...recent].reverse().find(message => message.role === 'companion');
    const lastPlayer = [...recent].reverse().find(message => message.role === 'user');
    const engaged = lastReply && lastPlayer && nowMs - lastReply.timestamp < 3 * 60000
        && nowMs - lastPlayer.timestamp < 3 * 60000;
    const sleep=companion.humanDynamics?.sleep;
    let upcoming = sleep?.stage==='winding_down'?{at:sleep.windDownAt+(companion.lifeProfile.sleepPolicy?.windDownMinutes||10)*60000,activity:'sleep',availability:'asleep',key:`sleep:${sleep.windDownAt}`} : null;
    if(upcoming&&upcoming.at<=nowMs)upcoming=null;
    if(!upcoming&&current.availability==='available')upcoming=VHWorldEngine.departurePreview(companion,nowMs,companionLocalMinuteInfo);
    if (!upcoming && current.availability !== 'asleep') {
        for (let minute = 1; minute <= 5; minute += 1) {
            const at = nowMs + minute * 60000;
            const next = companionSituationAt(companion, at);
            if (next.availability !== current.availability && ['busy', 'private', 'asleep'].includes(next.availability)) {
                upcoming = { at, endsAt:next.endsAt||0, activity: next.label, availability: next.availability,
                    key: `${Math.floor(at / 60000)}|${next.availability}|${next.label}` };
                break;
            }
        }
    }
    const previous = lastReply ? companionBaseSituationAt(companion, Number(lastReply.timestamp)) : null;
    return { engaged: !!engaged, upcoming,
        returned: !!previous && previous.availability !== current.availability && current.availability === 'available',
        previousActivity: previous?.label || '' };
}

if (typeof module === 'object' && module.exports) module.exports = {companionAgeConfirmationMatches, companionCurrentAge, companionConversationTransition, advanceCompanionWorld, companionScheduledJourneyAt, isPlainObject, livingClamp, livingId, COMPANION_MOOD_LABELS, COMPANION_INTIMACY_AFTEREFFECTS, COMPANION_EMOTIONS, COMPANION_SLEEP_HOURS, COMPANION_ACTIVITIES, normalizeCompanionTrauma, normalizeCompanionLifeEvent, COMPANION_WEEKDAYS, COMPANION_LIFE_AVAILABILITY, COMPANION_PLACE_KINDS, normalizeCompanionLifePlace, normalizeCompanionSocialPerson, normalizeCompanionSocialRelationshipRuntime, normalizeCompanionSocialWorldRuntime, normalizeCompanionWardrobeLook, normalizeCompanionScheduleBlock, normalizeCompanionLifeProfile, normalizeCompanionEnvironment, normalizeCompanionLifeRuntime, COMPANION_CONTINUITY_EVENT_TYPES, normalizeCompanionContinuityEvent, normalizeCompanionBelief, normalizeCompanionIntention, normalizeCompanionEpisode, normalizeCompanionOpenThread, normalizeCompanionDecisionEvidence, normalizeCompanionPlayerModelEntry, normalizeCompanionBoundary, normalizeCompanionTruthEntry, normalizeCompanionMilestone, normalizeCompanionContinuityRuntime, companionRecordEpisode, companionContinuity, companionRecordContinuityEvent, companionSetDecisionEvidence, normalizeCompanionHumanDynamics, normalizeCompanionEmotionVector, normalizeCompanionEmotionDeltaVector, companionEmotionVectorFromMood, normalizeCompanionEmotionReaction, normalizeCompanionEmotionState, companionSeededRoll, decayCompanionMood, normalizeCompanionRelationshipDimensions, companionRelationshipDeltaCap, applyCompanionMoodUpdate, companionRegulationFactors, companionEmotionFactors, companionExpressedEmotionVector, companionAppraisalEmotionDeltas, advanceCompanionEmotionState, applyCompanionEmotionUpdate, companionSexualSystemActive, companionSexualFactors, companionSexualContext, companionAlcoholContext, advanceCompanionHumanDynamics, advanceCompanionHumanDynamicsStep, applyCompanionDynamicsUpdate, isCompanionAsleep, companionUsesFixedTimezoneOffset, companionFixedOffsetDate, companionLocalDateInfo, companionLocalMinuteInfo, companionDefaultWorkweek, buildProceduralCompanionLifeProfile, companionScheduleBlockAt, companionSituationAt, companionBaseSituationAt, companionActivityPool, companionLifeStateLegacy, companionLifeState, companionNextWakeAt, normalizeCompanionAttention, companionAttentionContext, decideCompanionAttention, advanceCompanionMessageAttention, companionSocialContactIntervalMs, companionSocialWorldState, advanceCompanionSocialWorld, companionPlanLifeDay, advanceCompanionLifePlan, advanceCompanionActivities, advanceCompanionLife};
