/* Shared authoring schema. Loaded before the workspace and application. No runtime state. */
'use strict';
const VH_EXECUTABLE_POLICY_KEYS = ['finance','exploration','peopleLives','institutions','rooms','referencePlan','routes','sleepPolicy','breakPolicy','autonomy','socialPolicy','geography','population','socialPlanPolicy','socialPrivateVisitPermissions','healthPolicy','psychologyPolicy','relationshipPolicy','storyPolicy','personalPreferences','possessions'];
const VH_LIFE_POLICY_LABELS = {institutions:'Attendance & commitments',autonomy:'Independent life',socialPolicy:'Meeting people',geography:'What places offer',population:'People in the world',socialPlanPolicy:'Invitations and shared plans',socialPrivateVisitPermissions:'Private visit boundaries',healthPolicy:'Health and recovery',psychologyPolicy:'Learning from experience',relationshipPolicy:'Trust and relationship development',storyPolicy:'Story & everyday drama',personalPreferences:'Personal preferences & boundaries'};
const VH_BUILDER_SECTION_KEYS=[...VH_EXECUTABLE_POLICY_KEYS,'personalCalendar','places','socialCircle','wardrobe','styleProfiles','weeklySchedule','activityOptions','fashionSense','grooming','foodHabits','mediaHabits','moneyPattern','healthRoutine','digitalLife','seasonalVariation','workweekDays'];

// Builder instructions describe the existing owners; they are not another simulation policy.
function vhBuilderEngineGuide(){return `HOW THIS ENGINE USES YOUR DRAFT
You are configuring an initial situation and repeatable opportunities, not writing the future. The same saved life supplies movement, chat, memories, social posts and reference-aware media. A biography sentence does not configure a capability. Translate meaningful facts into the existing fields below and leave outcomes open.

1. MOTIVE -> OPPORTUNITY -> FRICTION -> POSSIBLE EXPERIENCE. A person who misses a distant parent needs a known parent with their own home/timezone, contact windows and a contact activity; do not move the parent into their home. Someone uncertain about their studies needs actual class commitments and a small optional coursework or exploration task, not "be at campus". Someone who loves solitude still needs things they enjoy alone. Do not add a motive just to populate a feature.
2. NEEDS AND SPACE. Hunger, fatigue, stress, sleep and social need compete with goals. Geography chooses reachable, accessible places with food/rest/leisure/exercise/swimming capabilities. A label such as gym, kitchen or cafe alone grants no capability. A meal needs food access; a swim needs an accessible pool; travel needs realistic time and cost. Indoor rooms are reference/scene continuity under a place, not separate cities. Remote people are available through calls; no cross-country walking edges. exploration interests/curiosity help them notice world reports; geography controls movement. Neither means unlimited freedom or instant travel.
3. ACTIONS ARE ATTEMPTS. activityOptions are reusable focus/leisure/recovery/meal/contact choices, with a personal reason, realistic window, duration, repeat interval and place/person links. They compete and can be delayed or abandoned. Study does not confer a degree; a social opportunity does not guarantee friendship, romance or intimacy. Work shifts/classes/appointments belong in weeklySchedule, not meals, random boredom or scripted romantic outcomes. Preserve unscheduled time. Use institutions to link attendance thresholds and modest missed-commitment stress to actual classes or shifts where appropriate; this records attendance, not grades, graduation, firing or official academic standing. Never invent school fees or punitive consequences. Empty institutions means no additional attendance rule. Terms and temporary work need end dates/breaks; use dated fictional assumptions when real dates are unknown.
4. INDEPENDENT PEOPLE. Supporting people have their own residence, resources, transport, commitments, sleep and local clock. Invitations and encounters require compatible attention, access and availability on both sides. Closeness is not trust, trust is not attraction, and neither is consent. Distinct personalities do not require everyone to be maximally different. Match the cast size to the brief, including isolation, estrangement or no known relatives. Do not invent a sister or partner to fill a quota.
5. MONEY AND OBJECTS. Currency follows the authored setting. Starting funds/possessions are once-only new-life assumptions. incomePerHour needs actual paid workPlaceIds and time at work; a daily stipend uses dailyIncome. Do not double-count the same income or price a habit beyond means without a deliberate, visible conflict. Activity costs/produces use real supported supplies, not money, grades or invented abstract tokens. Existing lives retain balances, owned assets, relationships and current positions.
6. EMOTIONS AND LEARNING. Personality describes motives, coping and contradictions; regulation, rumination, trust and psychology settings change response tendencies, persistence and learning. They are not diagnoses or guaranteed reactions. Choose a few evidence-backed differences, with moderate defaults for genuinely unknown traits. Do not maximize drama, sociability, emotional impact, illness or intimate behavior to make someone feel alive. Health variation is optional ordinary illness/recovery, not a model of every condition.
7. EXPRESSION AND EVIDENCE. Chat reacts to actual committed state and recalled experiences. Simulated social posts come from lived moments; provider jobs create media only when separately configured/authorized. Reference plans describe appearance, layouts and objects with stable entity IDs; they are not generated assets. Do not put a person's role in place of physical appearance or schedule posts as facts. Preserve the user's existing media/provider permissions.
8. WORLD AND LIFE DIRECTION. Personal dates provide reminders, not automatic celebrations. Public event feeds are claims/opportunities, not proof of attendance. Optional story pacing and a daily adviser suggest bounded opportunities through this same engine; they do not force trips, disasters, relationships or narrative endings. Explain requested situations the current fields cannot execute. Never invent new schema keys or fake implementation with persuasive prose.

Before returning, mentally walk an ordinary work/study day and a free day: where can they eat/rest, what could they choose without a prompt, who could answer a call, how would cost/travel/obligations constrain them, and what would chat truthfully know afterward? Offer at least one plausible alternative to a preference; do not return a fixed story. Preserve individual contradictions instead of optimizing every life for productivity or sociability.`;}

function vhBuilderLifeDesign(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
 const text=(v,n)=>typeof v==='string'?v.trim().slice(0,n):'';
 const design={premise:text(raw.premise,600),anchors:(Array.isArray(raw.anchors)?raw.anchors:[]).map(v=>text(v,400)).filter(Boolean).slice(0,12),motivations:(Array.isArray(raw.motivations)?raw.motivations:[]).filter(v=>v&&typeof v==='object').slice(0,5).map(v=>Object.fromEntries(['want','why','opportunity','friction'].map(k=>[k,text(v[k],400)]))).filter(v=>v.want&&v.opportunity),socialShape:text(raw.socialShape,600),everydayTexture:text(raw.everydayTexture,600),limits:(Array.isArray(raw.limits)?raw.limits:[]).map(v=>text(v,400)).filter(Boolean).slice(0,8)};
 return design.premise||design.motivations.length?design:null;
}

function vhBuilderIdentity(companion){
 const keys=[...COMPANION_BUILDER_FIELDS,'personalPreferences','socialWritingStyle','socialPostingRules','socialContentTypes','socialPlatform','socialFeedEnabled','socialAudience','socialPostFrequency','socialPhotoRatio','socialFeedImages','allowPhotos','allowVideoClips','allowVoiceNotes'];
 return Object.fromEntries(keys.filter(k=>companion[k]!==undefined).map(k=>[k,safeJsonClone(companion[k])]));
}

function vhBuilderAuthoredSetup(companion){
 const keys=VH_BUILDER_SECTION_KEYS;
 const source={...companion.lifeProfile,...companion.lifeSetupPolicies,styleProfiles:companion.lifeStyleProfiles||[]};
 return Object.fromEntries(keys.filter(k=>source[k]!==undefined).map(k=>[k,safeJsonClone(source[k])]));
}

function vhBuilderDossier(companion,options={},source={}){
 const active=getActiveCompanionTimeline(companion.id);
 const now=Number.isFinite(active?.vh2?.simAt)?active.vh2.simAt:Date.now();
 return {...vhBuilderIdentity(companion),name:companion.name,requestedDirection:String(options.direction||''),existingPersistentLife:!!active?.vh2,
  asOf:{utc:new Date(now).toISOString(),localDate:companionLocalMinuteInfo(companion,now).dateKey,timeZone:companion.timezone||'UTC',source:active?.vh2?'active life clock':'current clock'},
  authority:'The user brief is the requested change. Existing authored facts/IDs remain unless that change explicitly replaces them. Generated profile/design entries are proposals, not additional user instructions or lived events.',
  lifeDesign:vhBuilderLifeDesign(options.lifeDesign),currentLifeSetup:{...vhBuilderAuthoredSetup(companion),...source},
  location:companion.locationLabel,countryCode:companion.locationCountryCode,timezone:companion.timezone,
  libidoEnabled:companionSexualSystemActive(companion)};
}

function vhLifeCoherenceFindings(draft){
 const rows=k=>Array.isArray(draft[k])?draft[k]:[],issues=[],add=(section,detail)=>issues.push({section,detail});
 if(draft.autonomy&&draft.geography&&draft.autonomy.enabled!==draft.geography.enabled)add('geography','Independent life and geographic movement disagree about being enabled.');
 if(draft.socialPolicy&&draft.population&&draft.socialPolicy.introductionsEnabled!==draft.population.enabled)add('population','Introductions and local population disagree about being enabled.');
 if(draft.finance?.enabled&&draft.finance.incomePerHour>0&&!draft.finance.workPlaceIds?.length)add('finance','Hourly earnings have no paid workplace; use the actual workplace or a daily income source.');
 else if(draft.finance?.enabled&&draft.finance.incomePerHour>0&&Array.isArray(draft.finance.workPlaceIds)&&!rows('weeklySchedule').some(b=>b&&draft.finance.workPlaceIds.includes(b.placeId)))add('weeklySchedule','Hourly earnings need an actual work commitment at a paid workplace.');
 for(const a of rows('activityOptions')){
  if(!a||typeof a!=='object')continue;
  if(a.kind==='contact'){
   const person=rows('socialCircle').find(p=>p?.id===a.participantId);
   if(!person)add('activityOptions',(a.label||a.id)+': a contact activity needs a known participant.');
   else if(!Array.isArray(person.contactWindows)||!person.contactWindows.length)add('socialCircle',(person.name||person.id)+': a contact activity needs plausible contact windows.');
  }
  if(a.kind==='meal'&&a.requiredPlaceId){
   const place=(Array.isArray(draft.geography?.places)?draft.geography.places:[]).find(p=>p?.placeId===a.requiredPlaceId);
   if(!Array.isArray(place?.capabilities)||!place.capabilities.includes('food'))add('geography',(a.label||a.id)+': the meal location has no food capability.');
  }
 }
 for(const b of rows('weeklySchedule'))if(b&&/^(classes, study and campus obligations|unscheduled time|errands and unstructured personal time|spending the evening with people they know)$/i.test(String(b.activity||'').trim()))add('weeklySchedule',(b.activity||b.id)+': replace this generic placeholder with actual commitments or optional activities.');
 for(const rule of rows('institutions'))if(!rows('weeklySchedule').some(b=>b?.id===rule?.scheduleId))add('institutions',(rule?.label||rule?.id||'Attendance rule')+': link to an existing scheduled commitment.');
 return issues.slice(0,20);
}
