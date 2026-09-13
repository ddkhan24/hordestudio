// Historical editor fixtures for saved-data regression tests only. Not loaded or packaged by Horde.
function renderCompanionLegacyWorldSystems(companion,panel) {
    if(!panel)return;
    if(getActiveCompanionTimeline(companion.id)?.vh2){panel.innerHTML='<section class="form-section"><h3>Current life settings</h3><p>Edit the running life in its workspace. These controls use the persistent life, including saved places, independent people, references and feeds.</p><button type="button" data-current-life>Open life workspace</button><button type="button" data-people-ai>Draft people’s routines with AI</button></section>';panel.querySelector('[data-current-life]').onclick=()=>vhOpenWorkspace('overview',companion.id);panel.querySelector('[data-people-ai]').onclick=()=>vhDraftSupportingRoutines(companion);return;}
    const expanded=new Set([...panel.querySelectorAll('details[open]')].map(el=>el.querySelector('summary')?.textContent));
    const p=companion.lifeProfile.world=VHWorldEngine.config(companion.lifeProfile.world),r=VHWorldEngine.ensure(companion);
    const whereabouts=VHWorldEngine.position(companion,companion.lifeRuntime.lastSimulatedAt||r.lastAt||Date.now());
    const travelProgress=r.journey&&whereabouts?`<div class="form-section" data-vh-travel-progress><strong>${escapeHTML(r.journey.toLabel||r.journey.to)}</strong><p>${whereabouts.status==='paused'?'Paused':'Travelling'} · ${Math.round(whereabouts.progress*100)}% · ${whereabouts.remainingMinutes} minutes remaining</p><progress max="1" value="${whereabouts.progress}" aria-label="Journey progress" style="width:100%"></progress><p class="form-hint">${whereabouts.source==='route'?'Position follows the saved route.':'Time estimate only; no route geometry is available.'}</p></div>`:'';
    const field=(path,label,type='text',options=null)=>{const [group,key]=path.split('.'),v=p[group][key];return `<label class="form-label">${escapeHTML(label)}${options?`<select class="form-select" data-world-field="${path}">${options.map(o=>`<option value="${o}" ${v===o?'selected':''}>${o}</option>`).join('')}</select>`:type==='checkbox'?`<input type="checkbox" data-world-field="${path}" ${v?'checked':''}>`:`<input class="form-input" type="${type}" data-world-field="${path}" value="${escapeHTML(Array.isArray(v)?v.join(', '):String(v))}">`}</label>`;};
    panel.innerHTML=`<h3>Connected life systems</h3><p class="form-hint">These settings govern simulated actions. Money and deliveries are fictional. Changes save on this character; inventory, journeys and connection state belong to each timeline.</p>
    <details class="form-section"><summary>Transport & consequences</summary>${travelProgress}${field('transport.enabled','Enable persistent journeys','checkbox')}${field('transport.goalTravel','Allow unscheduled outings for location-linked activities','checkbox')}${field('transport.maxOutingMinutes','Maximum outing duration (minutes)','number')}${field('transport.returnEnergy','Return home at or below this energy','number')}${field('transport.returnHunger','Return home at or above this hunger','number')}${field('transport.outingTravelWeight','Travel effort penalty for outing choices','number')}${field('transport.outingCooldownMinutes','Rest before retrying an interrupted outing (minutes)','number')}${field('transport.liveRouting','Use selected provider at departure (API usage)','checkbox')}${['car','bicycle','transit','rideshare'].map(k=>field('transport.'+k,'Access to '+k,'checkbox')).join('')}${field('transport.preferredMode','Usual transport','text',['WALK','DRIVE','BICYCLE','TRANSIT','RIDESHARE'])}${field('transport.habitWeight','Transport habit strength','number')}${field('transport.weatherWeight','Avoid outdoor travel in bad weather','number')}${field('transport.fatigueWeight','Avoid physical travel when tired','number')}${field('transport.costWeight','Travel cost sensitivity','number')}${field('transport.budget','Starting travel wallet (new timelines)','number')}${field('transport.lateStress','Stress per minute late','number')}${field('transport.fatiguePerMinute','Travel fatigue per minute','number')}${field('transport.delayChance','Delay probability (0–1)','number')}${field('transport.maxDelay','Maximum delay minutes','number')}<p>Available simulated travel funds: ${Number(r.balance??p.transport.budget).toFixed(2)}${r.outing?.returnReserved?` · Return fare reserved: ${Number(r.outing.returnReserved).toFixed(2)}`:''}</p><p>Author routes and costs in Edit active life → Recurring places. An unavailable or unaffordable route can cause a missed commitment. Unscheduled outings need an activity linked to a place and routes both from home and back; the return fare is reserved before departure.</p><button type="button" class="btn btn-ghost" data-world-delay>Pause current journey for 5 minutes</button><div data-world-status></div></details>
    <details class="form-section"><summary>Gift permissions & preferences</summary>${field('gifts.enabled','Accept gift offers','checkbox')}${field('gifts.mailAllowed','Initial permission for mailed gifts','checkbox')}${field('gifts.cashAllowed','Initial permission for simulated cash','checkbox')}${field('gifts.minTrust','Minimum trust','number')}${field('gifts.maxValue','Maximum accepted gift value','number')}${field('gifts.playerBudget','Starting player gift wallet (new timelines)','number')}${field('gifts.openingMinutes','Time to open a collected gift (minutes)','number')}${field('gifts.pressureSensitivity','Sensitivity to excessive gifts (0–1)','number')}${field('gifts.deliveryHours','Delivery hours','number')}${field('gifts.likes','Liked tags (comma separated)')}${field('gifts.dislikes','Disliked tags (comma separated)')}<p>Permission can also be granted in a conversation. Gift offers still respect the value and trust requirements.</p></details>
    <details class="form-section"><summary>Closet & inventory</summary>${field('closet.mode','Wardrobe mode','text',['presets','items'])}${field('closet.style','Preferred style tags')}${field('closet.laundryHours','Start laundry after garments are dirty for (hours)','number')}${field('closet.laundryMinutes','Laundry cycle minutes','number')}<p>Items support multiple tags: casual, fitness, lounge, work, cozy, cute. A complete outfit needs a dress or a top and bottom. Uploaded images stay attached to their items.</p>
    <div>${p.items.map(i=>`<div class="form-section" data-world-item="${escapeHTML(i.id)}"><input class="form-input" data-item-field="name" value="${escapeHTML(i.name)}" aria-label="Item name"><select class="form-select" data-item-field="category" aria-label="Category">${VHWorldEngine.categories.map(k=>`<option ${k===i.category?'selected':''}>${k}</option>`).join('')}</select><input class="form-input" data-item-field="tags" value="${escapeHTML(i.tags.join(', '))}" aria-label="Item tags" placeholder="Comma-separated tags"><label>Warmth 0–5<input class="form-input" type="number" min="0" max="5" data-item-field="warmth" value="${i.warmth}"></label><label><input type="checkbox" data-item-field="owned" ${i.owned?'checked':''}>Owned at start (off = gift catalogue)</label><input class="form-input" data-item-field="incompatible" value="${escapeHTML(i.incompatible.join(', '))}" placeholder="Incompatible item IDs" aria-label="Incompatible items"><small>Item ID: ${escapeHTML(i.id)}</small>${i.photo?`<img src="${escapeHTML(i.photo)}" alt="${escapeHTML(i.name)}" style="max-width:120px;max-height:120px">`:''}<input type="file" accept="image/*" data-item-upload aria-label="Upload garment photo"><button type="button" class="btn btn-ghost" data-item-tag>Suggest garment tags</button><button type="button" class="btn btn-ghost" data-item-try>Try on & preview photo</button><button type="button" class="btn btn-ghost" data-item-remove>Remove item</button><div data-item-status></div></div>`).join('')}</div>
    <button type="button" class="btn btn-ghost" data-item-add>Add closet / gift item</button><label>Vision provider<select class="form-select" data-vision-provider><option value="local" ${p.vision.provider==='local'?'selected':''}>Local</option><option value="openrouter" ${p.vision.provider==='openrouter'?'selected':''}>OpenRouter</option></select></label><label>Vision model<input class="form-input" data-vision-model list="vh-garment-vision-models" value="${escapeHTML(p.vision.provider==='openrouter'?p.vision.openrouterModel:p.vision.localModel)}" placeholder="${p.vision.provider==='openrouter'?'provider/model-id':'Model loaded in your local server'}"></label><datalist id="vh-garment-vision-models"></datalist><button type="button" class="btn btn-ghost" data-vision-models ${p.vision.provider==='openrouter'?'':'hidden'}>Load OpenRouter vision models</button><p data-vision-status class="form-hint">${p.vision.provider==='openrouter'?'Uses your saved OpenRouter key. Clicking Suggest garment tags sends this item photo to the selected model and may use credits.':'Uses your local server URL and an image-capable model. No cloud fallback.'} Model choices are saved separately for each provider. Suggestions remain editable.</p><div data-outfit-preview></div></details>
    <details class="form-section"><summary>Adaptation & follow-through</summary>${field('adaptation.enabled','Reconsider disrupted plans','checkbox')}${field('adaptation.retryMinutes','Reconsider after (minutes)','number')}${field('adaptation.followupHours','Keep conversational follow-ups relevant (hours)','number')}${field('adaptation.socialRestMinutes','Supporting people rest duration (minutes)','number')}${field('adaptation.socialRecoveryEnergy','Supporting people rest below energy','number')}<p>Missed commitments stay missed. Recovery creates a new activity instead of inventing completion.</p></details>
    <details class="form-section"><summary>Supporting-person LLM activity</summary>${field('socialAgent.enabled','Enable scheduled LLM batches (provider usage)','checkbox')}${field('socialAgent.model','Model ID (blank uses this VH’s model)')}${field('socialAgent.intervalHours','Hours between planning calls','number')}${field('socialAgent.maxEvents','Maximum proposed events per batch','number')}<p>Uses this VH’s text provider while Horde is open. Plans delayed messages and comments on public posts; the engine validates them before delivery.</p><p>${escapeHTML(r.socialError||'')}</p></details>
    <details class="form-section"><summary>Supporting people’s routines</summary><p>Let AI draft independent routines from your saved people and places. Review the proposal before saving it to the VH2 blueprint.</p><button class="btn btn-primary" type="button" data-people-ai>Draft people’s routines with AI</button><details><summary>Older VH manual schedules</summary><p>These schedules belong to the older VH simulator. VH2 uses the independent routines drafted above.</p>${p.people.map((n,i)=>`<div data-npc-row="${i}"><select class="form-select" data-npc="personId">${companion.lifeProfile.socialCircle.map(person=>`<option value="${escapeHTML(person.id)}" ${person.id===n.personId?'selected':''}>${escapeHTML(person.name)}</option>`).join('')}</select><select class="form-select" data-npc="placeId">${companion.lifeProfile.places.map(place=>`<option value="${escapeHTML(place.id)}" ${place.id===n.placeId?'selected':''}>${escapeHTML(place.label)}</option>`).join('')}</select><input class="form-input" data-npc="days" value="${n.days.join(',')}" aria-label="Weekdays 0 Sunday through 6 Saturday"><input class="form-input" type="number" data-npc="start" value="${n.start}" aria-label="Start minute"><input class="form-input" type="number" data-npc="end" value="${n.end}" aria-label="End minute"><input class="form-input" data-npc="activity" value="${escapeHTML(n.activity)}" placeholder="Activity"><input class="form-input" data-npc="goal" value="${escapeHTML(n.goal||'')}" placeholder="Continuing personal task"><input type="number" class="form-input" data-npc="goalMinutes" value="${n.goalMinutes||60}" aria-label="Personal task effort minutes"><input class="form-input" data-npc="mood" value="${escapeHTML(n.mood)}" placeholder="Ordinary mood"><button class="btn btn-ghost" type="button" data-npc-remove>Remove routine</button></div>`).join('')}<button class="btn btn-ghost" type="button" data-npc-add>Add supporting routine</button></details></details>
    <details class="form-section"><summary>Communication setting</summary>${field('frame.mode','App framing','text',['direct','dating','private_social','public_social'])}${field('frame.acceptRequests','Open to new connection requests','checkbox')}${field('frame.openerMode','Who starts the conversation','text',['player_first','vh_first'])}${field('frame.openingDelayMinutes','First contact delay (minutes)','number')}${field('frame.openerScenario','Reason or scenario for approaching the player')}${field('frame.minComfort','Minimum relationship comfort for connection','number')}${field('frame.requestMinutes','Typical request review minutes','number')}<p>Dating requires a match. A private social profile requires an accepted request before messaging. Direct and public messaging are open.</p></details>`;
    const kernel=document.createElement('details');kernel.className='form-section';
    const settings=companion.lifeProfile.decisionPolicy=VHActivityEngine.policy(companion.lifeProfile.decisionPolicy);
    const labels={needWeight:'Weight of physical needs (0–3)',commitmentWeight:'Weight of commitments (0–3)',personalityWeight:'Personality influence on choices (0–3)',habitWeight:'Learned preference strength (0–100)',inertia:'Persistence once started (0–100)',variation:'Variation when pressures are low (0–100)',minimumRunMinutes:'Extra persistence during first minutes (0–30)',conscientiousness:'Conscientiousness (0–100)',sociability:'Sociability (0–100)'};
    kernel.innerHTML='<summary>Life decision engine</summary><p>Available activities compete as needs and obligations change. Appointments keep their times; activities use real time and can be interrupted. These controls change choices, not the character’s written personality.</p>'+Object.entries(labels).map(([key,label])=>`<label class="form-label">${label}<input class="form-input" data-kernel="${key}" type="number" min="0" step="${key==='needWeight'||key==='commitmentWeight'||key==='personalityWeight'?'.1':'1'}" max="${key==='needWeight'||key==='commitmentWeight'||key==='personalityWeight'?3:key==='minimumRunMinutes'?30:100}" value="${settings[key]}"></label>`).join('')+`<p>Last decision: ${escapeHTML(companion.lifeRuntime?.activities?.goals?.find(g=>g.id===companion.lifeRuntime?.activities?.decision?.goalId)?.label||'No activity selected yet')}</p>`;
    panel.append(kernel);kernel.querySelectorAll('[data-kernel]').forEach(input=>input.onchange=async()=>{companion.lifeProfile.decisionPolicy=VHActivityEngine.policy({...companion.lifeProfile.decisionPolicy,[input.dataset.kernel]:Number(input.value)});await saveState();});
    const breakPanel=document.createElement('details');breakPanel.className='form-section';
    const breaks=companion.lifeProfile.breakPolicy=VHActivityEngine.breakPolicy(companion.lifeProfile.breakPolicy);
    breakPanel.innerHTML='<summary>Breaks during obligations</summary><p>Busy obligations can pause for an actual meal or rest action, then resume in place. Private activities never allow breaks. Disable breaks on any appointment that cannot be interrupted.</p>'+[['enabled','Allow need-based breaks'],['foodAvailable','Food is available during meal breaks']].map(([key,label])=>`<label class="form-label"><input type="checkbox" data-break-setting="${key}" ${breaks[key]?'checked':''}> ${label}</label>`).join('')+Object.entries({intervalMinutes:'Minimum minutes of obligation between breaks',mealMinutes:'Meal break length (minutes)',restMinutes:'Rest break length (minutes)',hungerThreshold:'Hunger needed to request a meal break'}).map(([key,label])=>`<label class="form-label">${label}<input class="form-input" type="number" data-break-setting="${key}" value="${breaks[key]}"></label>`).join('');
    panel.append(breakPanel);breakPanel.querySelectorAll('[data-break-setting]').forEach(input=>input.onchange=async()=>{companion.lifeProfile.breakPolicy=VHActivityEngine.breakPolicy({...companion.lifeProfile.breakPolicy,[input.dataset.breakSetting]:input.type==='checkbox'?input.checked:Number(input.value)});if(input.type!=='checkbox')input.value=companion.lifeProfile.breakPolicy[input.dataset.breakSetting];await saveState();});
    const sleepPanel=document.createElement('details');sleepPanel.className='form-section';
    const sleepSettings=companion.lifeProfile.sleepPolicy=VHActivityEngine.sleepPolicy(companion.lifeProfile.sleepPolicy);
    sleepPanel.innerHTML='<summary>Sleep, fatigue & patience</summary><p>Bedtime is a tendency. Sleep pressure, stimulation and the opportunity to rest determine actual stages; hunger and sleep loss affect patience without changing relationship trust.</p><label class="form-label"><input type="checkbox" data-sleep-enabled '+(sleepSettings.enabled?'checked':'')+'> Needs-based sleep</label>'+Object.entries({pressurePerHour:'Sleep pressure gained per waking hour',recoveryPerHour:'Pressure recovered per sleeping hour',windDownMinutes:'Wind-down time (minutes)',sleepNeedHours:'Typical sleep need (hours)',napCutoffHours:'Treat sleep within this many hours of bedtime as overnight sleep',stimulationResistance:'How much an engaging conversation resists sleep',hungerSensitivity:'Sensitivity to hunger irritability'}).map(([key,label])=>`<label class="form-label">${label}<input class="form-input" type="number" step="0.1" min="0" data-sleep-setting="${key}" value="${sleepSettings[key]}"></label>`).join('')+`<p>Current stage: ${escapeHTML(companion.humanDynamics?.sleep?.stage?.replaceAll('_',' ')||'Not simulated yet')}</p>`;
    panel.append(sleepPanel);sleepPanel.querySelector('[data-sleep-enabled]').onchange=async e=>{companion.lifeProfile.sleepPolicy.enabled=e.target.checked;await saveState();};sleepPanel.querySelectorAll('[data-sleep-setting]').forEach(input=>input.onchange=async()=>{companion.lifeProfile.sleepPolicy=VHActivityEngine.sleepPolicy({...companion.lifeProfile.sleepPolicy,[input.dataset.sleepSetting]:Number(input.value)});input.value=companion.lifeProfile.sleepPolicy[input.dataset.sleepSetting];await saveState();});
    const save=async()=>{p.voice=companion.lifeProfile.world.voice;companion.lifeProfile.world=VHWorldEngine.config(p);await saveState();};
    panel.querySelector('[data-vision-provider]').onchange=async e=>{const input=panel.querySelector('[data-vision-model]');p.vision[p.vision.provider==='openrouter'?'openrouterModel':'localModel']=input.value.trim();p.vision.provider=e.target.value;input.value=p.vision.provider==='openrouter'?p.vision.openrouterModel:p.vision.localModel;input.disabled=true;e.target.disabled=true;await save();renderCompanionLegacyWorldSystems(companion,panel);};
    panel.querySelector('[data-vision-model]').onchange=async e=>{p.vision[p.vision.provider==='openrouter'?'openrouterModel':'localModel']=e.target.value.trim();await save();};
    panel.querySelector('[data-vision-models]').onclick=async function(){this.disabled=true;const output=panel.querySelector('[data-vision-status]');try{
        const response=await fetch('https://openrouter.ai/api/v1/models',{signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error(`Model list failed (${response.status}).`);
        const data=await response.json(),models=(data.data||[]).filter(m=>m.architecture?.input_modalities?.includes('image')&&m.architecture?.output_modalities?.includes('text'));
        if(!this.isConnected)return;
        panel.querySelector('#vh-garment-vision-models').innerHTML=models.map(m=>`<option value="${escapeHTML(m.id)}">${escapeHTML(m.name||m.id)}</option>`).join('');output.textContent=`${models.length} image-capable models loaded. Type in Vision model to search. Tagging sends this photo to OpenRouter and may use credits.`;
    }catch(error){output.textContent=error.message+' You can also enter a model ID manually.';}finally{this.disabled=false;}};
    panel.querySelectorAll('[data-world-field]').forEach(input=>{input.onchange=async()=>{const [group,key]=input.dataset.worldField.split('.');p[group][key]=input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value):input.value;await save();};});
    panel.querySelector('[data-world-delay]').onclick=async()=>{try{VHWorldEngine.interrupt(companion,Date.now(),5);await saveState();panel.querySelector('[data-world-status]').textContent='Journey paused; arrival has moved back by five minutes.';}catch(e){panel.querySelector('[data-world-status]').textContent=e.message;}};
    panel.querySelector('[data-item-add]').onclick=async function(){if(p.items.length>=150)return;this.disabled=true;this.textContent='Adding item…';p.items.push({id:`garment-${Date.now()}`,name:'New item',category:'top',tags:[],owned:true,warmth:1});await save();renderCompanionLegacyWorldSystems(companion,panel);};
    panel.querySelectorAll('[data-world-item]').forEach(row=>{const item=p.items.find(i=>i.id===row.dataset.worldItem);
        row.querySelectorAll('[data-item-field]').forEach(input=>{input.onchange=async()=>{item[input.dataset.itemField]=input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value):input.value;await save();};});
        row.querySelector('[data-item-upload]').onchange=async e=>{try{if(!e.target.files[0])return;item.photo=await normalizeUploadedImage(e.target.files[0],1280,0.84);await save();renderCompanionLegacyWorldSystems(companion,panel);}catch(error){row.querySelector('[data-item-status]').textContent=error.message;}};
        row.querySelector('[data-item-remove]').onclick=async()=>{p.items=p.items.filter(i=>i!==item);await save();renderCompanionLegacyWorldSystems(companion,panel);};
        row.querySelector('[data-item-tag]').onclick=async function(){this.disabled=true;const status=row.querySelector('[data-item-status]');try{
            p.vision[p.vision.provider==='openrouter'?'openrouterModel':'localModel']=panel.querySelector('[data-vision-model]').value.trim();
            const photo=item.photo,request=companionGarmentVisionRequest(p.vision,photo,state.globalSettings,state.apiKey);
            await save();status.textContent='Analysing garment…';
            const response=await fetch(request.url,{...request.options,signal:AbortSignal.timeout(60000)});
            if(!response.ok)throw Error(`Vision request failed (${response.status}). Check the selected model, key and quota.`);
            const data=await response.json();if(data.choices?.[0]?.finish_reason==='length')throw Error('Vision response was truncated; no tags were changed. Try another model.');
            const text=data.choices?.[0]?.message?.content||'';const suggestion=JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g,''));
            if(!VHWorldEngine.categories.includes(suggestion.category)||!Array.isArray(suggestion.tags)||!suggestion.tags.every(t=>typeof t==='string')||!Number.isFinite(suggestion.warmth)||suggestion.warmth<0||suggestion.warmth>5)throw Error('The model returned invalid garment tags; no changes were applied.');
            if(item.photo!==photo)throw Error('The item photo changed during analysis. Please try again.');
            if(!p.items.includes(item)||!row.isConnected)return;item.category=suggestion.category;item.tags=Array.isArray(suggestion.tags)?suggestion.tags:item.tags;item.warmth=suggestion.warmth??item.warmth;await save();renderCompanionLegacyWorldSystems(companion,panel);
        }catch(e){status.textContent=e.message;}finally{this.disabled=false;}};
        row.querySelector('[data-item-try]').onclick=async function(){this.disabled=true;const status=row.querySelector('[data-item-status]');try{
            const now=Date.now(),situation=companionSituationAt(companion,now);if(['asleep','private'].includes(situation.availability)||situation.source==='travel'||(companion.lifeProfile.world.transport.enabled&&companion.lifeProfile.places.find(p=>p.id===companion.lifeRuntime.world.placeId)?.kind!=='home'))throw Error('They cannot change clothes right now.');
            const outfit=VHWorldEngine.chooseOutfit(companion,now,situation,item.id);if(!outfit)throw Error('Enable item wardrobe and add a compatible complete outfit.');companion.currentOutfit=outfit.label;await saveState();
            const image=await generateCompanionPhoto(companion,`Trying on ${outfit.label} at ${situation.placeLabel}.`);const photo=await loadGeneratedImage(new Image(),image);
            if(!panel.isConnected)return;const img=document.createElement('img');img.src=photo;img.alt=outfit.label;img.style.maxWidth='320px';panel.querySelector('[data-outfit-preview]').replaceChildren(img);companion.usage.photosGenerated++;await saveState();status.textContent='Outfit applied. Photo preview ready.';
        }catch(e){status.textContent=e.message;}finally{this.disabled=false;}};
    });
    panel.querySelector('[data-people-ai]').onclick=()=>vhDraftSupportingRoutines(companion);
    panel.querySelector('[data-npc-add]').onclick=async()=>{if(!companion.lifeProfile.socialCircle.length||!companion.lifeProfile.places.length){showToast('Add a supporting person and recurring place first.','error');return;}p.people.push({personId:companion.lifeProfile.socialCircle[0].id,placeId:companion.lifeProfile.places[0].id,days:[1,2,3,4,5],start:540,end:1020,activity:'working',mood:''});await save();renderCompanionLegacyWorldSystems(companion,panel);};
    panel.querySelectorAll('[data-npc-row]').forEach(row=>{const i=Number(row.dataset.npcRow);row.querySelectorAll('[data-npc]').forEach(input=>{input.onchange=async()=>{p.people[i][input.dataset.npc]=input.dataset.npc==='days'?input.value.split(',').map(Number):input.type==='number'?Number(input.value):input.value;await save();};});row.querySelector('[data-npc-remove]').onclick=async()=>{p.people.splice(i,1);await save();renderCompanionLegacyWorldSystems(companion,panel);};});
    panel.querySelectorAll('details').forEach(el=>{el.open=expanded.has(el.querySelector('summary')?.textContent);});
    renderCompanionVoiceBuilder(companion);
}
function companionScheduleTimeValue(minute) {
    const value = livingClamp(Math.round(Number(minute) || 0), 0, 1439);
    return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function companionScheduleMinuteFromInput(value) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || ''));
    if (!match) return 0;
    return livingClamp((parseInt(match[1]) || 0) * 60 + (parseInt(match[2]) || 0), 0, 1439);
}

function companionLifeEditorRowActions(type) {
    return `<button class="tool-btn tool-btn-danger" type="button" data-life-remove="${escapeHTML(type)}" title="Remove">×</button>`;
}

function collectCompanionLifeEditorValues(editor, life) {
    editor.querySelectorAll('[data-life-texture]').forEach(input => {
        life[input.dataset.lifeTexture] = input.value.trim();
    });
    editor.querySelectorAll('[data-life-place]').forEach(row => {
        const place = life.places[Number(row.dataset.lifePlace)];
        if (!place) return;
        place.label = row.querySelector('[data-field="label"]').value.trim();
        place.googlePlaceId = row.querySelector('[data-field="googlePlaceId"]')?.value.trim() || '';
        const lon=row.querySelector('[data-field="longitude"]')?.value,lat=row.querySelector('[data-field="latitude"]')?.value;
        place.mapCoordinates=lon!==''&&lat!==''&&lon!==undefined&&lat!==undefined?[Number(lon),Number(lat)]:null;

        place.kind = row.querySelector('[data-field="kind"]').value;
        place.encounterScope = row.querySelector('[data-field="encounterScope"]')?.value || place.encounterScope;
        place.noticeMinutes = Number(row.querySelector('[data-field="noticeMinutes"]')?.value ?? place.noticeMinutes ?? 2);
        place.detail = row.querySelector('[data-field="detail"]').value.trim();
        place.travelMode = row.querySelector('[data-field="travelMode"]')?.value || 'WALK';
        place.travelOverride = row.querySelector('[data-field="travelOverride"]')?.checked === true;
        place.travelMinutesFromHome = livingClamp(Number(row.querySelector('[data-field="travelMinutesFromHome"]').value) || 0, 0, 360);
    });
    editor.querySelectorAll('[data-life-person]').forEach(row => {
        const person = life.socialCircle[Number(row.dataset.lifePerson)];
        if (!person) return;
        ['name','relationship','role','contactFrequency','description','currentTension','playerContext'].forEach(field => {
            person[field] = row.querySelector(`[data-field="${field}"]`).value.trim();
        });
        person.closeness = livingClamp(Number(row.querySelector('[data-field="closeness"]').value) || 0, -100, 100);
        person.trust = livingClamp(Number(row.querySelector('[data-field="trust"]').value) || 0, -100, 100);
        person.tension = livingClamp(Number(row.querySelector('[data-field="tension"]').value) || 0, 0, 100);
        person.influence = livingClamp(Number(row.querySelector('[data-field="influence"]').value) || 0, 0, 100);
        person.knowsPlayer = row.querySelector('[data-field="knowsPlayer"]').checked;
    });
    editor.querySelectorAll('[data-supply-row]').forEach(row=>{const supply=life.supplies.find(x=>x.id===row.dataset.supplyRow);if(supply){supply.label=row.querySelector('[data-supply-label]').value.trim();supply.quantity=Number(row.querySelector('[data-supply-quantity]').value);}});
    editor.querySelectorAll('[data-life-opportunity]').forEach(row => {
        const item = life.activityOptions[Number(row.dataset.lifeOpportunity)];
        if (!item) return;
        ['label', 'kind', 'participantId', 'requiredPlaceId', 'reason'].forEach(field => { item[field] = row.querySelector(`[data-field="${field}"]`).value.trim(); });
        for(const type of ['costs','produces']){item[type]||={};row.querySelectorAll(`[data-supply-${type}]`).forEach(input=>{const key=input.getAttribute(`data-supply-${type}`),quantity=Number(input.value);if(quantity>0)item[type][key]=quantity;else delete item[type][key];});}
        item.effects={};for(const key of ['energy','stress','hunger']){const value=row.querySelector(`[data-effect="${key}"]`).value;if(value.trim())item.effects[key]=Number(value);}
        item.days = [...row.querySelectorAll('[data-life-day]:checked')].map(input => Number(input.dataset.lifeDay));
        ['startMinute', 'endMinute'].forEach(field => { const value = companionScheduleMinuteFromInput(row.querySelector(`[data-field="${field}"]`).value); item[field] = field === 'endMinute' && value === 0 ? 1440 : value; });
        ['priority', 'minEnergy', 'projectMinutes', 'repeatMinutes', 'durationMinutes'].forEach(field => { item[field] = Number(row.querySelector(`[data-field="${field}"]`).value); });
        item.learnFromOutcomes = row.querySelector('[data-field="learnFromOutcomes"]').checked;
    });
    editor.querySelectorAll('[data-contact-window]').forEach(row => {
        const [personIndex, index] = row.dataset.contactWindow.split(':').map(Number);
        const window = life.socialCircle[personIndex]?.contactWindows[index];
        if (!window) return;
        window.days = [...row.querySelectorAll('[data-life-day]:checked')].map(input => Number(input.dataset.lifeDay));
        ['startMinute', 'endMinute'].forEach(field => { const value = companionScheduleMinuteFromInput(row.querySelector(`[data-field="${field}"]`).value); window[field] = field === 'endMinute' && value === 0 ? 1440 : value; });
    });
    editor.querySelectorAll('[data-life-schedule]').forEach(row => {
        const block = life.weeklySchedule[Number(row.dataset.lifeSchedule)];
        if (!block) return;
        block.days = [...row.querySelectorAll('[data-life-day]:checked')].map(input => Number(input.dataset.lifeDay));
        block.startMinute = companionScheduleMinuteFromInput(row.querySelector('[data-field="startMinute"]').value);
        block.endMinute = companionScheduleMinuteFromInput(row.querySelector('[data-field="endMinute"]').value);
        block.breakAllowed=row.querySelector('[data-break-allowed]')?.checked!==false;
        block.departureCosts||={};row.querySelectorAll('[data-supply-departure]').forEach(input=>{const key=input.dataset.supplyDeparture,quantity=Number(input.value);if(quantity>0)block.departureCosts[key]=quantity;else delete block.departureCosts[key];});
        ['activity','placeId','availability','flexibility','outfitContext'].forEach(field => {
            block[field] = row.querySelector(`[data-field="${field}"]`).value.trim();
        });
    });
    editor.querySelectorAll('[data-life-look]').forEach(row => {
        const look = life.wardrobe[Number(row.dataset.lifeLook)];
        if (!look) return;
        ['label','context','items','notes'].forEach(field => {
            look[field] = row.querySelector(`[data-field="${field}"]`).value.trim();
        });
    });
    editor.querySelectorAll('[data-life-wildcard]').forEach(row => {
        const event = life.wildcardDeck[Number(row.dataset.lifeWildcard)];
        if (!event) return;
        ['label','category','availability','initiativeHook','consequences'].forEach(field => {
            event[field] = row.querySelector(`[data-field="${field}"]`).value.trim();
        });
        event.minGapDays = livingClamp(Number(row.querySelector('[data-field="minGapDays"]').value) || 1, 1, 90);
        event.durationMinutes = livingClamp(Number(row.querySelector('[data-field="durationMinutes"]').value) || 60, 15, 1440);
    });
    return life;
}

function renderCompanionLifeEditor(companion, draftLife = null) {
    const editor = document.getElementById('cs-life-editor');
    const overview = document.getElementById('cs-life-overview');
    if (!editor || !companion.lifeProfile?.initializedAt) return;
    const life = normalizeCompanionLifeProfile(
        draftLife || safeJsonClone(companion.lifeProfile)
    );
    life._initialPlaceIds = draftLife?._initialPlaceIds || companion.lifeProfile.places.map(p=>p.id);
    const textureFields = [
        ['fashionSense', 'Fashion sense'], ['grooming', 'Grooming'],
        ['foodHabits', 'Food habits'], ['mediaHabits', 'Media habits'],
        ['moneyPattern', 'Money pattern'], ['healthRoutine', 'Health routine'],
        ['digitalLife', 'Phone & digital life'], ['seasonalVariation', 'Seasonal variation']
    ];
    const placeOptions = life.places.map(place =>
        `<option value="${escapeHTML(place.id)}">${escapeHTML(place.label || place.id)}</option>`).join('');
    const supplyFields=(values,type)=>life.supplies.length?life.supplies.map(supply=>`<label><span>${escapeHTML(supply.label)}</span><input class="form-input" type="number" min="0" max="10000" data-supply-${type}="${escapeHTML(supply.id)}" value="${Number(values?.[supply.id])||0}"></label>`).join(''):'<p class="form-hint">Add supplies below to define requirements and outputs.</p>';
    editor.innerHTML = `
        <div class="vh-life-editor-header">
            <div><span class="vh-eyebrow">Manual editor</span><h3>Edit active life</h3><p class="form-hint">Review edits before applying them. Running lives keep their history; existing places and people are never silently deleted.</p></div>
            <div><button id="cs-life-editor-cancel" class="btn btn-ghost" type="button">Cancel</button><button id="cs-life-editor-save" class="btn btn-success" type="button">Save life changes</button></div>
        </div>
        <details class="vh-life-edit-section" open>
            <summary>Ordinary-life texture</summary>
            <div class="vh-life-edit-textures">${textureFields.map(([field, label]) =>
                `<label><span>${escapeHTML(label)}</span><textarea class="form-textarea" rows="3" data-life-texture="${escapeHTML(field)}">${escapeHTML(life[field] || '')}</textarea></label>`
            ).join('')}</div>
        </details>
        <details class="vh-life-edit-section">
            <summary>Recurring places <span>${life.places.length}</span></summary>
            <div class="vh-life-edit-list" data-life-list="places">${life.places.map((place, index) => `
                <div class="vh-life-edit-row" data-life-place="${index}">
                    <div class="vh-life-edit-row-head"><strong>${escapeHTML(place.label || 'New place')}</strong>${companionLifeEditorRowActions('place')}</div>
                    <div class="vh-life-edit-grid">
                        <label><span>Name</span><input class="form-input" data-field="label" value="${escapeHTML(place.label)}"></label>
                        <label><span>Kind</span><select class="form-select" data-field="kind">${COMPANION_PLACE_KINDS.map(kind => `<option value="${kind}" ${place.kind === kind ? 'selected' : ''}>${kind}</option>`).join('')}</select></label>
                        <label><span>VH2 encounter scale (new timeline profile)</span><select class="form-select" data-field="encounterScope"><option value="area" ${place.encounterScope!=='nearby'?'selected':''}>Broad area · co-location only</option><option value="nearby" ${place.encounterScope==='nearby'?'selected':''}>Nearby · people can notice each other</option></select></label>
                        <label><span>Shared minutes before noticing</span><input class="form-input" type="number" min="0" max="120" step="1" data-field="noticeMinutes" value="${place.noticeMinutes??2}"></label>
                        <label class="wide"><span>Continuity details</span><textarea class="form-textarea" rows="2" data-field="detail">${escapeHTML(place.detail)}</textarea></label>
                        <label class="wide"><span>Google place ID</span><input class="form-input" data-field="googlePlaceId" value="${escapeHTML(place.googlePlaceId || '')}"></label>
                        <label><span>Longitude (openrouteservice / manual)</span><input type="number" step="any" min="-180" max="180" class="form-input" data-field="longitude" value="${place.mapCoordinates?.[0] ?? ''}"></label>
                        <label><span>Latitude (openrouteservice / manual)</span><input type="number" step="any" min="-90" max="90" class="form-input" data-field="latitude" value="${place.mapCoordinates?.[1] ?? ''}"></label>
                        <div class="wide"><input class="form-input" data-map-query placeholder="Search actual place and city" aria-label="Search places"><button class="btn btn-ghost" type="button" data-map-search>Search places</button><div data-map-results aria-live="polite"></div></div>
                        <label><span>Transport from home</span><select class="form-select" data-field="travelMode">${['WALK','DRIVE','BICYCLE','TRANSIT','RIDESHARE'].map(mode=>`<option ${place.travelMode===mode?'selected':''}>${mode}</option>`).join('')}</select></label>
                        <label><input type="checkbox" data-field="travelOverride" ${place.travelOverride?'checked':''}> Use manual override</label>
                        <label><span>Minutes from home (route estimate / fallback)</span><input class="form-input" type="number" min="0" max="360" data-field="travelMinutesFromHome" value="${place.travelMinutesFromHome}"></label><button type="button" class="btn btn-ghost" data-home-route>Update travel times</button><div data-home-route-status aria-live="polite">${escapeHTML(life.travelLegs?.find(l=>l.to===place.id&&l.from===life.places.find(p=>p.kind==='home')?.id&&l.mode===(place.travelMode||'WALK'))?.source || 'Fallback until both places are mapped')}</div>
                    </div>
                </div>`).join('')}</div>
            <button class="btn btn-ghost vh-life-add" type="button" data-life-add="place">+ Add place</button>
            <p class="form-hint">Selecting places or changing transport recalculates linked travel times using your selected provider. Map both home and destination. Save life changes to keep estimates and coordinates.</p>
            <h4>Travel between places</h4>
            <p class="form-hint">Route estimates determine when to leave and how long journeys take. Routes are directional, including trips between places other than home. Driving requires access to a car. Manual durations are fallback estimates or explicit overrides.</p>
            <select class="form-select" data-route-from aria-label="Travel origin">${placeOptions}</select>
            <select class="form-select" data-route-to aria-label="Travel destination">${placeOptions}</select>
            <select class="form-select" data-route-mode aria-label="Transport">${['WALK','DRIVE','BICYCLE','TRANSIT','RIDESHARE'].map(mode=>`<option>${mode}</option>`).join('')}</select>
            <button class="btn btn-ghost" type="button" data-route-preview>Preview route</button>
            <div data-route-result aria-live="polite"></div>
            <label>Route minutes (edit to override)<input class="form-input" type="number" min="1" max="360" value="20" data-route-minutes></label>
            <label>Simulated fare / fuel cost<input type="number" class="form-input" min="0" value="0" data-route-cost></label><button class="btn btn-ghost" type="button" data-route-add>Save travel leg</button>
            <div>${(life.travelLegs || []).map((leg,i)=>`<p>${escapeHTML(life.places.find(p=>p.id===leg.from)?.label || leg.from)} → ${escapeHTML(life.places.find(p=>p.id===leg.to)?.label || leg.to)} · ${escapeHTML(leg.mode)} · ${leg.minutes} min · ${escapeHTML(leg.source || "Fallback estimate")} <button type="button" class="tool-btn" data-route-remove="${i}">Remove</button></p>`).join('')}</div>

        </details>
        <details class="vh-life-edit-section"><summary>Supplies & preparation</summary><p>Supplies are real quantities in the simulation. Activities consume and produce them. A packed bag can be a preparation marker; use it as an appointment requirement. Initial quantities apply once per timeline, never on every reload.</p>
        <div class="vh-life-edit-list">${life.supplies.map(supply=>`<div class="vh-life-edit-row" data-supply-row="${escapeHTML(supply.id)}"><div class="vh-life-edit-grid"><label><span>Name</span><input class="form-input" data-supply-label value="${escapeHTML(supply.label)}"></label><label><span>Initial quantity</span><input class="form-input" type="number" min="0" max="10000" data-supply-quantity value="${supply.quantity}"></label></div><p class="form-hint">On hand in this timeline: ${Number(companion.lifeRuntime?.activities?.resources?.[supply.id])||0}</p><button class="btn btn-ghost" type="button" data-remove-supply="${escapeHTML(supply.id)}">Remove supply</button></div>`).join('')}</div>
        <button class="btn btn-ghost" type="button" data-life-add="supply" ${life.supplies.length>=30?'disabled':''}>+ Add supply</button>
        <div class="form-section"><h4>Make an appointment require preparation</h4><p class="form-hint">Creates an editable ten-minute getting-ready activity and links its completed result to departure. Departure requirements use persistent journeys; enable Transport & consequences and configure routes. Nothing is granted until the activity finishes.</p><select class="form-select" data-preparation-template>${life.weeklySchedule.map(block=>`<option value="${escapeHTML(block.id)}">${escapeHTML(block.activity)}</option>`).join('')}</select><button type="button" class="btn btn-primary" data-add-preparation ${!life.weeklySchedule.length||life.supplies.length>=30?'disabled':''}>Add linked preparation</button></div></details>
        <details class="vh-life-edit-section" open>
            <summary>Activity opportunities <span>${life.activityOptions.length}</span></summary>
            <p>Reusable possibilities compete for free time. They can be interrupted or missed. Contacts require the other person's availability; preparing for a promise does not fulfill it.</p>
            <div class="vh-life-edit-list">${life.activityOptions.map((item, index) => `
                <div class="vh-life-edit-row" data-life-opportunity="${index}">
                    <div class="vh-life-edit-row-head"><strong>${escapeHTML(item.label)}</strong>${companionLifeEditorRowActions('opportunity')}</div>
                    ${item.projectMinutes ? `<p class="form-hint">Project effort: ${Math.floor((companion.lifeRuntime?.activities?.projects?.find(p=>p.id===item.id)?.progressMs || 0)/60000)} / ${item.projectMinutes} minutes. Work invested does not guarantee the real-world outcome.</p>` : ''}
                    <div class="vh-life-edit-grid">
                        <label><span>Activity</span><input class="form-input" data-field="label" value="${escapeHTML(item.label)}"></label>
                        <label><span>Kind</span><select class="form-select" data-field="kind">${['focus','leisure','recovery','meal','contact','preparation'].map(kind => `<option value="${kind}" ${kind === item.kind ? 'selected' : ''}>${kind}</option>`).join('')}</select></label>
                        <label><span>Contact with</span><select class="form-select" data-field="participantId"><option value="">Nobody selected</option>${life.socialCircle.map(person => `<option value="${escapeHTML(person.id)}" ${person.id === item.participantId ? 'selected' : ''}>${escapeHTML(person.name)}</option>`).join('')}</select></label>
                        <label><span>Earliest start</span><input class="form-input" type="time" data-field="startMinute" value="${companionScheduleTimeValue(item.startMinute)}"></label>
                        <label><span>Window closes</span><input class="form-input" type="time" data-field="endMinute" value="${companionScheduleTimeValue(item.endMinute)}"></label>
                        <label><span>Importance (0–80)</span><input class="form-input" type="number" min="0" max="80" data-field="priority" value="${item.priority}"></label>
                        <label><span>Minimum energy</span><input class="form-input" type="number" min="0" max="100" data-field="minEnergy" value="${item.minEnergy}"></label>
                        <label><span>Required location</span><select class="form-select" data-field="requiredPlaceId"><option value="">Anywhere appropriate</option>${life.places.map(place=>`<option value="${escapeHTML(place.id)}" ${place.id===item.requiredPlaceId?'selected':''}>${escapeHTML(place.label)}</option>`).join('')}</select></label>
                        <label><span>Duration (minutes; 0 = activity default)</span><input class="form-input" type="number" min="0" max="1440" data-field="durationMinutes" value="${item.durationMinutes||0}"></label>
                        ${['energy','stress','hunger'].map(key=>`<label><span>Total ${key} effect (blank = default)</span><input class="form-input" type="number" min="${key==='hunger'?-100:-30}" max="${key==='hunger'?100:30}" data-effect="${key}" value="${item.effects?.[key]??''}"></label>`).join('')}
                        <label><span>Repeat after completion (minutes; 0 = once per day)</span><input class="form-input" type="number" min="0" max="10080" data-field="repeatMinutes" value="${item.repeatMinutes||0}"></label>
                        <label><span>Project work target (minutes; focus only, 0 = recurring activity)</span><input class="form-input" type="number" min="0" max="100000" data-field="projectMinutes" value="${item.projectMinutes || 0}"></label>
                        <label><input type="checkbox" data-field="learnFromOutcomes" ${item.learnFromOutcomes ? 'checked' : ''}> Learn scheduling preference from outcomes</label>
                        <details><summary>Supplies used at start</summary>${supplyFields(item.costs,'costs')}</details>
                        <details><summary>Supplies produced on completion</summary>${supplyFields(item.produces,'produces')}</details>
                        <label><span>Why it matters</span><input class="form-input" data-field="reason" value="${escapeHTML(item.reason)}"></label>
                    </div>
                    <div class="vh-life-day-picker">${COMPANION_WEEKDAYS.map((day,i) => `<label><input type="checkbox" data-life-day="${i}" ${item.days.includes(i) ? 'checked' : ''}><span>${day.slice(0,3)}</span></label>`).join('')}</div>
                </div>`).join('')}</div>
            <button class="btn btn-ghost vh-life-add" type="button" data-life-add="opportunity">+ Add opportunity</button>
        </details>
        <details class="vh-life-edit-section">
            <summary>Contact availability</summary>
            <p>These windows describe when supporting people can take part in a remote conversation. No window means their availability is unknown.</p>
            ${life.socialCircle.map((person, personIndex) => `<div class="vh-life-edit-row"><strong>${escapeHTML(person.name)}</strong>
                ${(person.contactWindows || []).map((window,index) => `<div data-contact-window="${personIndex}:${index}">
                    <div class="vh-life-edit-grid"><label><span>From</span><input class="form-input" type="time" data-field="startMinute" value="${companionScheduleTimeValue(window.startMinute)}"></label><label><span>Until</span><input class="form-input" type="time" data-field="endMinute" value="${companionScheduleTimeValue(window.endMinute)}"></label></div>
                    <div class="vh-life-day-picker">${COMPANION_WEEKDAYS.map((day,i) => `<label><input type="checkbox" data-life-day="${i}" ${window.days.includes(i) ? 'checked' : ''}><span>${day.slice(0,3)}</span></label>`).join('')}</div>
                    <button type="button" class="btn btn-ghost" data-remove-contact-window="${personIndex}:${index}">Remove window</button>
                </div>`).join('')}
                <button type="button" class="btn btn-ghost" data-life-add="contact-window" data-person-index="${personIndex}">+ Add availability window</button>
            </div>`).join('')}
        </details>
        <details class="vh-life-edit-section">
            <summary>Supporting cast <span>${life.socialCircle.length}</span></summary>
            <div class="vh-life-edit-list">${life.socialCircle.map((person, index) => `
                <div class="vh-life-edit-row" data-life-person="${index}">
                    <div class="vh-life-edit-row-head"><strong>${escapeHTML(person.name || 'New person')}</strong>${companionLifeEditorRowActions('person')}</div>
                    <div class="vh-life-edit-grid">
                        <label><span>Name</span><input class="form-input" data-field="name" value="${escapeHTML(person.name)}"></label>
                        <label><span>Relationship</span><input class="form-input" data-field="relationship" value="${escapeHTML(person.relationship)}"></label>
                        <label><span>Role</span><select class="form-select" data-field="role">${['friend','family','coworker','classmate','partner','ex','neighbor','acquaintance','other'].map(value => `<option value="${value}" ${person.role === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
                        <label><span>Usual contact</span><select class="form-select" data-field="contactFrequency">${['daily','few_week','weekly','monthly','rare'].map(value => `<option value="${value}" ${person.contactFrequency === value ? 'selected' : ''}>${value.replace('_', ' ')}</option>`).join('')}</select></label>
                        <label><span>Closeness −100 to 100</span><input class="form-input" type="number" min="-100" max="100" data-field="closeness" value="${person.closeness}"></label>
                        <label><span>Trust −100 to 100</span><input class="form-input" type="number" min="-100" max="100" data-field="trust" value="${person.trust}"></label>
                        <label><span>Tension 0 to 100</span><input class="form-input" type="number" min="0" max="100" data-field="tension" value="${person.tension}"></label>
                        <label><span>Influence on their life</span><input class="form-input" type="number" min="0" max="100" data-field="influence" value="${person.influence}"></label>
                        <label class="wide"><span>History and dynamic</span><textarea class="form-textarea" rows="2" data-field="description">${escapeHTML(person.description)}</textarea></label>
                        <label class="wide"><span>Current tension</span><input class="form-input" data-field="currentTension" value="${escapeHTML(person.currentTension)}"></label>
                        <label class="wide vh-test-check"><input type="checkbox" data-field="knowsPlayer" ${person.knowsPlayer ? 'checked' : ''}><span>This person knows the player</span></label>
                        <label class="wide"><span>What they know about the player</span><input class="form-input" data-field="playerContext" value="${escapeHTML(person.playerContext)}"></label>
                    </div>
                </div>`).join('')}</div>
            <button class="btn btn-ghost vh-life-add" type="button" data-life-add="person">+ Add person</button>
        </details>
        <details class="vh-life-edit-section" open>
            <summary>Weekly schedule <span>${life.weeklySchedule.length}</span></summary>
            <div class="vh-life-edit-list">${life.weeklySchedule.map((block, index) => `
                <div class="vh-life-edit-row" data-life-schedule="${index}">
                    <div class="vh-life-edit-row-head"><strong>${escapeHTML(block.activity || 'New schedule block')}</strong>${companionLifeEditorRowActions('schedule')}</div>
                    <div class="vh-life-day-picker">${COMPANION_WEEKDAYS.map((day, dayIndex) => `<label><input type="checkbox" data-life-day="${dayIndex}" ${block.days.includes(dayIndex) ? 'checked' : ''}><span>${day.slice(0, 3)}</span></label>`).join('')}</div>
                    <div class="vh-life-edit-grid">
                        <label><span>Starts</span><input class="form-input" type="time" data-field="startMinute" value="${companionScheduleTimeValue(block.startMinute)}"></label>
                        <label><span>Ends</span><input class="form-input" type="time" data-field="endMinute" value="${companionScheduleTimeValue(block.endMinute % 1440)}"></label>
                        <label class="wide"><span>Activity</span><input class="form-input" data-field="activity" value="${escapeHTML(block.activity)}"></label>
                        <label><span>Place</span><select class="form-select" data-field="placeId"><option value="">Flexible / elsewhere</option>${placeOptions.replace(`value="${escapeHTML(block.placeId)}"`, `value="${escapeHTML(block.placeId)}" selected`)}</select></label>
                        <label><span>Availability</span><select class="form-select" data-field="availability">${COMPANION_LIFE_AVAILABILITY.filter(value => value !== 'asleep').map(value => `<option value="${value}" ${block.availability === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
                        <label><span>Flexibility</span><select class="form-select" data-field="flexibility">${['fixed','soft','optional'].map(value => `<option value="${value}" ${block.flexibility === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
                        <label class="form-label"><input type="checkbox" data-break-allowed ${block.breakAllowed!==false?'checked':''}> Allow meal/rest breaks during this obligation</label><details><summary>Required departure supplies</summary><p class="form-hint">Consumed once when leaving for this appointment. Missing supplies delay departure; the appointment clock keeps running.</p>${supplyFields(block.departureCosts,'departure')}</details>
                        <label><span>Outfit context</span><select class="form-select" data-field="outfitContext">${['home','work','social','active','formal','weather'].map(value => `<option value="${value}" ${block.outfitContext === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
                    </div>
                </div>`).join('')}</div>
            <button class="btn btn-ghost vh-life-add" type="button" data-life-add="schedule">+ Add schedule block</button>
        </details>
        <details class="vh-life-edit-section">
            <summary>Wardrobe <span>${life.wardrobe.length}</span></summary>
            <div class="vh-life-edit-list">${life.wardrobe.map((look, index) => `
                <div class="vh-life-edit-row" data-life-look="${index}">
                    <div class="vh-life-edit-row-head"><strong>${escapeHTML(look.label || 'New look')}</strong>${companionLifeEditorRowActions('look')}</div>
                    <div class="vh-life-edit-grid">
                        <label><span>Look name</span><input class="form-input" data-field="label" value="${escapeHTML(look.label)}"></label>
                        <label><span>Context</span><select class="form-select" data-field="context">${['sleep','home','work','social','active','formal','weather'].map(value => `<option value="${value}" ${look.context === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
                        <label class="wide"><span>Garments</span><textarea class="form-textarea" rows="2" data-field="items">${escapeHTML(look.items)}</textarea></label>
                        <label class="wide"><span>Fit, condition and variation</span><input class="form-input" data-field="notes" value="${escapeHTML(look.notes)}"></label>
                    </div>
                </div>`).join('')}</div>
            <button class="btn btn-ghost vh-life-add" type="button" data-life-add="look">+ Add wardrobe look</button>
        </details>
        <details class="vh-life-edit-section">
            <summary>Wildcard events <span>${life.wildcardDeck.length}</span></summary>
            <div class="vh-life-edit-list">${life.wildcardDeck.map((event, index) => `
                <div class="vh-life-edit-row" data-life-wildcard="${index}">
                    <div class="vh-life-edit-row-head"><strong>${escapeHTML(event.label || 'New wildcard')}</strong>${companionLifeEditorRowActions('wildcard')}</div>
                    <div class="vh-life-edit-grid">
                        <label class="wide"><span>Event</span><textarea class="form-textarea" rows="2" data-field="label">${escapeHTML(event.label)}</textarea></label>
                        <label><span>Category</span><select class="form-select" data-field="category">${COMPANION_WILDCARD_CATEGORIES.map(value => `<option value="${value}" ${event.category === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
                        <label><span>Minimum gap (days)</span><input class="form-input" type="number" min="1" max="90" data-field="minGapDays" value="${event.minGapDays}"></label>
                        <label><span>Duration (minutes)</span><input class="form-input" type="number" min="15" max="1440" data-field="durationMinutes" value="${event.durationMinutes}"></label>
                        <label><span>Availability</span><select class="form-select" data-field="availability">${COMPANION_LIFE_AVAILABILITY.filter(value => value !== 'asleep').map(value => `<option value="${value}" ${event.availability === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
                        <label class="wide"><span>Reason they might contact the player</span><input class="form-input" data-field="initiativeHook" value="${escapeHTML(event.initiativeHook)}"></label>
                        <label class="wide"><span>Persistent consequence</span><input class="form-input" data-field="consequences" value="${escapeHTML(event.consequences)}"></label>
                    </div>
                </div>`).join('')}</div>
            <button class="btn btn-ghost vh-life-add" type="button" data-life-add="wildcard">+ Add wildcard</button>
        </details>`;
    editor.classList.remove('hidden');
    overview?.classList.add('hidden');

    editor.querySelectorAll('[data-map-search]').forEach(button => { button.onclick = async () => {
        const row=button.closest('[data-life-place]'), output=row.querySelector('[data-map-results]');
        button.disabled=true; output.textContent='Searching places…';
        try {
            const data=await mcpBridgeRequest('/maps/search',{method:'POST',body:{query:row.querySelector('[data-map-query]').value}});
            if (!row.isConnected) return;
            output.replaceChildren();
            const attribution=document.createElement('p'); attribution.textContent=data.attribution || 'Google Maps'; output.append(attribution);
            for (const place of data.places || []) {
                const choice=document.createElement('button'); choice.type='button'; choice.className='btn btn-ghost';
                choice.textContent=`${place.displayName?.text || place.id} — ${place.formattedAddress || ''}`;
                choice.onclick=()=>{if(data.provider==='openrouteservice'){row.querySelector('[data-field="longitude"]').value=place.coordinates[0];row.querySelector('[data-field="latitude"]').value=place.coordinates[1];row.querySelector('[data-field="googlePlaceId"]').value='';}else{row.querySelector('[data-field="googlePlaceId"]').value=place.id;row.querySelector('[data-field="longitude"]').value='';row.querySelector('[data-field="latitude"]').value='';} output.textContent='Place selected. Save life changes to keep it.'; refreshLinkedRoutes();}; output.append(choice);
            }
            if (!data.places?.length) output.append('No places found. Include the city in your search.');
        } catch(error) { output.textContent=error.message; } finally {button.disabled=false;}
    }; });
    const routeSelection=()=>({from:editor.querySelector('[data-route-from]').value,to:editor.querySelector('[data-route-to]').value,mode:editor.querySelector('[data-route-mode]').value});
    const routeDraft={};editor._routeDraft=routeDraft;
    const pendingRoutes=new Set();
    const routeKey=r=>JSON.stringify([r.from,r.to,r.mode]);
    const fingerprint=r=>JSON.stringify([r, ...[r.from,r.to].map(id=>{const p=life.places.find(p=>p.id===id);return [p?.googlePlaceId,p?.mapCoordinates];})]);
    const routeVersions=new Map();
    let selectedEstimate=null;
    function storeLeg(route,minutes,source) {
        const old=life.travelLegs?.find(l=>routeKey(l)===routeKey(route));
        life.travelLegs=(life.travelLegs||[]).filter(l=>routeKey(l)!==routeKey(route));
        life.travelLegs.push({...route,minutes,cost:old?.cost||0,source});
    }
    async function estimateRoute(route) {
        const from=life.places.find(p=>p.id===route.from),to=life.places.find(p=>p.id===route.to);
        if(!from||!to||from.id===to.id)throw Error('Choose two different places.');
        if(!(from.googlePlaceId&&to.googlePlaceId)&&!(from.mapCoordinates&&to.mapCoordinates))throw Error('Map both places first; using fallback minutes.');
        const key=routeKey(route),version=(routeVersions.get(key)||0)+1;routeVersions.set(key,version);
        const signature=fingerprint(route);
        const data=await mcpBridgeRequest('/maps/route',{method:'POST',body:{origin:from.googlePlaceId,destination:to.googlePlaceId,originCoordinates:from.mapCoordinates,destinationCoordinates:to.mapCoordinates,mode:route.mode==='RIDESHARE'?'DRIVE':route.mode}});
        collectCompanionLifeEditorValues(editor,life);
        if(!editor.isConnected||editor._routeDraft!==routeDraft||routeVersions.get(key)!==version||fingerprint(route)!==signature)throw Error('Route changed; estimate discarded.');
        const seconds=Number(String(data.routes?.[0]?.duration||'').replace(/s$/,''));
        if(!Number.isFinite(seconds)||seconds<=0||seconds>21600)throw Error('No supported route within six hours; using fallback minutes.');
        return {minutes:Math.ceil(seconds/60),source:data.attribution||data.provider||'Google Maps'};
    }
    function trackRoute(work){const promise=work();pendingRoutes.add(promise);promise.finally(()=>pendingRoutes.delete(promise));return promise;}
    let linkedGeneration=0;
    function refreshLinkedRoutes(){const generation=++linkedGeneration;return trackRoute(async()=>{
        collectCompanionLifeEditorValues(editor,life);
        const home=life.places.find(p=>p.kind==='home');if(!home){editor.querySelectorAll('[data-home-route-status]').forEach(output=>output.textContent='Set one recurring place to Home first.');return;}
        for(const row of editor.querySelectorAll('[data-life-place]')){
            const place=life.places[Number(row.dataset.lifePlace)],status=row.querySelector('[data-home-route-status]');
            if(editor._routeDraft!==routeDraft||generation!==linkedGeneration)return;
            if(place.id===home.id)continue;
            if(place.travelOverride){storeLeg({from:home.id,to:place.id,mode:place.travelMode},Math.max(1,place.travelMinutesFromHome),'Manual override');status.textContent='Manual override';continue;}
            const route={from:home.id,to:place.id,mode:place.travelMode};
            const prior=life.travelLegs?.find(l=>routeKey(l)===routeKey(route));if(prior?.source==='Manual override')prior.source='Fallback estimate';
            status.textContent='Updating route…';
            try{const result=await estimateRoute(route);if(generation!==linkedGeneration)return;if(place.travelOverride||place.travelMode!==route.mode)continue;
                storeLeg(route,result.minutes,result.source);place.travelMinutesFromHome=result.minutes;
                row.querySelector('[data-field="travelMinutesFromHome"]').value=result.minutes;
                status.textContent=`${route.mode} · ${result.minutes} minutes · ${result.source}. Save life changes.`;
                // Return routes are independent: one-way streets can change the duration.
                const back={from:place.id,to:home.id,mode:route.mode};if(life.travelLegs?.find(l=>routeKey(l)===routeKey(back))?.source!=='Manual override'){const reverse=await estimateRoute(back);if(!place.travelOverride&&place.travelMode===route.mode)storeLeg(back,reverse.minutes,reverse.source);}
            }catch(error){status.textContent=error.message+' Using the last saved duration or fallback.';}
        }
        // Build only links the weekly schedule actually needs, not every map pair.
        const links=new Map();
        const addLink=(from,to)=>{if(!from||!to||from===to||from===home.id||to===home.id)return;
            const mode=life.places.find(p=>p.id===to)?.travelMode||'WALK',route={from,to,mode};links.set(routeKey(route),route);};
        for(let day=0;day<7;day++){
            const blocks=(life.weeklySchedule||[]).filter(b=>b.days.includes(day)).sort((a,b)=>a.startMinute-b.startMinute);
            for(let i=1;i<blocks.length;i++)addLink(blocks[i-1].placeId,blocks[i].placeId);
        }
        for(const leg of life.travelLegs||[])if(leg.from!==home.id&&leg.to!==home.id)links.set(routeKey(leg),{from:leg.from,to:leg.to,mode:leg.mode});
        for(const route of links.values()){
            if(editor._routeDraft!==routeDraft||generation!==linkedGeneration)return;
            if(life.travelLegs?.find(l=>routeKey(l)===routeKey(route))?.source==='Manual override')continue;
            try{const result=await estimateRoute(route);storeLeg(route,result.minutes,result.source);}catch(error){editor.querySelector('[data-route-result]').textContent=error.message;}
        }
    });}
    editor.querySelectorAll('[data-home-route]').forEach(button=>button.onclick=refreshLinkedRoutes);
    editor.querySelectorAll('[data-field="longitude"],[data-field="latitude"],[data-field="googlePlaceId"],[data-field="travelMode"],[data-field="travelOverride"]').forEach(input=>input.onchange=refreshLinkedRoutes);
    editor.querySelectorAll('[data-field="travelMinutesFromHome"]').forEach(input=>input.onchange=()=>{const row=input.closest('[data-life-place]');row.querySelector('[data-field="travelOverride"]').checked=true;refreshLinkedRoutes();});
    editor.querySelectorAll('[data-life-place] [data-field="kind"],[data-life-schedule] [data-field="placeId"]').forEach(input=>input.onchange=refreshLinkedRoutes);
    const preview=()=>trackRoute(async()=>{
        collectCompanionLifeEditorValues(editor,life);const route=routeSelection(),output=editor.querySelector('[data-route-result]');selectedEstimate=null;
        output.textContent='Checking route…';
        try{const result=await estimateRoute(route);if(routeKey(routeSelection())!==routeKey(route))return;
            selectedEstimate={...result,key:routeKey(route)};editor.querySelector('[data-route-minutes]').value=result.minutes;
            output.textContent=`${result.source}: ${result.minutes} minutes. Save travel leg to use this for departure planning.`;
        }catch(error){output.textContent=error.message;}
    });
    editor.querySelector('[data-route-preview]').onclick=preview;
    editor.querySelectorAll('[data-route-from],[data-route-to],[data-route-mode]').forEach(input=>input.onchange=preview);
    editor.querySelector('[data-route-minutes]').oninput=()=>{selectedEstimate=null;const key=routeKey(routeSelection());routeVersions.set(key,(routeVersions.get(key)||0)+1);};
    editor.querySelector('[data-route-add]').onclick=async()=>{
        await Promise.all([...pendingRoutes]);
        collectCompanionLifeEditorValues(editor,life);const route=routeSelection(),minutes=Number(editor.querySelector('[data-route-minutes]').value);
        if(!route.from||!route.to||route.from===route.to||!Number.isFinite(minutes)||minutes<1||minutes>360){showToast('Choose different places and 1–360 minutes.','error');return;}
        storeLeg(route,Math.round(minutes),selectedEstimate?.key===routeKey(route)?selectedEstimate.source:'Manual override');
        const home=life.places.find(p=>p.kind==='home'),destination=life.places.find(p=>p.id===route.to);
        if(route.from===home?.id&&destination?.travelMode===route.mode){destination.travelMinutesFromHome=Math.round(minutes);destination.travelOverride=life.travelLegs.at(-1).source==='Manual override';}
        life.travelLegs.at(-1).cost=Math.max(0,Number(editor.querySelector('[data-route-cost]').value)||0);
        renderCompanionLifeEditor(companion,life);
    };
    editor.querySelectorAll('[data-route-remove]').forEach(button=>{button.onclick=()=>{collectCompanionLifeEditorValues(editor,life);life.travelLegs.splice(Number(button.dataset.routeRemove),1);renderCompanionLifeEditor(companion,life);};});
    editor.querySelector('#cs-life-editor-cancel').onclick = () => {
        editor.classList.add('hidden');
        overview?.classList.remove('hidden');
    };
    editor.querySelector('#cs-life-editor-save').onclick = async () => {
        await Promise.all([...pendingRoutes]);
        collectCompanionLifeEditorValues(editor, life);
        // The separate inventory/reference editors save immediately. A stale
        // schedule draft must not roll back their newer authored data.
        life.world = companion.lifeProfile.world;
        life.decisionPolicy=companion.lifeProfile.decisionPolicy;
        life.sleepPolicy=companion.lifeProfile.sleepPolicy;
        life.breakPolicy=companion.lifeProfile.breakPolicy;
        for (const current of companion.lifeProfile.places) {
            const drafted=life.places.find(p=>p.id===current.id);
            if(drafted){for(const key of ['photo','referenceDescription','referenceDisabled','parentPlaceId','referenceRole','referenceAliases'])drafted[key]=current[key];}
            else if(!life._initialPlaceIds.includes(current.id))life.places.push(current);
        }
        if(getActiveCompanionTimeline(companion.id)?.vh2){await vhReviewLifeProposal(companion,life);return;}
        companion.lifeProfile = normalizeCompanionLifeProfile(life);
        await saveState();
        editor.classList.add('hidden');
        renderCompanionLifeOverview(companion);
    if(typeof vhStudioLifeHome==='function')vhStudioLifeHome(companion);
        renderCompanionPhotoLocations(companion);
        renderCompanionWorldSystems(companion);
        showToast('Active life changes saved.', 'success');
    };
    editor.querySelector('[data-add-preparation]').onclick=()=>{collectCompanionLifeEditorValues(editor,life);const block=life.weeklySchedule.find(b=>b.id===editor.querySelector('[data-preparation-template]').value);if(!block||life.supplies.length>=30||life.activityOptions.length>=16){showToast('Choose an appointment and leave room for a supply and activity.','error');return;}const id=`ready_${Date.now()}`;life.supplies.push({id,label:`Ready for ${block.activity}`.slice(0,80),quantity:0});block.departureCosts={...block.departureCosts,[id]:1};life.activityOptions.push(VHActivityEngine.normalizeOpportunities([{id:`prepare_${Date.now()}`,label:`Get ready for ${block.activity}`,kind:'preparation',days:block.days,startMinute:Math.max(0,block.startMinute-60),endMinute:block.endMinute>block.startMinute?block.endMinute:1440,priority:20,durationMinutes:10,minEnergy:5,requiredPlaceId:life.places.find(p=>p.kind==='home')?.id||'',produces:{[id]:1},reason:'Preparation is required before departure.'}])[0]);renderCompanionLifeEditor(companion,life);};
    editor.querySelectorAll('[data-remove-supply]').forEach(button=>button.onclick=()=>{collectCompanionLifeEditorValues(editor,life);const id=button.dataset.removeSupply;const referenced=life.activityOptions.some(o=>o.costs?.[id]||o.produces?.[id])||life.weeklySchedule.some(b=>b.departureCosts?.[id]);if(referenced){showToast('Remove this supply from activity and departure requirements first.','error');return;}life.supplies=life.supplies.filter(x=>x.id!==id);renderCompanionLifeEditor(companion,life);});
    editor.querySelectorAll('[data-life-remove]').forEach(button => {
        button.onclick = () => {
            const row = button.closest('[data-life-place],[data-life-person],[data-life-schedule],[data-life-look],[data-life-wildcard],[data-life-opportunity]');
            const type = button.dataset.lifeRemove;
            const map = {
                place: ['places', 'lifePlace'], person: ['socialCircle', 'lifePerson'],
                schedule: ['weeklySchedule', 'lifeSchedule'], look: ['wardrobe', 'lifeLook'],
                wildcard: ['wildcardDeck', 'lifeWildcard'], opportunity: ['activityOptions', 'lifeOpportunity']
            }[type];
            if (!row || !map) return;
            collectCompanionLifeEditorValues(editor, life);
            life[map[0]].splice(Number(row.dataset[map[1]]), 1);
            renderCompanionLifeEditor(companion, life);
        };
    });
    editor.querySelectorAll('[data-remove-contact-window]').forEach(button => {
        button.onclick = () => {
            collectCompanionLifeEditorValues(editor, life);
            const [personIndex, index] = button.dataset.removeContactWindow.split(':').map(Number);
            life.socialCircle[personIndex]?.contactWindows.splice(index, 1);
            renderCompanionLifeEditor(companion, life);
        };
    });
    editor.querySelectorAll('[data-life-add]').forEach(button => {
        button.onclick = () => {
            const type = button.dataset.lifeAdd;
            collectCompanionLifeEditorValues(editor, life);
            if(type==='supply'&&life.supplies.length<30)life.supplies.push({id:`supply_${Date.now()}`,label:'New supply',quantity:0});
            if (type === 'opportunity') life.activityOptions.push(VHActivityEngine.normalizeOpportunities([{ id: livingId('opportunity', `${Date.now()}|${Math.random()}`), kind: 'focus', label: 'A personal task' }])[0]);
            if (type === 'contact-window') {
                const person = life.socialCircle[Number(button.dataset.personIndex)];
                if (person && person.contactWindows.length < 14) person.contactWindows.push({ days: [1,2,3,4,5], startMinute: 1080, endMinute: 1200 });
            }
            if (type === 'place') life.places.push(normalizeCompanionLifePlace({ label: 'New place', kind: 'other' }, life.places.length));
            if (type === 'person') life.socialCircle.push(normalizeCompanionSocialPerson({ name: 'New person' }, life.socialCircle.length));
            if (type === 'schedule') life.weeklySchedule.push(normalizeCompanionScheduleBlock({ days: [1], startMinute: 540, endMinute: 600, activity: 'New activity', availability: 'busy' }, life.weeklySchedule.length));
            if (type === 'look') life.wardrobe.push(normalizeCompanionWardrobeLook({ label: 'New look', context: 'home', items: 'Describe the clothes' }, life.wardrobe.length));
            if (type === 'wildcard') life.wildcardDeck.push(normalizeCompanionWildcard({ label: 'Describe what happens', category: 'inconvenience', minGapDays: 10 }, life.wildcardDeck.length));
            renderCompanionLifeEditor(companion, life);
        };
    });
}
