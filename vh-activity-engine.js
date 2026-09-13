/* Shared, deterministic activity kernel. No DOM, wall clock, providers, or prose parsing. */
(function (root, factory) {
    const engine = factory();
    if (typeof module === 'object' && module.exports) module.exports = engine;
    else root.VHActivityEngine = engine;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0));
    const resources = raw => Object.fromEntries(Object.entries(raw || {}).slice(0, 30)
        .filter(([key]) => /^[a-z][a-z0-9_]{0,39}$/.test(key) && !['constructor', 'prototype'].includes(key))
        .map(([key, value]) => [key, clamp(value, 0, 10000)]));
    function breakPolicy(raw={}) {
        raw=raw&&typeof raw==='object'?raw:{};
        return {enabled:raw.enabled!==false,intervalMinutes:clamp(raw.intervalMinutes??120,30,360),mealMinutes:clamp(raw.mealMinutes??25,10,60),restMinutes:clamp(raw.restMinutes??15,5,45),foodAvailable:raw.foodAvailable!==false,hungerThreshold:clamp(raw.hungerThreshold??65,40,95)};
    }
    function normalizeBreak(raw={}) {
        raw=raw&&typeof raw==='object'?raw:{};
        return {goalId:String(raw.goalId||'').slice(0,100),blockKey:String(raw.blockKey||'').slice(0,160),startedAt:clamp(raw.startedAt,0,9e15),endsAt:clamp(raw.endsAt,0,9e15),lastEndedAt:clamp(raw.lastEndedAt,0,9e15)};
    }
    function advanceBreak(state,now,context={}) {
        const p=breakPolicy(context.policy),b=state.break=normalizeBreak(state.break),s=context.situation||{};
        const key=`${Math.floor(s.startedAt/60000)}:${s.blockId||''}`;
        if(b.goalId&&(now>=b.endsAt||key!==b.blockKey||s.source!=='schedule'||!p.enabled||s.breakAllowed===false)){
            const goal=state.goals.find(g=>g.id===b.goalId);
            if(goal){if(!['completed','abandoned'].includes(goal.status)){goal.status='abandoned';goal.reason='The break ended before this action finished.';}event(state,goal,'break_ended',now,'The break ended; the scheduled obligation resumes.');}
            b.lastEndedAt=now;b.goalId='';
        }
        if(b.goalId||!p.enabled||s.source!=='schedule'||s.availability!=='busy'||s.breakAllowed===false)return b;
        if(now-Math.max(s.startedAt,b.lastEndedAt)<p.intervalMinutes*60000)return b;
        const meal=p.foodAvailable&&context.hunger>=p.hungerThreshold,rest=context.energy<30||context.stress>75;
        if(!meal&&!rest)return b;
        const duration=(meal?p.mealMinutes:p.restMinutes)*60000;
        if(s.endsAt-now<duration)return b;
        const goal=addGoal(state,meal?'meal':'recovery',`break:${now}`,now,meal?'Eat available food during a break':'Take a restorative break');
        goal.requiredPlaceId=s.placeId||'';goal.expiresAt=now+duration;goal.priority=100;
        goal.steps=[{label:goal.label,durationMs:duration,progressMs:0,energy:meal?6:12,stress:-6,hunger:meal?-50:0,costs:{},produces:{},charged:false}];
        Object.assign(b,{goalId:goal.id,blockKey:key,startedAt:now,endsAt:now+duration});
        event(state,goal,'break_started',now,meal?'Hunger prompted an allowed meal break using food available here.':'Fatigue or stress prompted an allowed restorative break.');
        return b;
    }
    function sleepPolicy(raw={}) {
        return {enabled:raw?.enabled!==false,pressurePerHour:clamp(raw?.pressurePerHour??4.2,1,10),recoveryPerHour:clamp(raw?.recoveryPerHour??9,3,20),windDownMinutes:clamp(raw?.windDownMinutes??10,5,60),sleepNeedHours:clamp(raw?.sleepNeedHours??8,4,12),napCutoffHours:clamp(raw?.napCutoffHours??3,0,6),stimulationResistance:clamp(raw?.stimulationResistance??12,0,25),hungerSensitivity:clamp(raw?.hungerSensitivity??1,0,2)};
    }
    function normalizeSleep(raw){
        if(!raw||typeof raw!=='object')return null;
        return {initializationVersion:raw.initializationVersion===2?2:0,stage:['awake','tired','drowsy','winding_down','asleep','waking'].includes(raw.stage)?raw.stage:'awake',pressure:clamp(raw.pressure,0,100),debtHours:clamp(raw.debtHours,0,48),lastAt:clamp(raw.lastAt,0,9e15),lastWakeAt:clamp(raw.lastWakeAt,0,9e15),sleepStartedAt:clamp(raw.sleepStartedAt,0,9e15),windDownAt:clamp(raw.windDownAt,0,9e15),wakeAt:clamp(raw.wakeAt,0,9e15),nap:raw.nap===true,irritability:clamp(raw.irritability,0,100)};
    }
    function advanceSleep(raw,now,context={}){
        const p=sleepPolicy(context.policy);let s=normalizeSleep(raw);
        if(!s){
            const sleeping=!!context.wasAsleep&&!context.engaged;
            // Before the preferred wake time, an awake starting character may have
            // risen early. A modulo clock offset is not evidence of an all-nighter.
            const sinceWake=!sleeping&&context.preferred?0:clamp(context.hoursSinceWake??8,0,24);
            s=normalizeSleep({initializationVersion:2,stage:sleeping?'asleep':'awake',pressure:Math.max(sinceWake*p.pressurePerHour,(100-(context.energy??70))*.5),lastAt:now,lastWakeAt:now-sinceWake*3600000,sleepStartedAt:sleeping?now-clamp(context.hoursIntoSleep,0,12)*3600000:0});
            if(sleeping)s.pressure=clamp(80-clamp(context.hoursIntoSleep,0,12)*p.recoveryPerHour,0,100);
        }
        if(now<=s.lastAt)return s;
        const hours=Math.min(1,(now-s.lastAt)/3600000),wasSleeping=s.stage==='asleep';
        if(wasSleeping){
            s.pressure=clamp(s.pressure-p.recoveryPerHour*hours,0,100);s.debtHours=clamp(s.debtHours-hours*.7,0,48);
            const slept=(now-s.sleepStartedAt)/3600000;
            const wake=s.nap?slept>=.5&&(s.pressure<85||slept>=1.5):slept>=p.sleepNeedHours||slept>=Math.min(4,p.sleepNeedHours)&&s.pressure<25&&!context.preferred;
            if(wake){s.stage='waking';s.wakeAt=now;s.lastWakeAt=now;}
        }else{
            s.pressure=clamp(s.pressure+p.pressurePerHour*hours,0,100);
            if(now-s.lastWakeAt>16*3600000)s.debtHours=clamp(s.debtHours+hours,0,48);
            const score=s.pressure+(context.preferred?16:0)+s.debtHours*2+Math.max(0,30-(context.energy??70))*.6+(context.boring&&s.pressure>50?7:0)-(context.engaged?p.stimulationResistance:0)-Math.max(0,(context.stress??0)-65)*.15;
            if(s.stage==='waking'&&now-s.wakeAt<20*60000){/* Sleep inertia passes gradually. */}
            else if(s.stage==='winding_down'){
                if(!context.canRest){s.stage='drowsy';s.windDownAt=0;}
                else if(now-s.windDownAt>=p.windDownMinutes*60000){s.stage='asleep';s.sleepStartedAt=now;s.nap=!context.preferred&&!(context.hoursUntilBed>=0&&context.hoursUntilBed<=p.napCutoffHours);s.windDownAt=0;}
            }else if(score>=80&&context.canRest&&(!context.occupied||s.pressure>=95)){
                s.stage='winding_down';s.windDownAt=now;
            }else s.stage=score>=65?'drowsy':score>=48?'tired':'awake';
        }
        const hunger=clamp(context.hunger,0,100);
        s.irritability=clamp(Math.max(0,s.pressure-45)*.45+s.debtHours*3+Math.max(0,hunger-55)*.7*p.hungerSensitivity+(s.stage==='waking'?10:0),0,100);
        s.lastAt=now;return s;
    }
    function policy(raw = {}) {
        const defaults={needWeight:1,commitmentWeight:1,personalityWeight:1,habitWeight:6,inertia:18,variation:8,minimumRunMinutes:5,conscientiousness:50,sociability:50};
        return Object.fromEntries(Object.entries(defaults).map(([key,value])=>[key,clamp(raw?.[key]??value,0,key.endsWith('Weight')&&key!=='habitWeight'?3:key==='minimumRunMinutes'?30:100)]));
    }
    function resourcePressure(state,now,context={}) {
        const pressure={};
        const demand=(key,quantity,weight)=>{if((state.resources[key]||0)<quantity)pressure[key]=Math.max(pressure[key]||0,weight);};
        for(const target of context.requirements||[]){
            if(target.endsAt<=now||target.dueAt>now+2*3600000)continue;
            const urgency=clamp(1-(target.dueAt-now)/3600000,0,2)*45*policy(context.policy).commitmentWeight;
            for(const [key,quantity] of Object.entries(resources(target.resources)))demand(key,quantity,urgency);
        }
        const goals=state.goals.filter(g=>!['completed','abandoned'].includes(g.status)&&g.notBefore<=now&&(!g.expiresAt||g.expiresAt>now));
        for(const goal of goals){const step=goal.steps[goal.stepIndex];if(step&&!step.charged)for(const [key,n] of Object.entries(step.costs))demand(key,n,Math.max(0,utility(goal,state,now,{...context,resourcePressure:{}}).score));}
        // Bounded backward propagation promotes prerequisites, never grants their outputs.
        for(let depth=0;depth<4;depth++){
            let changed=false;
            for(const goal of goals){const reward=Math.max(0,...goal.steps.slice(goal.stepIndex).flatMap(s=>Object.entries(s.produces).filter(([,n])=>n>0).map(([k])=>pressure[k]||0)))*.85;
                const step=goal.steps[goal.stepIndex];if(!step||step.charged||!reward)continue;
                for(const [key,n] of Object.entries(step.costs)){const prior=pressure[key]||0;demand(key,n,reward);if(pressure[key]!==prior)changed=true;}
            }
            if(!changed)break;
        }
        return pressure;
    }
    function utility(goal,state,now,context={}) {
        const p=policy(context.policy),step=goal.steps[goal.stepIndex];
        const remaining=goal.steps.slice(goal.stepIndex).reduce((n,s)=>n+Math.max(0,s.durationMs-s.progressMs),0);
        const energy=clamp(context.energy??70,0,100),hunger=clamp(context.hunger,0,100),stress=clamp(context.stress,0,100);
        const effect=goal.steps.slice(goal.stepIndex).reduce((total,s)=>{for(const key of ['energy','stress','hunger'])total[key]+=Number(s[key])||0;return total;},{energy:0,stress:0,hunger:0});
        const relief=hunger*.7*Math.min(1.5,Math.max(0,-effect.hunger)/60)
            +(100-energy)*.6*Math.min(1.5,Math.max(0,effect.energy)/18)
            +stress*.25*Math.min(1.5,Math.max(0,-effect.stress)/8)
            +(goal.kind==='contact'?clamp(context.socialNeed,0,100)*(.2+p.sociability/250):0);
        const urgency=goal.commitmentId&&goal.deadline?clamp(1-(goal.deadline-now-remaining)/3600000,0,2)*35*p.commitmentWeight:0;
        const habit=state.learning.find(x=>x.id===goal.opportunityId&&(!x.definitionKey||x.definitionKey===goal.definitionKey));
        const count=(habit?.completed||0)+(habit?.missed||0);
        const learned=goal.learningEnabled&&count>=3?(habit.completed-habit.missed)/count*p.habitWeight:0;
        const continuing=goal.status==='active' ? p.inertia+(now-(goal.startedAt||now)<p.minimumRunMinutes*60000?p.inertia:0):0;
        const appointment=context.nextCommitmentAt>now?context.nextCommitmentAt-now:Infinity;
        const timeCost=!goal.commitmentId&&remaining>appointment?Math.min(25,(remaining-appointment)/60000):0;
        const effort=Math.max(0,-(step?.energy||0))*(100-energy)/100;
        const pressure=Math.max(hunger,100-energy,stress,urgency);
        const noise=(roll(`${context.seed||''}|${goal.id}|${Math.floor(now/300000)}`)-.5)*p.variation*(1-Math.min(1,pressure/100));
        const dependency=Math.max(0,...goal.steps.slice(goal.stepIndex).flatMap(s=>Object.entries(s.produces).filter(([,n])=>n>0).map(([k])=>context.resourcePressure?.[k]||0)));
        const components={preparation:dependency,preference:goal.priority*.5,needs:relief*p.needWeight,commitment:urgency,habit:learned,continuation:continuing,effort:effort?-effort:0,time:timeCost?-timeCost:0,variation:noise||0};
        const urgencyScale=1-Math.min(1,Math.max(hunger,100-energy,stress)/100);
        components.preference+=(goal.kind==='focus'||goal.kind==='preparation'?(p.conscientiousness-50)*.6:goal.kind==='contact'?(p.sociability-50)*.6:goal.kind==='leisure'?(50-p.conscientiousness)*.3:0)*urgencyScale*p.personalityWeight;
        return {score:Object.values(components).reduce((a,b)=>a+b,0),components};
    }
    function normalize(raw = {}) {
        return {
            break:normalizeBreak(raw?.break),
            projects: (Array.isArray(raw?.projects) ? raw.projects : []).filter(p=>p && typeof p==='object').slice(-32).map(p=>({id:String(p.id||'').slice(0,80),label:String(p.label||'').slice(0,200),targetMs:clamp(p.targetMs,0,6e9),progressMs:clamp(p.progressMs,0,6e9),completedAt:clamp(p.completedAt,0,9e15)})),
            learning: (Array.isArray(raw?.learning) ? raw.learning : []).filter(p=>p && typeof p==='object').slice(-32).map(p=>({id:String(p.id||'').slice(0,80),definitionKey:String(p.definitionKey||'').slice(0,30),completed:clamp(p.completed,0,10000),missed:clamp(p.missed,0,10000)})),
            decision: raw?.decision && typeof raw.decision==='object' ? {at:clamp(raw.decision.at,0,9e15),goalId:String(raw.decision.goalId||'').slice(0,100),score:clamp(raw.decision.score,-1000,1000),components:Object.fromEntries(Object.entries(raw.decision.components||{}).filter(([k,v])=>['preparation','preference','needs','commitment','habit','continuation','effort','time','variation'].includes(k)&&Number.isFinite(v))),reason:String(raw.decision.reason||'').slice(0,300)} : null,
            selectorVersion:raw?.selectorVersion===1?1:0,
            version: 4, catalogKey: String(raw?.catalogKey || '').slice(0, 30), conversationUntil: clamp(raw?.conversationUntil, 0, 9e15),
            attentionReservationKey: String(raw?.attentionReservationKey || '').slice(0, 1000), plannerStartedAt: clamp(raw?.plannerStartedAt, 0, 9e15), plannedDays: (Array.isArray(raw?.plannedDays) ? raw.plannedDays : []).map(String).slice(-7), lastAdvancedAt: clamp(raw?.lastAdvancedAt, 0, 9e15),
            suppliesSeeded:raw?.suppliesSeeded===true,
            resources: resources(raw?.resources),
            goals: (Array.isArray(raw?.goals) ? raw.goals : []).filter(goal => goal && typeof goal === 'object').slice(-60).map(goal => ({
                id: String(goal.id || '').slice(0, 100), label: String(goal.label || '').slice(0, 200),
                kind: ['recovery', 'meal', 'focus', 'leisure', 'contact', 'preparation'].includes(goal.kind) ? goal.kind : 'focus',
                definitionKey: String(goal.definitionKey || '').slice(0, 30),
                projectId: String(goal.projectId || '').slice(0,80), learningEnabled: goal.learningEnabled === true, learningRecorded: goal.learningRecorded === true,
                opportunityId: String(goal.opportunityId || '').slice(0, 80),
                startedAt:clamp(goal.startedAt,0,9e15), requiredPlaceId:String(goal.requiredPlaceId||'').slice(0,80),
                participantId: String(goal.participantId || '').slice(0, 80),
                commitmentId: String(goal.commitmentId || '').slice(0, 100),
                meetingId: String(goal.meetingId || '').slice(0,100),
                notBefore: clamp(goal.notBefore, 0, 9e15), expiresAt: clamp(goal.expiresAt, 0, 9e15),
                minEnergy: clamp(goal.minEnergy, 0, 100),
                priority: clamp(goal.priority, 0, 100), createdAt: clamp(goal.createdAt, 0, 9e15),
                deadline: clamp(goal.deadline, 0, 9e15), completedAt: clamp(goal.completedAt, 0, 9e15),
                status: ['planned', 'active', 'paused', 'blocked', 'completed', 'abandoned'].includes(goal.status) ? goal.status : 'planned',
                reason: String(goal.reason || '').slice(0, 300),
                stepIndex: Math.floor(clamp(goal.stepIndex, 0, 20)),
                steps: (Array.isArray(goal.steps) ? goal.steps : []).filter(step => step && typeof step === 'object').slice(0, 20).map(step => ({
                    label: String(step.label || 'Working on the goal').slice(0, 200),
                    durationMs: clamp(step.durationMs, goal.projectId ? 1 : 60000, 24 * 3600000),
                    progressMs: clamp(step.progressMs, 0, 24 * 3600000),
                    costs: resources(step.costs), produces: resources(step.produces), charged: step.charged === true,
                    energy: clamp(step.energy, -30, 30), stress: clamp(step.stress, -30, 30), hunger: clamp(step.hunger, -100, 100)
                }))
            })).filter(goal => goal.id && goal.label && goal.steps.length),
            events: (Array.isArray(raw?.events) ? raw.events : []).filter(event => event && typeof event === 'object').slice(-150).map(event => ({
                id: String(event.id || '').slice(0, 160), at: clamp(event.at, 0, 9e15),
                goalId: String(event.goalId || '').slice(0, 100), kind: String(event.kind || '').slice(0, 30),
                summary: String(event.summary || '').slice(0, 400)
            }))
        };
    }
    function addGoal(state, kind, id, now, label = '') {
        label = String(label || '');
        if (state.goals.some(goal => goal.id === id)) return null;
        const step = (label, minutes, energy, stress, costs = {}, produces = {}) => ({
            label, durationMs: minutes * 60000, progressMs: 0, energy, stress, hunger: 0, costs, produces, charged: false
        });
        const recipes = {
            recovery: { label: 'Rest and recover', priority: 65, steps: [step('Taking a restorative break', 20, 18, -8)] },
            meal: { label: 'Prepare and eat a meal', priority: 50, steps: [
                step('Getting ingredients', 20, -3, 0, {}, { ingredients: 1 }),
                step('Preparing a meal', 25, -4, 0, { ingredients: 1 }, { meal: 1 }),
                { ...step('Eating the prepared meal', 15, 12, -3, { meal: 1 }), hunger: -60 }
            ] },
            leisure: { label: 'Take time for a personal interest', priority: 35, steps: [step('Enjoying a personal interest', 25, -2, -6)] },
            contact: { label: 'Have a conversation with someone in their life', priority: 55, steps: [step('Talking with a familiar person', 15, -2, -2)] },
            preparation: { label: 'Prepare for a promise', priority: 70, steps: [step('Making time to prepare for a promise', 10, -2, 0)] },
            focus: { label: 'Make progress on a personal task', priority: 45,
                steps: [step('Spending focused time on a personal task', 30, -8, -2)] }
        };
        const recipe = recipes[kind];
        if (!recipe) return null;
        if (['leisure', 'contact', 'preparation'].includes(kind) && label.trim()) {
            recipe.label = label.trim(); recipe.steps[0].label = label.trim();
        }
        if (kind === 'focus' && label.trim()) {
            recipe.label = `Spend focused time on ${label.trim()}`;
            recipe.steps[0].label = `Working on ${label.trim()}`.slice(0, 200);
        }
        // Retain unfinished goals; discard only old resolved records to make room.
        if (state.goals.length >= 60) {
            const index = state.goals.findIndex(goal => ['completed', 'abandoned'].includes(goal.status));
            if (index < 0) return null;
            state.goals.splice(index, 1);
        }
        const goal = { id, kind, meetingId: '', startedAt:0, requiredPlaceId:'', projectId: '', learningEnabled: false, learningRecorded: false, definitionKey: '', opportunityId: '', participantId: '', commitmentId: '', notBefore: 0, expiresAt: 0, minEnergy: 0, label: String(recipe.label).slice(0, 200), priority: recipe.priority,
            createdAt: now, deadline: 0, completedAt: 0, status: 'planned', reason: 'Waiting for an opportunity.',
            stepIndex: 0, steps: recipe.steps };
        state.goals.push(goal);
        return goal;
    }
    function event(state, goal, kind, at, summary, suffix = '') {
        const id = `${goal.id}:${kind}:${suffix || at}`;
        if (state.events.some(item => item.id === id)) return;
        if (['completed','missed'].includes(kind) && goal.learningEnabled && goal.opportunityId && !goal.learningRecorded) {
            state.learning ||= [];
            let learned = state.learning.find(item=>item.id===goal.opportunityId && item.definitionKey===goal.definitionKey);
            if (!learned) { learned={id:goal.opportunityId,definitionKey:goal.definitionKey,completed:0,missed:0}; state.learning.push(learned); state.learning=state.learning.slice(-32); }
            learned[kind] = Math.min(10000,learned[kind]+1); goal.learningRecorded=true;
        }
        state.events.push({ id, goalId: goal.id, kind, at, summary });
        state.events = state.events.slice(-150);
    }
    function advance(state, until, context = {}) {
        let from = state.lastAdvancedAt || until;
        if (until <= from) { if (!state.lastAdvancedAt) state.lastAdvancedAt = until; return { energy: 0, stress: 0, hunger: 0 }; }
        state.lastAdvancedAt = until;
        const delta = { energy: 0, stress: 0, hunger: 0 };
        from = Math.max(from, Math.min(until, state.conversationUntil || 0));
        if (from >= until) return delta;
        const pending = state.goals.filter(goal => !['completed', 'abandoned'].includes(goal.status));
        pending.forEach(goal => {
            if (goal.expiresAt && goal.expiresAt <= from) {
                goal.status = 'abandoned'; goal.reason = 'The opportunity window closed before completion.';
                event(state, goal, 'missed', from, goal.reason, 'window');
            }
        });
        const available = context.availability === 'available';
        if (!available) {
            pending.filter(goal => goal.status === 'active').forEach(goal => {
                goal.status = 'paused'; goal.reason = `Interrupted by ${context.label || context.availability || 'another obligation'}.`;
                event(state, goal, 'paused', from, goal.reason);
            });
            return delta;
        }
        let cursor = from;
        let transitions = 0;
        while (cursor < until && transitions++ < 60) {
            const candidates = pending.filter(goal => (!context.onlyGoalId||goal.id===context.onlyGoalId) && !['completed', 'abandoned'].includes(goal.status) && Math.max(goal.createdAt, goal.notBefore || 0) <= cursor);
            const nextArrival = Math.min(until, ...pending.filter(goal => !['completed', 'abandoned'].includes(goal.status)
                && Math.max(goal.createdAt, goal.notBefore || 0) > cursor).map(goal => Math.max(goal.createdAt, goal.notBefore || 0)));
            const pressure=resourcePressure(state,cursor,context.selectAction?{...context,policy:{...context.policy,variation:0}}:context);
            const choiceContext={...context,resourcePressure:pressure};
            const score=goal=>utility(goal,state,cursor,choiceContext).score;
            candidates.sort((a,b)=>score(b)-score(a)||a.createdAt-b.createdAt||a.id.localeCompare(b.id));
            let selected = null;
            const feasible = [], excluded = [], travelOptions=new Map();
            for (const goal of candidates) {
                if (goal.expiresAt && goal.expiresAt <= cursor) {
                    goal.status = 'abandoned'; goal.reason = 'The opportunity window closed before completion.';
                    event(state, goal, 'missed', cursor, goal.reason, 'window'); continue;
                }
                if(goal.requiredPlaceId&&goal.requiredPlaceId!==context.placeId){
                    const route=context.routeForGoal?.(goal,cursor);
                    if(route)travelOptions.set(goal.id,route);
                    else {goal.status='blocked';goal.reason=context.routeForGoal?'No feasible journey fits this activity, budget and commitments.':'This activity requires its linked location.';excluded.push({id:goal.id,reason:goal.reason});continue;}
                }
                if(goal.meetingId&&!travelOptions.has(goal.id)&&!context.meetingAvailable?.(goal.meetingId,cursor)){goal.status='blocked';goal.reason='Waiting for the shared plan window and both people to be present.';excluded.push({id:goal.id,reason:goal.reason});continue;}
                if (goal.minEnergy && context.energy < goal.minEnergy) { goal.status = 'blocked'; goal.reason = 'Not enough energy for this activity.'; excluded.push({id:goal.id,reason:goal.reason}); continue; }
                if (goal.participantId && !context.availablePeople?.includes(goal.participantId)) {
                    goal.status = 'blocked'; goal.reason = 'The other person is not known to be available.'; excluded.push({id:goal.id,reason:goal.reason}); continue;
                }
                const step = goal.steps[goal.stepIndex];
                if (!step) { goal.status = 'completed'; goal.completedAt = cursor; continue; }
                const missing = !step.charged && Object.entries(step.costs).find(([key, count]) => (state.resources[key] || 0) < count);
                if (missing) { goal.status = 'blocked'; goal.reason = `Missing ${missing[0]}.`; excluded.push({id:goal.id,reason:goal.reason}); continue; }
                if (context.selectAction||context.routeForGoal) feasible.push(goal);
                else { selected = goal; break; }
            }
            const routeScore=goal=>{const value=utility(goal,state,cursor,{...choiceContext,policy:{...choiceContext.policy,...(context.selectAction?{variation:0}:{})}}),penalty=travelOptions.get(goal.id)?.penalty||0;return {...value,score:value.score-penalty,components:{...value.components,travel:-penalty||0}};};
            if (context.selectAction) {
                selected = context.selectAction(feasible, cursor, {...choiceContext,excluded}, routeScore);
                if (selected && !feasible.includes(selected)) throw new Error('Action selector returned an infeasible action');
            }
            if(!context.selectAction&&context.routeForGoal)selected=feasible.sort((a,b)=>routeScore(b).score-routeScore(a).score||a.id.localeCompare(b.id))[0];
            if(selected&&travelOptions.has(selected.id)){
                const route=travelOptions.get(selected.id);
                if(context.startTravel?.(selected,cursor,route)){
                    pauseForContext(state,cursor,'Travelling to the selected activity.');
                    selected.status='paused';selected.reason='Travelling to its linked location.';
                    event(state,selected,'travel_requested',cursor,selected.reason);
                }
                break;
            }
            if (!selected) {
                if (nextArrival < until) { cursor = nextArrival; continue; }
                break;
            }
            const goal = selected, step = goal.steps[goal.stepIndex];
            cursor = Math.max(cursor, goal.createdAt);
            if (cursor >= until) break;
            pending.filter(other => other !== goal && other.status === 'active').forEach(other => {
                other.status = 'paused'; other.reason = `Making room for ${goal.label}.`;
                event(state, other, 'paused', cursor, other.reason);
            });
            if(goal.status!=='active'){const ranked=utility(goal,state,cursor,choiceContext);goal.startedAt=cursor;state.decision={at:cursor,goalId:goal.id,...ranked,reason:Object.entries(ranked.components).filter(([k])=>k!=='variation').sort((a,b)=>b[1]-a[1])[0]?.[0]||'preference'};}
            if (goal.status !== 'active') event(state, goal, 'started', cursor,
                `${step.progressMs ? 'Resumed' : 'Started'} ${step.label}.`);
            goal.status = 'active'; goal.reason = step.label;
            if (!step.charged) {
                Object.entries(step.costs).forEach(([key, count]) => { state.resources[key] -= count; });
                step.charged = true;
            }
            const spent = Math.min(nextArrival - cursor, until - cursor, goal.expiresAt ? goal.expiresAt - cursor : Infinity, Math.max(0, step.durationMs - step.progressMs));
            step.progressMs += spent; cursor += spent;
            const project = goal.projectId && state.projects?.find(item=>item.id===goal.projectId);
            if (project && spent > 0) {
                const fraction=spent/step.durationMs;
                delta.energy += step.energy*fraction; delta.stress += step.stress*fraction; delta.hunger += (Number(step.hunger)||0)*fraction;
                project.progressMs = Math.min(project.targetMs,project.progressMs+spent);
                if (project.progressMs >= project.targetMs && !project.completedAt) {
                    project.completedAt=cursor;
                    event(state,goal,'project_completed',cursor,`Reached the planned work target for ${project.label}.`,project.id);
                }
            }
            if (step.progressMs < step.durationMs) {
                if (cursor < until) continue;
                break;
            }
            Object.entries(step.produces).forEach(([key, count]) => { state.resources[key] = clamp((state.resources[key] || 0) + count,0,10000); });
            if (!project) { delta.energy += step.energy; delta.stress += step.stress; delta.hunger += Number(step.hunger) || 0; }
            event(state, goal, 'step_completed', cursor, `Finished ${step.label}.`, String(goal.stepIndex));
            goal.stepIndex++;
            if (goal.stepIndex >= goal.steps.length) {
                goal.status = 'completed'; goal.completedAt = cursor; goal.reason = 'Every activity step finished.';
                event(state, goal, 'completed', cursor, `Completed ${goal.label}.`, 'done');
            }
        }
        return delta;
    }
    function pauseForContext(state, now, reason) {
        let changed=false;
        for (const goal of state.goals.filter(g=>g.status==='active')) {
            goal.status='paused';goal.reason=String(reason||'Interrupted by an obligation.').slice(0,300);
            event(state,goal,'paused',now,goal.reason);changed=true;
        }
        return changed;
    }
    function reserveAttention(state, now, batchKey, durationMs = 30000) {
        if (!batchKey || state.attentionReservationKey === batchKey) return false;
        const active = state.goals.find(goal => goal.status === 'active');
        // Conversation with someone else is not a solo interruptible task.
        if (!active || active.kind === 'contact') return false;
        state.attentionReservationKey = batchKey;
        state.conversationUntil = Math.max(state.conversationUntil || 0, now + clamp(durationMs, 15000, 120000));
        active.status = 'paused'; active.reason = 'Making room for the current text conversation.';
        event(state, active, 'paused', now, active.reason);
        return true;
    }
    function normalizeOpportunities(value) {
        const seen = new Set();
        return (Array.isArray(value) ? value : []).filter(item => item && typeof item === 'object')
            .slice(0, 16).map((item, index) => ({
                id: String(item.id || `option_${index}`).slice(0, 80),
                label: String(item.label || '').trim().slice(0, 150),
                kind: ['focus', 'leisure', 'contact', 'recovery', 'meal', 'preparation'].includes(item.kind) ? item.kind : 'focus',
                projectMinutes: item.kind === 'focus' ? clamp(item.projectMinutes,0,100000) : 0,
                learnFromOutcomes: item.learnFromOutcomes === true,
                durationMinutes:clamp(item.durationMinutes,0,1440),
                effects:Object.fromEntries(['energy','stress','hunger'].filter(k=>Number.isFinite(item.effects?.[k])).map(k=>[k,clamp(item.effects[k],k==='hunger'?-100:-30,k==='hunger'?100:30)])),
                requiredPlaceId:String(item.requiredPlaceId||'').slice(0,80),repeatMinutes:clamp(item.repeatMinutes,0,10080),
                participantId: String(item.participantId || '').slice(0, 80),
                days: [...new Set((Array.isArray(item.days) ? item.days : [0,1,2,3,4,5,6]).filter(day => Number.isInteger(day) && day >= 0 && day <= 6))],
                startMinute: clamp(item.startMinute ?? 540, 0, 1439), endMinute: clamp(item.endMinute ?? 1320, 1, 1440),
                priority: clamp(item.priority ?? 40, 0, 80), minEnergy: clamp(item.minEnergy ?? 15, 0, 100),
                costs: resources(item.costs), produces:resources(item.produces), reason: String(item.reason || 'A personal interest offers something worthwhile to do.').slice(0, 240)
            })).filter(item => item.label && item.endMinute > item.startMinute && !seen.has(item.id) && seen.add(item.id));
    }
    function roll(seed) {
        let hash = 2166136261;
        for (const ch of String(seed)) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
        return (hash >>> 0) / 4294967296;
    }
    function plan(state, now, context) {
        state.plannedDays ||= [];
        if(state.selectorVersion!==1){
            state.goals=state.goals.filter(g=>!g.opportunityId||g.status!=='planned'||g.steps.some(s=>s.progressMs>0));
            state.plannedDays=[];state.selectorVersion=1;
        }
        const options = normalizeOpportunities(context.opportunities);
        state.projects ||= []; state.learning ||= [];
        for (const option of options.filter(item=>item.projectMinutes>0)) {
            let project=state.projects.find(item=>item.id===option.id);
            if (!project && state.projects.length>=32) continue;
            if (!project) { project={id:option.id,label:option.label,targetMs:option.projectMinutes*60000,progressMs:0,completedAt:0}; state.projects.push(project); }
            project.label=option.label; project.targetMs=option.projectMinutes*60000;
            if (project.progressMs < project.targetMs) project.completedAt=0;
        }
        const definitionKey = item => String(Math.floor(roll(JSON.stringify(item,(key,value) => (key==='projectMinutes' && !value) || (key==='learnFromOutcomes' && !value) || (['durationMinutes','repeatMinutes','requiredPlaceId'].includes(key)&&!value) || (['effects','produces'].includes(key)&&value&&Object.keys(value).length===0) ? undefined : value)) * 4294967296));
        const catalogKey = definitionKey(options);
        if (state.catalogKey && state.catalogKey !== catalogKey) {
            state.plannedDays = [];
            state.goals.filter(goal => goal.opportunityId && !['completed', 'abandoned'].includes(goal.status)).forEach(goal => {
                const option = options.find(item => item.id === goal.opportunityId);
                if (!option || goal.definitionKey !== definitionKey(option)) {
                    goal.status = 'abandoned'; goal.reason = 'This opportunity was changed or removed.';
                    event(state, goal, 'replanned', now, goal.reason);
                }
            });
        }
        state.catalogKey = catalogKey;
        // New/cancelled/rescheduled promises are meaningful replanning inputs.
        // Preparation never claims that the promise itself has been fulfilled.
        const promises = (context.commitments || []).filter(item => item.status === 'pending' && item.dueAt > 0 && (!item.createdAt || item.createdAt <= now));
        state.goals.filter(goal => goal.commitmentId && !['completed', 'abandoned'].includes(goal.status)).forEach(goal => {
            const promise = promises.find(item => item.id === goal.commitmentId);
            if (!promise) { goal.status = 'abandoned'; goal.reason = 'The commitment is no longer pending.'; }
            else { goal.deadline = promise.dueAt; goal.notBefore = Math.max(goal.createdAt, promise.dueAt - 30 * 60000); }
        });
        promises.filter(item => item.dueAt - now <= 24 * 3600000).slice(0, 6).forEach(item => {
            if (state.goals.some(goal => goal.commitmentId === item.id && !['completed', 'abandoned'].includes(goal.status))) return;
            const goal = addGoal(state, 'preparation', `promise:${String(item.id).slice(0, 60)}:${item.dueAt}`, now,
                `Prepare for: ${String(item.text || 'a commitment').slice(0, 120)}`);
            if (goal) { goal.commitmentId = item.id; goal.deadline = item.dueAt; goal.notBefore = Math.max(now, item.dueAt - 30 * 60000); }
        });
        // Opportunities are evaluated when their windows open, not shortlisted for a whole day.
        state.plannedDays=[];
        const midnight = context.midnight;
        const candidates = options.filter(item => (!item.projectMinutes || state.projects.some(p=>p.id===item.id && p.progressMs < item.projectMinutes*60000)) && item.days.includes(context.weekday) && midnight + item.startMinute * 60000 <= now && midnight + item.endMinute * 60000 > now
            && (item.kind !== 'contact' || (context.people || []).some(person => person.id === item.participantId
                && (!person.availableAfter || person.availableAfter < midnight + item.endMinute * 60000))))
            .map(item => ({ item, score: item.priority }))
            .sort((a,b) => b.score - a.score || a.item.id.localeCompare(b.item.id));
        for (const { item, score } of candidates) {
            const existing=state.goals.filter(g=>g.opportunityId===item.id&&g.definitionKey===definitionKey(item));
            if(existing.some(g=>!['completed','abandoned'].includes(g.status)))continue;
            const last=existing.at(-1);
            if(last&&(item.repeatMinutes?now<(last.completedAt||last.expiresAt||last.createdAt)+item.repeatMinutes*60000:last.createdAt>=midnight))continue;
            const person = (context.people || []).find(person => person.id === item.participantId);
            if (item.kind === 'contact' && !person) continue;
            const goal = addGoal(state, item.kind, `option:${context.dateKey}:${item.id.slice(0, 25)}:${definitionKey(item)}:${item.repeatMinutes?now:0}`, now,
                item.kind === 'contact' ? `Talk with ${person.name}` : item.label);
            if (!goal) continue;
            goal.projectId = item.projectMinutes ? item.id : ''; goal.learningEnabled = item.learnFromOutcomes;
            goal.definitionKey = definitionKey(item); goal.opportunityId = item.id; goal.participantId = item.kind === 'contact' ? person.id : '';
            goal.notBefore = Math.max(now, midnight + item.startMinute * 60000, item.kind === 'contact' ? Number(person.availableAfter) || 0 : 0);
            goal.expiresAt = midnight + item.endMinute * 60000; goal.deadline = goal.expiresAt;
            goal.requiredPlaceId=item.requiredPlaceId; goal.minEnergy = item.minEnergy; goal.priority = item.priority; goal.reason = item.reason;
            // Variation is chosen once and persisted, never rerolled on a tick.
            const factor = 0.85 + roll(`${context.seed}|duration|${context.dateKey}|${item.id}`) * 0.3;
            goal.steps.forEach(step => { step.durationMs = Math.round(step.durationMs * factor / 60000) * 60000; });
            const duration=goal.steps.reduce((n,step)=>n+step.durationMs,0);
            if(item.durationMinutes){
                const extra=Math.max(0,item.durationMinutes*60000-goal.steps.length*60000);let cumulative=0,allocated=0;
                goal.steps.forEach(step=>{cumulative+=step.durationMs;const boundary=Math.round(extra*cumulative/duration);step.durationMs=60000+boundary-allocated;allocated=boundary;});
            }
            const adjustedDuration=goal.steps.reduce((n,step)=>n+step.durationMs,0);
            for(const [key,value] of Object.entries(item.effects))goal.steps.forEach(step=>{step[key]=value*step.durationMs/adjustedDuration;});
            if (goal.projectId) {
                const project=state.projects.find(p=>p.id===goal.projectId);
                const step=goal.steps[0]; const remaining=Math.min(step.durationMs,project.targetMs-project.progressMs);
                const fraction=remaining/step.durationMs; step.energy*=fraction; step.stress*=fraction; step.hunger*=fraction; step.durationMs=remaining;
            }
            goal.steps[0].costs = { ...goal.steps[0].costs, ...item.costs };
            goal.steps.at(-1).produces={...goal.steps.at(-1).produces,...item.produces};
        }
    }
    function effects(raw = {}, availability = 'available', company = false) {
        const asleep = availability === 'asleep', occupied = ['busy', 'private'].includes(availability);
        const number = (value, fallback, lo, hi) => Number.isFinite(value) ? clamp(value, lo, hi) : fallback;
        return { energyPerHour: number(raw?.energyPerHour, asleep ? 12 : occupied ? -3.5 : -1.5, -20, 15),
            stressTarget: number(raw?.stressTarget, asleep ? 10 : occupied ? 50 : 18, 0, 100),
            socialPerHour: number(raw?.socialPerHour, company ? -10 : asleep ? 0.15 : 1.25, -20, 10),
            hungerPerHour: number(raw?.hungerPerHour, asleep ? 2 : 5, -20, 15) };
    }
    function proposeNeeds(state, now, needs = {}) {
        for(const goal of state.goals)if(goal.id.startsWith('need:')&&!goal.startedAt&&['planned','blocked','paused'].includes(goal.status)&&((goal.kind==='meal'&&needs.hunger<35)||(goal.kind==='recovery'&&needs.energy>60&&needs.stress<50))){goal.status='abandoned';goal.reason='The physical need was met by another action.';}
        const pending = kind => state.goals.some(goal => goal.kind === kind && !['completed', 'abandoned'].includes(goal.status));
        const bucket = Math.floor(now / (6 * 3600000));
        if ((needs.energy < 25 || needs.stress > 75) && !pending('recovery')) {
            const goal = addGoal(state, 'recovery', `need:recovery:${bucket}`, now);
            if (goal) goal.reason = needs.energy < 25 ? 'Low energy makes recovery a priority.' : 'Stress makes a restorative break worthwhile.';
        }
        if (needs.hunger >= 65 && !pending('meal')) {
            const goal = addGoal(state, 'meal', `need:meal:${bucket}`, now);
            if (goal) goal.reason = 'Hunger motivates preparing something to eat.';
        }
    }
    return { breakPolicy, normalizeBreak, advanceBreak, sleepPolicy, normalizeSleep, advanceSleep, resources, resourcePressure, policy, utility, normalize, addGoal, advance, pauseForContext, effects, proposeNeeds, normalizeOpportunities, plan, reserveAttention };
});
