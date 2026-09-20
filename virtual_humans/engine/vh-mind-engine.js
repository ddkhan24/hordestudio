/* Composable, provider-free behavioral pressure engine for Virtual Humans.
 * A preset changes tendencies and supplies cue rules; it never supplies facts,
 * consent, a diagnosis, or a compulsory action. The same pure functions run in
 * the browser and in offline audits.
 */
(function (root, factory) {
    const library = typeof module === 'object' && module.exports ? require('./vh-mind-library') : root.VHMindLibrary;
    const engine = factory(library);
    if (typeof module === 'object' && module.exports) module.exports = engine;
    else root.VHMindEngine = engine;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (library) {
    'use strict';

    const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Number(value) || 0));
    const text = (value, limit = 240) => String(value || '').trim().slice(0, limit);
    const slug = value => text(value, 80).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const unique = values => [...new Set(values.filter(Boolean))];
    const AXES = Object.freeze({
        fixation: 'Fixation', jealousy: 'Jealousy', rejectionSensitivity: 'Rejection sensitivity',
        affectVolatility: 'Emotional volatility', impulsivity: 'Impulsivity', compulsivity: 'Compulsivity',
        suspiciousness: 'Suspiciousness', disinhibition: 'Disinhibition', noveltySeeking: 'Novelty seeking',
        empathy: 'Empathy', selfRestraint: 'Self-restraint'
    });
    const DEFAULT_AXES = Object.freeze({fixation:15,jealousy:20,rejectionSensitivity:35,affectVolatility:35,
        impulsivity:35,compulsivity:20,suspiciousness:20,disinhibition:20,noveltySeeking:45,empathy:65,selfRestraint:60});
    const EFFECTS = Object.freeze({
        fixation:'fixation / pursuit', jealousy:'jealousy / rivalry', anxiety:'anxiety / reassurance seeking',
        compulsion:'compulsive urge', suspicion:'suspicion / checking', anger:'anger / confrontation',
        avoidance:'withdrawal / avoidance', arousal:'adult sexual arousal', affection:'affection / approach',
        disinhibition:'disinhibition / risk taking'
    });
    if (!library?.PRESETS) throw new Error('VHMindLibrary must load before VHMindEngine.');
    const PRESETS = library.PRESETS;
    const CATEGORIES = library.CATEGORIES || [...new Set(Object.values(PRESETS).map(item => item.category))];

    function normalizeTrigger(raw, index = 0) {
        const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
        const cues = unique((Array.isArray(source.cues) ? source.cues : String(source.cues || '').split(','))
            .map(item => text(item, 80).toLowerCase())).slice(0, 24);
        return {id:text(source.id,80)||`trigger_${index}`,label:text(source.label,100)||`Trigger ${index+1}`,cues,
            effect:Object.hasOwn(EFFECTS,source.effect)?source.effect:'anxiety',intensity:clamp(source.intensity == null?60:source.intensity),
            cooldownMinutes:clamp(source.cooldownMinutes == null?45:source.cooldownMinutes,0,10080),
            expression:text(source.expression,500),aftermath:text(source.aftermath,400),adultOnly:source.adultOnly===true};
    }
    function normalizeProfile(raw = {}) {
        const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
        const mix = (Array.isArray(source.presetMix) ? source.presetMix : []).filter(item => item && PRESETS[item.id])
            .map(item => ({id:item.id,intensity:clamp(item.intensity == null?70:item.intensity)})).slice(0,24);
        const deduped = [...new Map(mix.map(item => [item.id,item])).values()];
        const axes = {};
        for (const key of Object.keys(AXES)) if (Number.isFinite(Number(source.axes?.[key]))) axes[key]=clamp(source.axes[key]);
        return {version:1,enabled:source.enabled===true || deduped.length>0 || (Array.isArray(source.triggers)&&source.triggers.length>0),
            presetMix:deduped,axes,triggers:(Array.isArray(source.triggers)?source.triggers:[]).map(normalizeTrigger)
                .filter(item=>item.cues.length).slice(0,80)};
    }
    function normalizeRuntime(raw = {}, now = Date.now()) {
        const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
        const cooldowns = {};
        for (const [key,value] of Object.entries(source.cooldowns || {})) if (Number.isFinite(Number(value)) && Number(value)>now-30*86400000) cooldowns[text(key,160)]=Number(value);
        const activePressures=(Array.isArray(source.activePressures)?source.activePressures:[]).filter(item=>item&&Number(item.expiresAt)>now)
            .map((item,index)=>({id:text(item.id,120)||`pressure_${index}`,triggerId:text(item.triggerId,120),label:text(item.label,120),effect:Object.hasOwn(EFFECTS,item.effect)?item.effect:'anxiety',
                activation:clamp(item.activation),urge:text(item.urge,500),aftermath:text(item.aftermath,400),adultOnly:item.adultOnly===true,
                startedAt:Math.max(0,Number(item.startedAt)||now),expiresAt:Math.max(now+1,Number(item.expiresAt)||now+3600000)})).slice(-20);
        return {version:1,cooldowns,activePressures,lastEvaluatedAt:Math.max(0,Number(source.lastEvaluatedAt)||0),lastInputId:text(source.lastInputId,120)};
    }
    function resolvedAxes(raw) {
        const profile=normalizeProfile(raw),resolved={...DEFAULT_AXES};
        for (const item of profile.presetMix) {
            const preset=PRESETS[item.id],weight=item.intensity/100;
            for (const [axis,target] of Object.entries(preset.axes||{})) resolved[axis]=clamp(resolved[axis]+(target-DEFAULT_AXES[axis])*weight);
        }
        for (const [axis,value] of Object.entries(profile.axes)) resolved[axis]=clamp(value);
        return Object.fromEntries(Object.entries(resolved).map(([key,value])=>[key,Math.round(value)]));
    }
    function configuredTriggers(raw) {
        const profile=normalizeProfile(raw),out=[...profile.triggers.map(item=>({...item,source:'custom',sourceIntensity:100}))];
        for (const mix of profile.presetMix) for (const item of PRESETS[mix.id].triggers||[]) out.push({...item,source:mix.id,sourceIntensity:mix.intensity});
        return out;
    }
    function mechanics(rawProfile, rawRuntime, context = {}) {
        const profile=normalizeProfile(rawProfile),runtime=normalizeRuntime(rawRuntime,Number(context.now)||Date.now());
        const adultAllowed=Number(context.age)>=18&&context.libidoEnabled===true;
        const result={initiativeMultiplier:1,replyMultiplier:1,activityBias:{},termBias:{},notes:[],activeModuleIds:[]};
        for(const mix of profile.presetMix){
            const item=PRESETS[mix.id];if(!item||item.adultOnly&&!adultAllowed)continue;
            const weight=clamp(mix.intensity)/100,m=item.mechanics||{};result.activeModuleIds.push(mix.id);
            if(Number.isFinite(m.initiativeMultiplier))result.initiativeMultiplier*=1+(m.initiativeMultiplier-1)*weight;
            if(Number.isFinite(m.replyMultiplier))result.replyMultiplier*=1+(m.replyMultiplier-1)*weight;
            for(const [kind,value] of Object.entries(m.activityBias||{}))result.activityBias[kind]=(result.activityBias[kind]||0)+Number(value||0)*weight;
            for(const [term,value] of Object.entries(m.termBias||{}))result.termBias[term]=(result.termBias[term]||0)+Number(value||0)*weight;
            result.notes.push(...(m.notes||[]).map(note=>`${item.label}: ${note}`));
        }
        if(Object.hasOwn(profile.axes,'fixation'))result.initiativeMultiplier*=clamp(1-clamp(profile.axes.fixation)*.0045,.55,1);
        const approachEffects=new Set(['fixation','jealousy','anxiety','compulsion','suspicion','affection']);
        const activeDrive=runtime.activePressures.filter(item=>approachEffects.has(item.effect)&&(!item.adultOnly||adultAllowed))
            .reduce((strongest,item)=>Math.max(strongest,Number(item.activation)||0),0);
        result.initiativeMultiplier*=clamp(1-activeDrive*.004,.62,1);
        result.initiativeMultiplier=clamp(result.initiativeMultiplier,.3,3);
        result.replyMultiplier=clamp(result.replyMultiplier,.45,3);
        result.notes=unique(result.notes).slice(0,20);
        return result;
    }
    function activityScore(rawProfile, goal, context = {}) {
        const resolved=mechanics(rawProfile,context.runtime,context),label=`${goal?.label||''} ${goal?.id||''} ${goal?.definitionKey||''}`.toLowerCase();
        let score=Number(resolved.activityBias[goal?.kind])||0;
        for(const [term,value] of Object.entries(resolved.termBias))if(label.includes(term.toLowerCase()))score+=Number(value)||0;
        return Math.round(clamp(score,-100,100)*100)/100;
    }
    function contextSnapshot(rawProfile, rawRuntime, context = {}) {
        const profile=normalizeProfile(rawProfile),runtime=normalizeRuntime(rawRuntime,Number(context.now)||Date.now()),axes=resolvedAxes(profile);
        const adultAllowed=Number(context.age)>=18&&context.libidoEnabled===true;
        const modules=profile.presetMix.map(mix=>{const item=PRESETS[mix.id];return {id:mix.id,label:item.label,category:item.category,
            intensity:Math.round(mix.intensity),summary:item.summary,behaviors:(item.behaviors||[]).slice(0,8),clinical:item.clinical===true,
            hazardous:item.hazardous===true,consentRisk:item.consentRisk===true,adultOnly:item.adultOnly===true,active:!item.adultOnly||adultAllowed};});
        return {enabled:profile.enabled,modules,axes,activePressures:runtime.activePressures,mechanics:mechanics(profile,runtime,context),
            guardrails:{adultAllowed,pressureIsNotCommand:true,desireIsNotConsent:true,clinicalDoesNotImplyDanger:true}};
    }
    function searchPresets(query = '', category = 'all', sort = 'relevance') {
        const needle=String(query||'').trim().toLowerCase();
        const rows=Object.entries(PRESETS).map(([id,item])=>{const searchable=[id,item.label,item.category,item.summary,...(item.tags||[]),...(item.aliases||[]),...(item.behaviors||[])].join(' ').toLowerCase();
            let relevance=!needle?0:searchable.includes(needle)?1:0;if(needle&&item.label.toLowerCase().includes(needle))relevance+=4;if(needle&&(item.tags||[]).some(tag=>tag.toLowerCase().includes(needle)))relevance+=3;if(needle&&(item.aliases||[]).some(alias=>alias.toLowerCase().includes(needle)))relevance+=5;
            return {id,...item,relevance};}).filter(item=>(category==='all'||item.category===category)&&(!needle||item.relevance>0));
        rows.sort(sort==='a-z'?(a,b)=>a.label.localeCompare(b.label):sort==='category'?(a,b)=>a.category.localeCompare(b.category)||a.label.localeCompare(b.label):(a,b)=>b.relevance-a.relevance||CATEGORIES.indexOf(a.category)-CATEGORIES.indexOf(b.category)||a.label.localeCompare(b.label));
        return rows;
    }
    function catalogForPrompt() {
        return CATEGORIES.map(category=>`${category}: ${Object.entries(PRESETS).filter(([,item])=>item.category===category).map(([id,item])=>`${id} (${item.label})`).join(', ')}`).join('\n');
    }
    function cueMatches(input, cue) {
        const phrase=String(cue||'').trim().toLowerCase();if(!phrase)return false;
        if (/^[a-z0-9 ]+$/i.test(phrase)) return new RegExp(`(^|[^a-z0-9])${phrase.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}([^a-z0-9]|$)`,'i').test(input);
        return input.includes(phrase);
    }
    function evaluate(rawProfile, rawRuntime, input, context = {}) {
        const profile=normalizeProfile(rawProfile),now=Math.max(1,Number(context.now)||Date.now()),runtime=normalizeRuntime(rawRuntime,now);
        const inputText=String(input||'').toLowerCase().slice(0,12000),inputId=text(context.inputId,120);
        if(!profile.enabled||!inputText||inputId&&runtime.lastInputId===inputId)return {profile,runtime,matched:[],deltas:{anger:0,stress:0,sexualArousal:0,inhibition:0}};
        const axes=resolvedAxes(profile),adultAllowed=Number(context.age)>=18&&context.libidoEnabled===true,matched=[];
        for(const item of configuredTriggers(profile)){
            if(item.adultOnly&&!adultAllowed)continue;
            const key=`${item.source}:${item.id}`;if(Number(runtime.cooldowns[key])>now)continue;
            const hit=item.cues.find(cue=>cueMatches(inputText,cue));if(!hit)continue;
            const sourceWeight=clamp(item.sourceIntensity==null?100:item.sourceIntensity)/100;
            const restraint=axes.selfRestraint*0.6+axes.empathy*0.2;
            const activation=clamp(Number(item.intensity)*sourceWeight*(1.12-restraint/420));
            const duration=Math.max(10,Math.round((Number(item.cooldownMinutes)||45)*(0.7+activation/140)));
            const pressure={id:`${key}:${now}`,triggerId:key,label:item.label,effect:item.effect,activation:Math.round(activation),
                cue:hit,urge:item.expression||EFFECTS[item.effect],aftermath:item.aftermath||'',adultOnly:item.adultOnly===true,
                startedAt:now,expiresAt:now+duration*60000};
            runtime.activePressures=runtime.activePressures.filter(existing=>existing.triggerId!==key);runtime.activePressures.push(pressure);
            runtime.cooldowns[key]=now+(Number(item.cooldownMinutes)||45)*60000;matched.push(pressure);
        }
        runtime.activePressures=runtime.activePressures.slice(-20);runtime.lastEvaluatedAt=now;runtime.lastInputId=inputId;
        const strongest=matched.reduce((max,item)=>Math.max(max,item.activation),0),effects=new Set(matched.map(item=>item.effect));
        return {profile,runtime,matched,deltas:{anger:effects.has('anger')?Math.round(strongest*.18):0,
            stress:effects.size?Math.round(strongest*.1):0,sexualArousal:effects.has('arousal')?Math.round(strongest*.42):0,
            inhibition:effects.has('disinhibition')?-Math.round(strongest*.18):0}};
    }
    function prompt(rawProfile, rawRuntime, context = {}) {
        const profile=normalizeProfile(rawProfile);if(!profile.enabled)return '';
        const now=Math.max(1,Number(context.now)||Date.now()),runtime=normalizeRuntime(rawRuntime,now),axes=resolvedAxes(profile);
        const adultAllowed=Number(context.age)>=18&&context.libidoEnabled===true;
        const mixes=profile.presetMix.map(item=>`${PRESETS[item.id].label} ${Math.round(item.intensity)}/100${PRESETS[item.id].adultOnly&&!adultAllowed?' (inactive: adult desire disabled)':''}`).join('; ')||'custom dimensions and triggers only';
        const behaviors=unique(profile.presetMix.filter(item=>!PRESETS[item.id].adultOnly||adultAllowed).flatMap(item=>PRESETS[item.id].behaviors||[])).slice(0,12);
        const active=runtime.activePressures.map(item=>`${item.label}: ${item.activation}/100 pressure toward ${item.urge}${item.aftermath?`; likely aftermath: ${item.aftermath}`:''}`).join('\n- ');
        const resolvedMechanics=mechanics(profile,runtime,context),clinical=profile.presetMix.some(item=>PRESETS[item.id].clinical),adult=profile.presetMix.some(item=>PRESETS[item.id].adultOnly);
        return `MIND ARCHITECTURE (private behavioral mechanics):\nMix: ${mixes}.\nResolved tendencies: ${Object.entries(axes).map(([key,value])=>`${AXES[key]} ${value}/100`).join('; ')}.\nRecurring patterns: ${behaviors.join('; ')||'none authored'}.\nSimulation consequences: ${resolvedMechanics.notes.join('; ')||'no additional continuous bias; cue and tendency mechanics still apply'}.\n${active?`Active cue pressures:\n- ${active}`:'No configured cue is mechanically active this turn.'}\nA pressure is an urge, salience shift or bodily reaction—not a command. Decide whether to express, mask, redirect, ritualize, resist, regret or act on it using current restraint, values, boundaries, circumstances and consequences. Let high activation have visible behavioral cost; do not flatten it into polite normality. Never print scores or engine language. Desire and arousal are not consent, permission, attraction, love or proof of reciprocity.${clinical?' Clinical-lived-experience modules are fallible characterization aids: symptoms vary, ordinary functioning still exists, and no diagnosis here implies violence, stalking, sexuality or a split personality.':''}${adult?' Consensual adult interests are not disorders by default. Adult modules remain inactive unless age and the separate adult-desire system allow them.':''}`;
    }
    function addPreset(raw, id, intensity = 70) {
        const profile=normalizeProfile(raw);if(!PRESETS[id])return profile;
        const existing=profile.presetMix.find(item=>item.id===id);if(existing)existing.intensity=clamp(intensity);else profile.presetMix.push({id,intensity:clamp(intensity)});
        profile.enabled=true;return normalizeProfile(profile);
    }
    return {AXES,DEFAULT_AXES,EFFECTS,PRESETS,CATEGORIES,normalizeProfile,normalizeRuntime,resolvedAxes,configuredTriggers,
        mechanics,activityScore,contextSnapshot,searchPresets,catalogForPrompt,evaluate,prompt,addPreset,normalizeTrigger,slug};
});
