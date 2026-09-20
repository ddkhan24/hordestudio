/* Searchable authoring library for the Virtual Human mind engine.
 * These are composable characterization modules, not diagnoses or claims
 * about real people. Adult interests, harmful behavior, substance patterns,
 * and clinical lived experience stay in separate categories on purpose.
 */
(function (root, factory) {
    const library = factory();
    if (typeof module === 'object' && module.exports) module.exports = library;
    else root.VHMindLibrary = library;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const trigger = (id, label, cues, effect, intensity, expression, aftermath, extra = {}) => ({
        id, label, cues, effect, intensity, cooldownMinutes: extra.cooldownMinutes || 45,
        expression, aftermath, adultOnly: extra.adultOnly === true
    });
    const preset = (label, category, summary, config = {}) => ({
        label, category, summary,
        tags: config.tags || [], aliases: config.aliases || [], axes: config.axes || {},
        behaviors: config.behaviors || [], triggers: config.triggers || [],
        mechanics: config.mechanics || {}, clinical: config.clinical === true,
        adultOnly: config.adultOnly === true, hazardous: config.hazardous === true,
        consentRisk: config.consentRisk === true
    });

    const PRESETS = {
        // Fictional/dark archetypes describe conduct. They are not diagnoses.
        possessive_fixation: preset('Yandere / possessive fixation', 'fictional archetype',
            'Intense exclusivity, monitoring and fear of replacement. Obsession is not automatically a diagnosis.', {
                tags:['obsession','jealousy','possessive','dark romance'],aliases:['yandere','crazy girlfriend','crazy boyfriend'],
                axes:{fixation:96,jealousy:88,rejectionSensitivity:92,affectVolatility:78,impulsivity:66,compulsivity:72,suspiciousness:68,empathy:48,selfRestraint:34},
                behaviors:['seeks exclusivity','tracks small inconsistencies','oscillates between tenderness, panic and control','may pursue or monitor instead of calmly waiting'],
                mechanics:{initiativeMultiplier:.58,activityBias:{contact:18},notes:['Separation and ambiguity keep the player unusually salient.']},
                triggers:[
                    trigger('replacement','Possible replacement',['someone else','another girl','another guy','my date','new partner','seeing someone'],'jealousy',82,'compare, probe, compete, withdraw, assert exclusivity, or force composure','rumination and renewed checking'),
                    trigger('abandonment','Distance or abandonment',['leave me','break up','stop talking','need space','do not contact me','goodbye forever'],'fixation',92,'pursue, bargain, monitor, panic, become cold, or resist the urge','shame, resentment, renewed pursuit, or exhausted withdrawal')
                ]}),
        stalker_pattern: preset('Stalker pattern', 'fictional archetype',
            'Persistent monitoring, information seeking and boundary-testing. Configure the fiction deliberately.', {
                tags:['monitoring','pursuit','boundary violation','surveillance'],aliases:['stalker','creep','creepy','obsessive pursuer'],consentRisk:true,
                axes:{fixation:91,jealousy:70,rejectionSensitivity:76,compulsivity:86,suspiciousness:82,empathy:32,selfRestraint:24},
                behaviors:['collects details and routines','checks availability and inconsistencies','finds reasons to reappear','may rationalize boundary-testing as care'],
                mechanics:{initiativeMultiplier:.52,activityBias:{contact:24},termBias:{check:12,monitor:18,follow:16},notes:['Missing access increases checking and contact pressure; it never proves access or location.']},
                triggers:[trigger('missing_access','Loss of access',['blocked','turned off location','private account','where were you','did not answer','ignored me'],'suspicion',84,'check, investigate, confront, invent a pretext to reconnect, or resist the urge','temporary relief if reassured; stronger checking if uncertainty remains')]}),
        obsessive_admirer: preset('Obsessive admirer', 'fictional archetype',
            'Idealizes one person and turns small details into an emotionally consuming private focus.', {
                tags:['crush','idealization','fan','fixation'],aliases:['obsessed fan','simp','secret admirer'],
                axes:{fixation:90,rejectionSensitivity:78,compulsivity:65,empathy:62,selfRestraint:45},
                behaviors:['replays interactions','collects symbolic reminders','overweights tiny signs of attention','can conceal the intensity behind ordinary politeness'],
                mechanics:{initiativeMultiplier:.68,activityBias:{contact:12},notes:['Attention from the focus person has unusually high salience.']}}),
        controlling_partner: preset('Controlling partner', 'fictional archetype',
            'Seeks authority over routines, access and relationships, often disguising control as concern.', {
                tags:['control','coercive','possessive','jealous'],aliases:['control freak','toxic partner'],consentRisk:true,
                axes:{fixation:74,jealousy:78,suspiciousness:72,empathy:35,selfRestraint:38},
                behaviors:['asks for explanations and access','frames demands as protection','tests compliance','may punish independence with coldness or conflict'],
                triggers:[trigger('independence','Unapproved independence',['none of your business','my own decision','you cannot tell me','going out without you'],'anger',72,'pressure, guilt, interrogate, withdraw, threaten the relationship, or reconsider','resentment, tactical apology, or escalation')]}),
        revenge_brooder: preset('Revenge brooder', 'fictional archetype',
            'Stores grievances, rehearses retaliation and waits for a moment that feels proportionate.', {
                tags:['grudge','revenge','resentment','retaliation'],aliases:['psycho','vengeful','vindictive'],
                axes:{rejectionSensitivity:75,affectVolatility:66,compulsivity:62,suspiciousness:72,empathy:38,selfRestraint:55},
                behaviors:['keeps a private ledger of slights','rehearses confrontations','can act warm while still planning','may abandon revenge when consequences become concrete'],
                mechanics:{replyMultiplier:1.12,notes:['Grievances decay slowly and can shape later choices.']}}),
        manipulative_charmer: preset('Manipulative charmer', 'fictional archetype',
            'Uses warmth, mirroring and selective disclosure instrumentally while preserving plausible deniability.', {
                tags:['manipulation','charm','deception','love bombing'],aliases:['sociopath','psychopath','player'],
                axes:{empathy:28,selfRestraint:72,noveltySeeking:66,disinhibition:42},
                behaviors:['mirrors preferences','alternates reward and distance','reveals calculated vulnerability','tracks which approach gets compliance'],
                mechanics:{initiativeMultiplier:.82,activityBias:{contact:8},notes:['Social expression can be strategic rather than sincere.']}}),
        cold_schemer: preset('Cold schemer', 'fictional archetype',
            'Plans several moves ahead, hides motives and treats social situations as leverage problems.', {
                tags:['calculating','villain','deceptive','strategic'],aliases:['psycho','psychopath','mastermind'],
                axes:{affectVolatility:16,impulsivity:14,empathy:24,selfRestraint:94,suspiciousness:68},
                behaviors:['withholds the real objective','uses patience as an advantage','prefers indirect pressure','can simulate normal warmth without feeling hurried'],
                mechanics:{replyMultiplier:1.18,activityBias:{focus:18},notes:['Deliberation and hidden objectives weigh more than immediate emotion.']}}),
        chaos_agent: preset('Chaos agent', 'fictional archetype',
            'Creates disruption for novelty, amusement, dominance or relief from boredom.', {
                tags:['chaotic','unpredictable','reckless','provocateur'],aliases:['crazy','unhinged','wild card'],
                axes:{affectVolatility:75,impulsivity:94,noveltySeeking:98,disinhibition:92,selfRestraint:10,empathy:42},
                behaviors:['introduces provocative ideas','changes plans abruptly','pushes social situations past comfort','may regret consequences only after stimulation fades'],
                mechanics:{initiativeMultiplier:.72,activityBias:{leisure:16,contact:8},notes:['Novel or disruptive choices receive more weight.']}}),
        wired_spiral: preset('Wired chaos spiral', 'fictional archetype',
            'Erratic high-arousal, sleepless, novelty-seeking behavior without asserting substance use or a diagnosis.', {
                tags:['wired','sleepless','erratic','chaotic'],aliases:['tweaky','manic energy','crazy'],
                axes:{noveltySeeking:96,impulsivity:91,disinhibition:88,suspiciousness:68,affectVolatility:82,selfRestraint:12},
                behaviors:['jumps between plans','sends bursts of intense messages','takes poorly considered risks','can crash into irritability or exhaustion'],
                mechanics:{initiativeMultiplier:.66,replyMultiplier:.72,activityBias:{leisure:14,focus:6}}}),
        parasocial_fixation: preset('Parasocial fixation', 'fictional archetype',
            'Treats mediated familiarity as emotionally intimate while lacking reciprocal shared history.', {
                tags:['parasocial','fan','creator','online obsession'],aliases:['stan','obsessed follower'],
                axes:{fixation:88,rejectionSensitivity:78,compulsivity:72,suspiciousness:48,selfRestraint:42},
                behaviors:['remembers public details','interprets general posts personally','feels entitled to recognition','may know the relationship is one-sided and still feel consumed'],
                mechanics:{initiativeMultiplier:.7,activityBias:{contact:12},termBias:{online:10,feed:12,profile:12}}}),

        // Recurring behavior patterns.
        volatile_attachment: preset('Volatile attachment', 'behavior pattern',
            'High rejection sensitivity and rapidly changing approach/withdrawal pressure.', {
                tags:['attachment','push pull','idealization','rejection'],aliases:['unstable','hot and cold'],
                axes:{rejectionSensitivity:95,affectVolatility:92,impulsivity:76,jealousy:66,empathy:68,selfRestraint:32},
                behaviors:['reads distance intensely','alternates pursuit and withdrawal','may idealize, devalue, repair or regret','feels more than one thing at once'],
                mechanics:{initiativeMultiplier:.72,replyMultiplier:.9,activityBias:{contact:10}},
                triggers:[trigger('coldness','Perceived coldness',['whatever','k','fine.','busy now','leave me alone','not interested'],'anxiety',78,'seek reassurance, protest, lash out, go quiet, or ask directly','shame, anger, repair attempt, or lingering uncertainty')]}),
        compulsive_checker: preset('Compulsive checker', 'behavior pattern',
            'Uncertainty builds an urge to check, repeat or seek reassurance; relief is temporary.', {
                tags:['checking','reassurance','uncertainty','ritual'],aliases:['obsessive checker'],
                axes:{compulsivity:94,rejectionSensitivity:68,suspiciousness:62,selfRestraint:48},
                behaviors:['rechecks messages and details','seeks reassurance despite already receiving it','gets temporary relief from checking','can know the urge is excessive and still feel it'],
                mechanics:{initiativeMultiplier:.78,termBias:{check:18,verify:18},notes:['Uncertainty increases repetitive verification pressure.']},
                triggers:[trigger('uncertainty','Uncertainty',['maybe','not sure','i think','probably','we will see','later'],'compulsion',76,'ask again, verify, repeat a ritual, delay, or consciously resist','brief relief followed by doubt returning')]}),
        rage_pressure: preset('Hair-trigger anger', 'behavior pattern',
            'Fast confrontation pressure and slow consequence-awareness; anger still does not dictate abuse.', {
                tags:['anger','temper','confrontation','irritable'],aliases:['anger issues','rage','hothead'],
                axes:{affectVolatility:94,impulsivity:84,rejectionSensitivity:76,disinhibition:72,selfRestraint:18,empathy:42},
                behaviors:['reacts before fully appraising','uses sharp language or confronts','may cool off, double down or regret it','can redirect anger rather than obey it'],
                mechanics:{replyMultiplier:.72,notes:['Perceived disrespect speeds expression and reduces deliberation.']},
                triggers:[trigger('disrespect','Perceived disrespect',['shut up','you are crazy','pathetic','loser','hate you','you lied'],'anger',88,'confront, cut off, retaliate verbally, demand repair, or take space','adrenaline, rumination, regret, or a grudge')]}),
        chronic_liar: preset('Chronic liar', 'behavior pattern',
            'Defaults to distortion, omission or invention when truth feels boring, risky or inconvenient.', {
                tags:['lying','deception','cover stories','dishonesty'],aliases:['pathological liar','bullshitter'],
                axes:{impulsivity:58,noveltySeeking:64,empathy:38,selfRestraint:44},
                behaviors:['edits stories for effect','maintains overlapping cover stories','lies even without obvious gain','may confess when contradictions become costly'],
                mechanics:{notes:['Truth and disclosure should diverge without changing canonical world facts.']}}),
        attention_seeking: preset('Attention-seeking performer', 'behavior pattern',
            'Escalates expression when ignored and feels most real while being watched or discussed.', {
                tags:['attention','dramatic','performance','validation'],aliases:['drama queen','clout chaser'],
                axes:{rejectionSensitivity:80,affectVolatility:72,impulsivity:70,noveltySeeking:76,selfRestraint:34},
                behaviors:['amplifies stories','posts or messages for reaction','turns silence into a test','can feel empty after attention fades'],
                mechanics:{initiativeMultiplier:.66,activityBias:{contact:18},termBias:{post:16,selfie:10}}}),
        approval_hungry: preset('Approval hungry', 'behavior pattern',
            'Scans for praise, adapts quickly to expectations and takes criticism disproportionately hard.', {
                tags:['people pleasing','validation','praise','rejection'],aliases:['people pleaser','needy'],
                axes:{rejectionSensitivity:88,empathy:74,selfRestraint:58},
                behaviors:['overprepares for approval','changes presentation to fit the room','asks whether things are okay','may resent the compliance they volunteered'],
                triggers:[trigger('criticism','Criticism',['disappointed in you','not good enough','you messed up','wrong again'],'anxiety',70,'apologize, overexplain, seek reassurance, become defensive, or withdraw','rumination and renewed approval-seeking')]}),
        conflict_avoider: preset('Conflict avoider', 'behavior pattern',
            'Delays, softens or disappears from conflict even when avoidance creates larger problems.', {
                tags:['avoidance','ghosting','appeasement','withdrawal'],aliases:['cowardly','nonconfrontational'],
                axes:{rejectionSensitivity:72,empathy:70,selfRestraint:74,impulsivity:18},
                behaviors:['uses vague agreement','changes the subject','delays difficult replies','may finally erupt after prolonged suppression'],
                mechanics:{replyMultiplier:1.35,activityBias:{contact:-12}}}),
        passive_aggressive: preset('Passive-aggressive protest', 'behavior pattern',
            'Expresses resentment indirectly through delay, ambiguity, selective effort or deniable barbs.', {
                tags:['resentment','indirect conflict','sarcasm','protest'],aliases:['petty','snide'],
                axes:{rejectionSensitivity:70,suspiciousness:58,selfRestraint:66,empathy:48},
                behaviors:['says yes while resisting','uses pointed jokes','withholds effort','denies hostility when confronted'],
                mechanics:{replyMultiplier:1.18}}),
        risk_chaser: preset('Risk chaser', 'behavior pattern',
            'Needs uncertainty, speed or consequence to feel engaged.', {
                tags:['risk','reckless','thrill','novelty'],aliases:['adrenaline junkie','reckless'],
                axes:{impulsivity:86,noveltySeeking:96,disinhibition:82,selfRestraint:18},
                behaviors:['chooses the vivid option over the safe one','minimizes future cost','gets restless with routine','may panic or rationalize after consequences arrive'],
                mechanics:{initiativeMultiplier:.82,activityBias:{leisure:14},notes:['Novel opportunities receive more weight than familiar low-risk ones.']}}),
        perfectionist_pressure: preset('Perfectionist pressure', 'behavior pattern',
            'Treats mistakes as identity threats and can overwork, procrastinate or micromanage.', {
                tags:['perfectionism','control','work','shame'],aliases:['perfectionist','type a'],
                axes:{compulsivity:82,rejectionSensitivity:72,selfRestraint:88,empathy:58},
                behaviors:['revises beyond usefulness','notices flaws before successes','delays exposure until work feels safe','can impose impossible standards on others'],
                mechanics:{activityBias:{focus:22,leisure:-10},replyMultiplier:1.12}}),
        hoarding_tendency: preset('Hoarding tendency', 'behavior pattern',
            'Feels unusually strong attachment, future utility or safety in accumulated objects.', {
                tags:['hoarding','clutter','saving','objects'],aliases:['hoarder','pack rat'],
                axes:{compulsivity:78,rejectionSensitivity:48,selfRestraint:52},
                behaviors:['finds reasons every object may matter','experiences discarding as loss','organizes intentions more easily than possessions','can conceal the extent of clutter'],
                mechanics:{activityBias:{leisure:8},termBias:{collect:18,shop:8,discard:-20}}}),
        gambler_spiral: preset('Gambling spiral', 'behavior pattern',
            'Chases uncertainty and losses while money, secrecy and promises tighten around the behavior.', {
                tags:['gambling','betting','debt','chasing losses'],aliases:['gambler','degenerate gambler'],hazardous:true,
                axes:{impulsivity:88,noveltySeeking:92,disinhibition:82,selfRestraint:18},
                behaviors:['treats losses as reasons to continue','hides time or money spent','makes emotionally convincing stop-promises','feels flat outside the next chance'],
                mechanics:{activityBias:{leisure:12},termBias:{gamble:34,casino:34,bet:30},notes:['Authored gambling opportunities gain salience; financial consequences remain real.']}}),
        compulsive_spending: preset('Compulsive spending', 'behavior pattern',
            'Uses acquisition for mood change despite later financial stress, concealment or regret.', {
                tags:['shopping','spending','debt','impulse'],aliases:['shopaholic','impulse buyer'],
                axes:{impulsivity:82,noveltySeeking:80,selfRestraint:22},
                behaviors:['browses when distressed or bored','justifies purchases as exceptions','hides packages or totals','experiences a short lift followed by guilt'],
                mechanics:{activityBias:{leisure:8},termBias:{shop:30,buy:22,mall:24}}}),

        // Clinical-lived-experience modules model selected symptom domains only.
        ocd_lived_experience: preset('OCD-like intrusive thought cycle', 'clinical lived experience',
            'Unwanted intrusive thoughts and compulsions that briefly reduce distress. Not pleasure, violence or a quirky preference.', {
                clinical:true,tags:['OCD','intrusive thoughts','compulsions','rituals'],aliases:['obsessive compulsive disorder'],
                axes:{compulsivity:98,rejectionSensitivity:58,suspiciousness:52,selfRestraint:64,empathy:70},
                behaviors:['experiences intrusive doubts as unwanted','performs mental or visible rituals for temporary relief','may hide symptoms or recognize they are excessive','distress and time cost matter'],
                mechanics:{replyMultiplier:1.12,notes:['Intrusive uncertainty and rituals consume time without becoming preferences.']},
                triggers:[trigger('intrusive_uncertainty','Intrusive uncertainty',['what if','are you sure','contaminated','did i lock','did i send','something bad'],'compulsion',82,'check, repeat, neutralize, seek reassurance, postpone, or resist while distressed','temporary anxiety relief; the doubt may return')]}),
        psychosis_lived_experience: preset('Psychosis-spectrum lived experience', 'clinical lived experience',
            'Possible perception, belief, organization and withdrawal changes. It does not imply violence, stalking or split personalities.', {
                clinical:true,tags:['psychosis','schizophrenia','hallucinations','delusions','withdrawal'],aliases:['schizophrenia','schizo'],
                axes:{suspiciousness:78,rejectionSensitivity:56,affectVolatility:54,impulsivity:38,empathy:64,selfRestraint:54},
                behaviors:['may struggle to test a perception or belief','can become guarded or cognitively overloaded','may withdraw or communicate less clearly','can also have ordinary, lucid, affectionate and capable moments'],
                mechanics:{replyMultiplier:1.14,activityBias:{contact:-8},notes:['Organization, motivation and reality-testing may vary without implying dangerousness.']}}),
        borderline_lived_experience: preset('Borderline-pattern lived experience', 'clinical lived experience',
            'Emotion-regulation, rejection-sensitivity, identity and relationship instability traits. Symptoms vary by person.', {
                clinical:true,tags:['BPD','emotion dysregulation','abandonment','identity'],aliases:['borderline personality disorder','borderline'],
                axes:{rejectionSensitivity:97,affectVolatility:94,impulsivity:78,jealousy:64,empathy:72,selfRestraint:28},
                behaviors:['feels possible rejection intensely','may shift between closeness and defensive distance','can act impulsively under emotional pressure','may repair, reflect, learn and stabilize'],
                mechanics:{replyMultiplier:.94,notes:['Interpersonal cues can produce rapid, intense but non-deterministic shifts.']}}),
        depressive_lived_experience: preset('Depressive lived experience', 'clinical lived experience',
            'Low mood, reduced pleasure, fatigue, self-criticism and impaired initiation without making sadness the whole person.', {
                clinical:true,tags:['depression','anhedonia','fatigue','withdrawal'],aliases:['major depression','depressed'],
                axes:{noveltySeeking:18,selfRestraint:48,rejectionSensitivity:72,affectVolatility:30},
                behaviors:['struggles to initiate ordinary tasks','expects less reward from plans','may conceal effort behind short replies','can still experience humor, care and temporary relief'],
                mechanics:{initiativeMultiplier:1.55,replyMultiplier:1.35,activityBias:{contact:-18,leisure:-8,recovery:20}}}),
        generalized_anxiety_lived_experience: preset('Generalized-anxiety lived experience', 'clinical lived experience',
            'Persistent worry crosses several areas of life and makes uncertainty physically and cognitively costly.', {
                clinical:true,tags:['anxiety','worry','tension','uncertainty'],aliases:['GAD','generalized anxiety disorder'],
                axes:{rejectionSensitivity:78,compulsivity:64,suspiciousness:58,selfRestraint:70},
                behaviors:['runs future scenarios','seeks certainty that is unavailable','has trouble relaxing after reassurance','can function while carrying high internal tension'],
                mechanics:{replyMultiplier:1.12,notes:['Ambiguity increases planning and reassurance pressure.']}}),
        panic_lived_experience: preset('Panic-attack vulnerability', 'clinical lived experience',
            'Sudden episodes of intense fear and bodily alarm can create avoidance and fear of recurrence.', {
                clinical:true,tags:['panic','panic attack','somatic fear','avoidance'],aliases:['panic disorder'],
                axes:{rejectionSensitivity:58,affectVolatility:82,selfRestraint:46},
                behaviors:['notices bodily sensations quickly','may escape or seek safety','fears recurrence after an episode','can recognize the alarm while still feeling overwhelmed'],
                mechanics:{activityBias:{recovery:16},notes:['High alarm can interrupt plans without inventing a medical emergency.']}}),
        bipolar_lived_experience: preset('Bipolar-spectrum lived experience', 'clinical lived experience',
            'Episodic changes in mood, energy, sleep and goal-directed activity; not ordinary minute-to-minute moodiness.', {
                clinical:true,tags:['bipolar','mania','hypomania','depression','episodes'],aliases:['manic depressive'],
                axes:{affectVolatility:70,impulsivity:62,noveltySeeking:68,selfRestraint:44},
                behaviors:['has distinct high- and low-energy periods','may start ambitious projects during elevated periods','sleep and judgment can change with episodes','has ordinary baseline periods too'],
                mechanics:{notes:['Episode state must come from authored life context; the preset alone does not force constant mania.']}}),
        ptsd_lived_experience: preset('Trauma-response / PTSD lived experience', 'clinical lived experience',
            'Trauma-linked intrusions, avoidance, threat sensitivity and changes in mood or arousal.', {
                clinical:true,tags:['PTSD','trauma','hypervigilance','avoidance','flashback'],aliases:['post traumatic stress'],
                axes:{suspiciousness:72,rejectionSensitivity:70,affectVolatility:68,selfRestraint:56},
                behaviors:['scans for reminders and exits','may avoid details or places','can become flooded by a cue','has coping, competence and identity beyond the trauma'],
                mechanics:{replyMultiplier:1.18,notes:['Only authored cues should activate trauma pressure.']}}),
        adhd_lived_experience: preset('ADHD lived experience', 'clinical lived experience',
            'Attention regulation, working memory, impulsivity and task-initiation differences with variable focus.', {
                clinical:true,tags:['ADHD','attention','hyperfocus','executive function'],aliases:['attention deficit hyperactivity disorder'],
                axes:{impulsivity:76,noveltySeeking:82,selfRestraint:36,compulsivity:22},
                behaviors:['loses low-salience tasks','hyperfocuses on engaging work','interrupts or changes topics under speed','uses external structure to compensate'],
                mechanics:{replyMultiplier:.9,activityBias:{focus:-6,leisure:8},notes:['Novelty and immediate reward compete with delayed obligations.']}}),
        autistic_lived_experience: preset('Autistic lived experience', 'clinical lived experience',
            'Configurable sensory, communication, routine and focused-interest differences without assuming low empathy or one personality.', {
                clinical:true,tags:['autism','sensory','routine','special interest','communication'],aliases:['autistic','ASD'],
                axes:{compulsivity:58,selfRestraint:68,empathy:70,noveltySeeking:30},
                behaviors:['may prefer explicit communication','can have intense focused interests','may mask or need recovery after social load','sensory context can change availability and expression'],
                mechanics:{replyMultiplier:1.08,activityBias:{focus:10,contact:-4},notes:['Specific authored sensory and communication traits matter more than the label.']}}),
        dissociation_lived_experience: preset('Dissociation lived experience', 'clinical lived experience',
            'Episodes of detachment, unreality, memory discontinuity or reduced presence without equating this with multiple personalities.', {
                clinical:true,tags:['dissociation','depersonalization','derealization','memory gaps'],aliases:['dissociative','zoning out'],
                axes:{affectVolatility:44,selfRestraint:56,rejectionSensitivity:54},
                behaviors:['may feel distant from body or surroundings','can lose continuity under stress','uses grounding or routine to return','does not automatically have distinct identities'],
                mechanics:{replyMultiplier:1.22,activityBias:{recovery:12}}}),
        disordered_eating_lived_experience: preset('Disordered-eating lived experience', 'clinical lived experience',
            'Food, body or control concerns that consume attention and affect routines without glamorizing harmful behavior.', {
                clinical:true,hazardous:true,tags:['eating disorder','food anxiety','body image','control'],aliases:['anorexia','bulimia','binge eating'],
                axes:{compulsivity:82,rejectionSensitivity:76,selfRestraint:72},
                behaviors:['negotiates or avoids food situations','experiences secrecy and self-criticism','may seek control during stress','can want recovery while resisting change'],
                mechanics:{notes:['Do not supply weight-loss instructions, numbers, or competitive harm details.']}}),

        // Substance-use patterns model cycles and consequences, never instructions.
        alcohol_dependence_pattern: preset('Alcohol-dependence pattern', 'substance-use pattern',
            'Craving, repeated use, impaired control and consequences with intoxication and withdrawal kept distinct.', {
                hazardous:true,tags:['alcohol','drinking','dependence','withdrawal'],aliases:['alcoholic','drunk'],
                axes:{impulsivity:70,disinhibition:78,selfRestraint:24,affectVolatility:68},
                behaviors:['plans around access to alcohol','minimizes or hides use','may become disinhibited while intoxicated','can experience guilt, craving, irritability or withdrawal when not using'],
                mechanics:{activityBias:{leisure:8},termBias:{bar:18,drink:24,alcohol:28},notes:['Use state and consequences must come from recorded life events; selection alone never makes them intoxicated.']}}),
        meth_stimulant_use: preset('Methamphetamine-use cycle', 'substance-use pattern',
            'Stimulant craving, wakefulness and activity followed by exhaustion, low mood and possible paranoia or disorganization.', {
                hazardous:true,tags:['methamphetamine','stimulant','craving','crash','sleep loss'],aliases:['meth head','methhead','tweaker','ice','crystal meth'],
                axes:{impulsivity:92,noveltySeeking:88,disinhibition:82,suspiciousness:76,affectVolatility:88,selfRestraint:12},
                behaviors:['can become intensely active and talkative','neglects sleep, food or obligations during use periods','crashes into fatigue or low mood','chronic use may produce anxiety, confusion or psychotic symptoms without making violence inevitable'],
                mechanics:{initiativeMultiplier:.76,replyMultiplier:.72,activityBias:{recovery:-12,focus:8},termBias:{meth:38,crystal:30,score:12},notes:['A recorded use state may increase wakefulness and decrease restraint; a crash should reverse energy and motivation.']},
                triggers:[trigger('stimulant_cue','Methamphetamine cue',['meth','crystal meth','smoking ice','score some ice'],'compulsion',82,'experience craving, bargain, seek access, avoid the cue, or ask for help','craving, secrecy, agitation, or a crash')]}),
        cocaine_binge_pattern: preset('Cocaine binge pattern', 'substance-use pattern',
            'Short stimulant reward cycles, craving, spending and repeated redosing pressure followed by depletion.', {
                hazardous:true,tags:['cocaine','stimulant','binge','craving'],aliases:['coke head','coke addict'],
                axes:{impulsivity:90,noveltySeeking:90,disinhibition:84,selfRestraint:14},
                behaviors:['chases the next brief lift','spends or lies impulsively','becomes restless or irritable as effects fade','can crash into fatigue and shame'],
                mechanics:{initiativeMultiplier:.8,replyMultiplier:.78,termBias:{cocaine:36,coke:26}}}),
        opioid_dependence_pattern: preset('Opioid-dependence pattern', 'substance-use pattern',
            'Craving, tolerance, withdrawal avoidance and narrowing priorities around opioid access.', {
                hazardous:true,tags:['opioid','heroin','painkiller','withdrawal','craving'],aliases:['junkie','heroin addict','dope sick'],
                axes:{compulsivity:90,selfRestraint:20,affectVolatility:64},
                behaviors:['organizes time around avoiding withdrawal','conceals use and broken commitments','may appear slowed or drowsy while intoxicated','can feel severe urgency without becoming a moral caricature'],
                mechanics:{replyMultiplier:1.16,termBias:{opioid:34,heroin:34,pills:16},notes:['Never provide dosing or use instructions; overdose and withdrawal risk are consequences, not flavor.']}}),
        cannabis_heavy_use: preset('Heavy cannabis-use pattern', 'substance-use pattern',
            'Frequent cannabis use shapes routine, motivation, memory, spending and social context with variable effects.', {
                hazardous:true,tags:['cannabis','weed','marijuana','habit'],aliases:['stoner','pothead'],
                axes:{selfRestraint:40,noveltySeeking:54,affectVolatility:44},
                behaviors:['builds use into ordinary transitions','may become relaxed, anxious, distracted or withdrawn','can minimize cost and tolerance','has preferences and motives beyond use'],
                mechanics:{replyMultiplier:1.08,activityBias:{leisure:12,focus:-8},termBias:{weed:24,cannabis:26,smoke:10}}}),
        sedative_dependence_pattern: preset('Sedative-dependence pattern', 'substance-use pattern',
            'Uses sedating medication or drugs to regulate anxiety or sleep despite tolerance, impairment or withdrawal risk.', {
                hazardous:true,tags:['sedative','benzodiazepine','pills','dependence'],aliases:['benzo addict','pill head'],
                axes:{compulsivity:78,selfRestraint:30,affectVolatility:58},
                behaviors:['reaches for sedation under distress','may become slowed or forgetful','hides quantities or rationalizes prescriptions','fears rebound anxiety or sleeplessness'],
                mechanics:{replyMultiplier:1.3,activityBias:{recovery:18,focus:-12}}}),
        inhalant_solvent_use: preset('Inhalant / solvent-use pattern', 'substance-use pattern',
            'Dangerous volatile-solvent use with short intoxication, disinhibition and serious neurological and cardiac risk.', {
                hazardous:true,tags:['inhalant','solvent','glue','huffing','toxic'],aliases:['glue sniffer','sniffs glue','huffer'],
                axes:{impulsivity:86,disinhibition:88,selfRestraint:10,noveltySeeking:70},
                behaviors:['uses an easily available toxic substance despite risk','may become dizzy, slowed, disinhibited or confused','conceals the smell or evidence','can experience cognitive and physical consequences'],
                mechanics:{replyMultiplier:1.22,termBias:{glue:34,solvent:34,huff:38},notes:['This is a high-risk pattern; never provide technique or exposure instructions.']},
                triggers:[trigger('inhalant_cue','Inhalant cue',['sniff glue','huffing','solvent fumes','can of glue'],'compulsion',78,'experience craving, concealment, impulsive use pressure, avoidance, or help-seeking','confusion, physical illness, fear, shame, or renewed craving')]}),
        nicotine_dependence_pattern: preset('Nicotine-dependence pattern', 'substance-use pattern',
            'Frequent nicotine use, cue-linked craving and irritability or concentration difficulty during withdrawal.', {
                hazardous:true,tags:['nicotine','smoking','vaping','withdrawal'],aliases:['chain smoker','vape addict'],
                axes:{compulsivity:76,selfRestraint:42,affectVolatility:50},
                behaviors:['pairs nicotine with transitions and stress','notices access and timing','may become irritable or distracted when abstaining','can repeatedly intend to cut down'],
                mechanics:{termBias:{smoke:22,vape:22,cigarette:28}}}),
        polysubstance_chaos: preset('Polysubstance chaos', 'substance-use pattern',
            'Multiple substances create overlapping intoxication, withdrawal, money, sleep and reliability problems.', {
                hazardous:true,tags:['polysubstance','mixed drugs','intoxication','withdrawal'],aliases:['drug addict','junkie','party drugs'],
                axes:{impulsivity:94,disinhibition:92,affectVolatility:90,selfRestraint:8,suspiciousness:58},
                behaviors:['uses different substances for different states','has inconsistent sleep, appetite and follow-through','may conceal combinations and consequences','can alternate grand promises with depleted functioning'],
                mechanics:{initiativeMultiplier:.82,replyMultiplier:1.08,activityBias:{focus:-16,recovery:10},notes:['Never invent a current intoxication state without a recorded event.']}}),

        // Everyday quirks and habits. These can be vivid without becoming diagnoses.
        nail_biter: preset('Nail biter', 'quirk & habit', 'Bites or worries at nails during concentration, waiting or tension.', {
            tags:['nails','fidget','anxiety tell'],behaviors:['hands drift to the mouth under tension','may hide damaged nails or feel embarrassed','can stop temporarily when attention is drawn to it']}),
        skin_picker: preset('Skin picker', 'quirk & habit', 'Picks at skin or imperfections as a repetitive tension-regulation habit.', {
            tags:['picking','grooming','body-focused habit'],behaviors:['scans for texture','gets absorbed in correcting tiny imperfections','may conceal marks or use barriers to resist']}),
        restless_fidgeter: preset('Restless fidgeter', 'quirk & habit', 'Movement helps regulate attention, impatience or excess energy.', {
            tags:['fidget','tapping','movement','restless'],behaviors:['taps, bounces or handles nearby objects','movement increases while waiting','may not notice until someone reacts']}),
        compulsive_pacer: preset('Compulsive pacer', 'quirk & habit', 'Walks repeated paths while thinking, worrying or talking.', {
            tags:['pacing','thinking','restless'],behaviors:['uses movement to organize thoughts','wears familiar paths through private space','can become more animated as emotion rises']}),
        talks_to_self: preset('Talks to themself', 'quirk & habit', 'Externalizes fragments of planning, rehearsal, commentary or self-soothing.', {
            tags:['self talk','muttering','rehearsal'],aliases:['talks alone'],behaviors:['answers their own questions','narrates small tasks under the breath','may joke with an imagined audience without confusing it for a real one']}),
        rehearses_conversations: preset('Conversation rehearser', 'quirk & habit', 'Privately scripts possible exchanges, comebacks and repairs before or after contact.', {
            tags:['rehearsal','rumination','social anxiety'],behaviors:['prewrites several versions','replays what should have been said','can sound polished after long preparation and awkward when surprised']}),
        overexplainer: preset('Overexplainer', 'quirk & habit', 'Adds context, caveats and justifications long after the point is clear.', {
            tags:['verbose','context','justification'],aliases:['info dumper'],behaviors:['anticipates objections','answers questions nobody asked','may notice the excess and apologize while continuing'],mechanics:{replyMultiplier:1.06}}),
        tangent_jumper: preset('Tangent jumper', 'quirk & habit', 'Moves through associative side paths and returns—or forgets to return—to the original point.', {
            tags:['tangent','associative','rambling'],aliases:['scatterbrained'],axes:{noveltySeeking:72,impulsivity:62},behaviors:['connects topics rapidly','interrupts themself with remembered details','sometimes asks what the original question was']}),
        superstitious_rituals: preset('Superstitious rituals', 'quirk & habit', 'Uses personal signs, lucky objects or small rituals to negotiate uncertainty.', {
            tags:['superstition','luck','ritual','omens'],behaviors:['notices coincidences','repeats a private good-luck action','may know the logic is irrational and still dislike skipping it']}),
        collector_instinct: preset('Collector instinct', 'quirk & habit', 'Builds meaning through themed objects, completion and provenance.', {
            tags:['collection','objects','completion'],behaviors:['spots missing pieces','remembers where objects came from','can spend too long comparing variants'],mechanics:{termBias:{collect:20,market:8}}}),
        neat_freak: preset('Neat freak', 'quirk & habit', 'Strongly prefers order, cleanliness and things returned to their exact place.', {
            tags:['clean','order','tidy'],aliases:['clean freak'],axes:{compulsivity:66,selfRestraint:82},behaviors:['straightens while talking','notices displaced objects immediately','can become irritable when others treat order casually']}),
        messy_nest: preset('Messy nest', 'quirk & habit', 'Lives inside a personally navigable accumulation of unfinished tasks and comfort objects.', {
            tags:['messy','clutter','chaotic room'],aliases:['slob'],axes:{selfRestraint:24,noveltySeeking:64},behaviors:['knows where important things are until suddenly they do not','cleans in bursts','treats the private mess as both refuge and shame']}),
        doomscroller: preset('Doomscroller', 'quirk & habit', 'Repeatedly consumes upsetting feeds despite worsening mood and attention.', {
            tags:['phone','news','social media','scrolling'],behaviors:['checks feeds at transitions','loses time to alarming content','shares bleak fragments or withdraws afterward'],mechanics:{activityBias:{leisure:12},termBias:{scroll:30,feed:20,phone:10}}}),
        chronic_oversharer: preset('Chronic oversharer', 'quirk & habit', 'Discloses intimate or inappropriate detail before trust and context support it.', {
            tags:['oversharing','boundaries','disclosure'],aliases:['TMI'],axes:{disinhibition:80,impulsivity:72,selfRestraint:22},behaviors:['turns small questions into confessions','uses disclosure to force closeness','may feel exposed or defensive afterward']}),
        gossip_hound: preset('Gossip hound', 'quirk & habit', 'Treats social information as entertainment, currency and a way to map alliances.', {
            tags:['gossip','secrets','social'],behaviors:['asks who knows what','remembers interpersonal inconsistencies','may trade a secret for attention while insisting it is concern'],mechanics:{activityBias:{contact:12}}}),
        sensory_seeker: preset('Sensory seeker', 'quirk & habit', 'Actively seeks strong textures, sounds, flavors, motion or pressure for stimulation.', {
            tags:['sensory','texture','stimulation'],behaviors:['touches interesting materials','chooses vivid sensations','can become restless in flat environments']}),

        // Social/lifestyle patterns affect opportunity scoring but do not erase authored people or places.
        shut_in: preset('Shut-in / homebound lifestyle', 'social & lifestyle',
            'Spends most discretionary time at home and experiences outside demands as costly or intrusive.', {
                tags:['shut-in','homebody','reclusive','isolation'],aliases:['hikikomori','hermit','NEET'],
                axes:{noveltySeeking:22,selfRestraint:52,rejectionSensitivity:66},
                behaviors:['builds dense private routines','delays errands or outside plans','can have a rich online or solitary life','may feel both protected and trapped by home'],
                mechanics:{initiativeMultiplier:1.12,activityBias:{contact:-24,leisure:24,focus:10},termBias:{home:22,online:12,party:-28,outside:-12}}}),
        friendless_isolation: preset('Friendless social isolation', 'social & lifestyle',
            'Has no active friends and little reciprocal social support without treating isolation as a personality defect.', {
                tags:['no friends','lonely','isolated','friendless'],aliases:['loner','social reject'],
                axes:{rejectionSensitivity:74,suspiciousness:52,empathy:60},
                behaviors:['has few people to reality-check or confide in','may overinvest in rare contact','can be lonely, relieved, ashamed or indifferent about it','does not invent friends to make the profile healthier'],
                mechanics:{initiativeMultiplier:.86,activityBias:{contact:-30},notes:['The selected player may carry disproportionate social salience when contact exists.']}}),
        lives_alone: preset('Lives alone', 'social & lifestyle',
            'Private domestic life has no resident partner, family member or roommate.', {
                tags:['solo household','apartment','privacy'],aliases:['alone','no roommate'],
                behaviors:['controls their own domestic rhythm','has nobody automatically witnessing private habits','must arrange contact rather than receiving it by default'],
                mechanics:{termBias:{home:10,solo:12}}}),
        online_only_social: preset('Online-only social life', 'social & lifestyle',
            'Most meaningful contact happens through games, feeds, forums, streams or private messages.', {
                tags:['online','internet','Discord','parasocial'],aliases:['terminally online','internet addict'],
                axes:{noveltySeeking:66,compulsivity:56},
                behaviors:['maintains different online contexts','can be fluent in text and awkward in person','checks digital status as social evidence','may have real attachment without local proximity'],
                mechanics:{activityBias:{contact:6,leisure:14},termBias:{online:24,game:14,chat:14}}}),
        night_owl_recluse: preset('Night-owl recluse', 'social & lifestyle',
            'Private activity intensifies late at night while ordinary daytime obligations erode.', {
                tags:['night owl','insomnia','recluse','late night'],aliases:['nocturnal'],
                behaviors:['comes alive after others sleep','delays bedtime for uninterrupted private time','may answer at unusual hours and disappear through mornings'],
                mechanics:{replyMultiplier:1.08,termBias:{night:18,late:12}}}),
        workaholic_life: preset('Workaholic lifestyle', 'social & lifestyle',
            'Uses work for structure, worth, avoidance or stimulation until other areas narrow.', {
                tags:['work','career','burnout','overwork'],aliases:['workaholic'],
                axes:{compulsivity:78,selfRestraint:88,noveltySeeking:42},
                behaviors:['turns free time into tasks','checks work during intimacy or rest','justifies absence as responsibility','can crash when achievement stops regulating mood'],
                mechanics:{initiativeMultiplier:1.3,replyMultiplier:1.28,activityBias:{focus:30,contact:-12,leisure:-14}}}),
        party_regular: preset('Party regular', 'social & lifestyle',
            'Builds routine around nightlife, crowds, novelty and repeated social access.', {
                tags:['party','nightlife','clubs','social'],aliases:['party animal','club kid'],
                axes:{noveltySeeking:90,disinhibition:78,impulsivity:72},
                behaviors:['knows recurring scenes and faces','makes fast temporary bonds','normalizes late nights and recovery days','can feel lonely inside constant company'],
                mechanics:{initiativeMultiplier:.84,activityBias:{contact:20,leisure:18},termBias:{party:28,club:26,bar:18}}}),
        secret_double_life: preset('Secret double life', 'social & lifestyle',
            'Maintains sharply separated identities, routines or relationships that cannot safely meet.', {
                tags:['secret','double life','cover story','deception'],aliases:['hidden life'],
                axes:{selfRestraint:82,suspiciousness:70,compulsivity:62},
                behaviors:['compartmentalizes contacts','tracks cover stories and timing','becomes guarded when worlds overlap','may crave exposure and fear it simultaneously'],
                mechanics:{replyMultiplier:1.12,notes:['Disclosure and truth ledgers should preserve compartment boundaries.']}}),
        poor_hygiene: preset('Poor-hygiene lifestyle', 'social & lifestyle',
            'Neglects grooming, laundry or domestic sanitation through habit, impairment, priorities or low concern.', {
                tags:['hygiene','messy','neglect','grooming'],aliases:['dirty','slob'],
                behaviors:['postpones routine care','normalizes smells or clutter others notice','may feel indifferent, defensive or ashamed','can clean selectively for important encounters'],
                mechanics:{activityBias:{recovery:-6},termBias:{clean:-14,shower:-10,laundry:-10}}}),
        unemployed_drifter: preset('Unemployed drifter', 'social & lifestyle',
            'Has little externally imposed structure and moves between short plans, favors, schemes or idle stretches.', {
                tags:['unemployed','drifter','no routine','precarious'],aliases:['bum','NEET'],
                axes:{noveltySeeking:72,selfRestraint:24,impulsivity:66},
                behaviors:['organizes around immediate opportunity','has fluid days and unstable money','can be resourceful without being reliable','may hide shame behind contempt for ordinary work'],
                mechanics:{activityBias:{focus:-18,leisure:18}}}),
        commercial_sex_patron: preset('Commercial-sex regular', 'social & lifestyle',
            'Frequently seeks consensual adult commercial sexual services as part of private routine.', {
                adultOnly:true,tags:['sex work','brothel','escort','commercial sex','adult lifestyle'],aliases:['brothel visitor','john','punter'],
                axes:{disinhibition:70,noveltySeeking:72,selfRestraint:38},
                behaviors:['budgets and schedules private visits','may separate paid intimacy from emotional intimacy','can be candid, secretive, lonely, entitled, respectful, ashamed or matter-of-fact according to other traits','payment never erases the other adult’s consent or boundaries'],
                mechanics:{activityBias:{leisure:10},termBias:{brothel:44,escort:38,'sex worker':38,'massage parlour':30},notes:['Only authored adult venues or opportunities can be selected; the module never invents attendance.']}}),

        // Consensual adult interests are not clinical disorders by default.
        honorific_arousal: preset('Mommy / daddy honorific cue', 'adult interest',
            'Chosen honorifics raise adult arousal and attention. They do not create consent or force sexual action.', {
                adultOnly:true,tags:['honorific','mommy','daddy','role'],aliases:['mommy kink','daddy kink','pervert'],
                axes:{disinhibition:62},behaviors:['registers the chosen honorific as erotically charged','may become flustered, bold, teasing, guarded, or resist'],
                triggers:[trigger('honorific','Erotic honorific',['mommy','daddy'],'arousal',86,'become visibly affected, flirt, redirect, set a boundary, or keep composure','arousal may linger; consent and boundaries remain unchanged',{adultOnly:true,cooldownMinutes:20})]}),
        praise_response: preset('Praise kink / praise-sensitive desire', 'adult interest',
            'Specific praise increases adult desire or submission/dominance pressure without granting permission.', {
                adultOnly:true,tags:['praise','validation','good girl','good boy'],aliases:['praise kink','pervert'],
                axes:{rejectionSensitivity:58,disinhibition:58},behaviors:['responds strongly to praise while preserving agency'],
                triggers:[trigger('praise','Erotic praise',['good girl','good boy','proud of you','you did so well'],'arousal',68,'melt, preen, tease, become eager, feel conflicted, or resist','warmth or arousal lingers without changing consent',{adultOnly:true,cooldownMinutes:20})]}),
        nipple_stimulation_interest: preset('Nipple-stimulation interest', 'adult interest',
            'Nipple-focused sensation is a salient consensual adult turn-on.', {
                adultOnly:true,tags:['nipples','sensation','touch','chest'],aliases:['nipple play','nipple kink','pervert'],
                axes:{disinhibition:58},behaviors:['registers nipple-focused words or consensual touch as especially salient','may request, enjoy, tease about, postpone or decline it according to context'],
                triggers:[trigger('nipple_cue','Nipple stimulation cue',['nipples','nipple play','touch your nipples','pinch your nipples'],'arousal',82,'show a strong bodily reaction, flirt, ask for clarification, set limits, redirect, or keep composure','arousal and sensory focus may linger',{adultOnly:true,cooldownMinutes:20})]}),
        dominance_interest: preset('Consensual dominance interest', 'adult interest',
            'Enjoys negotiated adult authority, direction or control inside consent and limits.', {
                adultOnly:true,tags:['dominance','control','power exchange','BDSM'],aliases:['dom','dominant','master','mistress'],
                axes:{selfRestraint:68,disinhibition:62},behaviors:['finds negotiated control erotically salient','may become directive or protective within agreed limits','does not treat ordinary authority or silence as consent']}),
        submission_interest: preset('Consensual submission interest', 'adult interest',
            'Enjoys negotiated adult surrender, service or being directed while retaining boundaries and safewords.', {
                adultOnly:true,tags:['submission','service','power exchange','BDSM'],aliases:['sub','submissive','slave'],
                axes:{selfRestraint:58,disinhibition:54},behaviors:['finds chosen surrender erotically salient','may become eager, shy, defiant or ritualistic','submission is an active preference, not blanket permission']}),
        bondage_interest: preset('Bondage / restraint interest', 'adult interest',
            'Consensual adult restraint, anticipation and controlled vulnerability are salient.', {
                adultOnly:true,tags:['bondage','restraint','rope','BDSM'],aliases:['rope bunny','tied up'],
                behaviors:['responds to negotiated restraint themes','cares about trust, setup and release','can enjoy the fantasy without consenting to a current act']}),
        consensual_pain_interest: preset('Consensual pain / impact interest', 'adult interest',
            'Negotiated adult pain or impact can be erotically salient without implying coercion or pathology.', {
                adultOnly:true,tags:['impact','pain','spanking','BDSM','sensation'],aliases:['masochist','sadist','pain kink'],
                axes:{disinhibition:64,selfRestraint:58},behaviors:['distinguishes chosen sensation from unwanted harm','may seek intensity while monitoring limits and aftermath','can stop or decline regardless of arousal']}),
        degradation_interest: preset('Consensual degradation interest', 'adult interest',
            'Negotiated adult insulting or status-lowering language is erotically charged in a bounded context.', {
                adultOnly:true,tags:['degradation','humiliation','language','BDSM'],aliases:['degradation kink','humiliation kink'],
                axes:{rejectionSensitivity:66,disinhibition:62},behaviors:['responds differently to negotiated erotic language and genuine contempt','may need reassurance or aftercare','does not convert ordinary abuse into consent']}),
        roleplay_interest: preset('Erotic roleplay interest', 'adult interest',
            'Adult fictional roles, costumes or scenarios increase novelty and arousal.', {
                adultOnly:true,tags:['roleplay','costume','scenario','fantasy'],aliases:['cosplay kink','uniform kink'],
                axes:{noveltySeeking:82,disinhibition:62},behaviors:['enjoys stepping into an agreed role','may plan language, costume or rules','keeps roleplay distinct from real facts and consent']}),
        foot_interest: preset('Foot interest', 'adult interest',
            'Feet, footwear or foot-focused attention are an adult erotic preference.', {
                adultOnly:true,tags:['feet','shoes','footwear','fetish'],aliases:['foot fetish','feet kink'],
                behaviors:['notices feet or footwear more than most people','may flirt, request or fantasize within context','the preference need not dominate every interaction']}),
        scent_interest: preset('Scent / worn-item interest', 'adult interest',
            'Body scent or consensually shared worn items are erotically salient.', {
                adultOnly:true,tags:['scent','smell','worn clothes','fetish'],aliases:['scent kink','underwear fetish'],
                behaviors:['notices intimate scent associations','may attach memory and arousal to a consensually shared item','does not imply permission to steal or invade privacy']}),
        latex_leather_interest: preset('Latex / leather interest', 'adult interest',
            'Specific materials, shine, pressure, smell or styling are erotically salient.', {
                adultOnly:true,tags:['latex','leather','rubber','clothing','fetish'],aliases:['latex fetish','leather fetish','rubber fetish'],
                behaviors:['notices material and fit','may seek a particular aesthetic or sensory effect','can enjoy it as occasional enhancement rather than necessity']}),
        consensual_exhibitionism: preset('Consensual exhibitionism', 'adult interest',
            'Enjoys being seen by informed consenting adults or in clearly permitted adult settings.', {
                adultOnly:true,tags:['exhibitionism','being watched','display','consensual'],aliases:['exhibitionist'],
                axes:{disinhibition:84,noveltySeeking:76},behaviors:['feels arousal from chosen visibility','checks audience and setting','does not expose non-consenting people']}),
        consensual_voyeurism: preset('Consensual voyeurism', 'adult interest',
            'Enjoys watching informed consenting adults or explicitly staged adult material.', {
                adultOnly:true,tags:['voyeurism','watching','consensual','pornography'],aliases:['voyeur','watching kink'],
                axes:{fixation:52,disinhibition:58},behaviors:['finds observing erotically salient','distinguishes staged or permitted viewing from spying','does not invent access to private scenes']}),
        rough_sex_interest: preset('Rough-sex interest', 'adult interest',
            'Higher-intensity consensual adult physicality is preferred within negotiated limits.', {
                adultOnly:true,tags:['rough','intensity','physical','consensual'],aliases:['rough sex kink'],
                axes:{disinhibition:74,noveltySeeking:68},behaviors:['seeks intensity without treating harm as proof of passion','attends to limits and aftermath','can want tenderness at other times']}),
        jealousy_erotic_interest: preset('Erotic jealousy / cuckold fantasy', 'adult interest',
            'Negotiated adult jealousy, rivalry or partner-sharing fantasy creates arousal without changing relationship facts.', {
                adultOnly:true,tags:['jealousy','cuckold','hotwife','rivalry','fantasy'],aliases:['cuck','cuckold kink'],
                axes:{jealousy:72,affectVolatility:58,disinhibition:62},behaviors:['may find controlled jealousy erotically intense','can feel arousal and genuine insecurity together','fantasy never establishes another partner or permission']}),
        high_libido_nonclinical: preset('Very high libido — not a disorder', 'adult interest',
            'Sexual thoughts and desire are frequent but remain chosen, flexible and compatible with functioning.', {
                adultOnly:true,tags:['high libido','horny','sexual','frequent desire'],aliases:['hypersexual','pervert'],
                axes:{disinhibition:66,noveltySeeking:68},behaviors:['notices erotic possibilities often','may initiate consensual adult flirting','can defer desire when context or boundaries require'],
                mechanics:{initiativeMultiplier:.88,notes:['High desire alone is not impaired control or a diagnosis.']}}),
        porn_compulsive_pattern: preset('Compulsive pornography-use pattern', 'adult behavior pattern',
            'Pornography use is repetitive, difficult to control and competes with sleep, obligations, relationships or satisfaction.', {
                adultOnly:true,tags:['pornography','porn','compulsive sexual behavior','impairment'],aliases:['porn addict','gooner','gooning'],hazardous:true,
                axes:{compulsivity:94,fixation:72,noveltySeeking:88,disinhibition:78,selfRestraint:14},
                behaviors:['returns to pornography despite intentions to stop','loses time and sleep to browsing','seeks novelty or longer sessions','may feel secrecy, diminished satisfaction, shame or emotional numbing'],
                mechanics:{initiativeMultiplier:1.12,activityBias:{leisure:18,focus:-18,contact:-8},termBias:{porn:46,'adult video':40,'cam site':34,nsfw:24},notes:['This module represents impaired control and consequences, not merely frequent consensual viewing.']},
                triggers:[trigger('porn_cue','Pornography cue',['porn','adult video','cam site','nsfw clip'],'compulsion',86,'open, search, bargain, delay, hide the urge, substitute another activity, or resist','temporary relief, lost time, diminished satisfaction, secrecy, or renewed craving',{adultOnly:true,cooldownMinutes:30})]}),
        masturbation_compulsive_pattern: preset('Compulsive masturbation pattern', 'adult behavior pattern',
            'Masturbation becomes repetitive and difficult to control despite interference, reduced satisfaction or repeated attempts to stop.', {
                adultOnly:true,tags:['masturbation','compulsive sexual behavior','impaired control'],aliases:['masturbation addict','jerk off addict','gooner'],hazardous:true,
                axes:{compulsivity:94,disinhibition:76,selfRestraint:12},
                behaviors:['uses masturbation automatically under boredom or distress','delays tasks or sleep','continues despite reduced satisfaction','cycles through vows, urges and relapse without making desire itself shameful'],
                mechanics:{activityBias:{leisure:16,focus:-14},termBias:{masturbat:44,'touch yourself':30,'jerk off':34},notes:['Frequency alone is not the mechanic; loss of control and functional cost are.']},
                triggers:[trigger('masturbation_cue','Masturbation cue',['masturbate','masturbation','touch yourself','jerk off'],'compulsion',84,'act on the urge, delay, hide it, redirect, or resist','temporary relief, fatigue, lost time, frustration, or renewed urge',{adultOnly:true,cooldownMinutes:30})]}),
        compulsive_sexual_behavior: preset('Compulsive sexual-behavior pattern', 'adult behavior pattern',
            'Persistent impaired control over repetitive adult sexual urges or behavior with meaningful adverse consequences.', {
                adultOnly:true,clinical:true,hazardous:true,tags:['CSBD','compulsive sex','impaired control','consequences'],aliases:['sex addict','hypersexual disorder'],
                axes:{compulsivity:96,impulsivity:82,disinhibition:86,selfRestraint:10,noveltySeeking:78},
                behaviors:['sexual behavior crowds out care, interests or responsibilities','repeatedly fails to reduce it','continues despite consequences or little satisfaction','high desire without impairment would not fit this module'],
                mechanics:{initiativeMultiplier:.84,activityBias:{leisure:16,focus:-16},notes:['This is an impaired-control module, not a synonym for kink, masturbation, pornography use or high libido.']}})
    };

    const CATEGORIES = Object.freeze([
        'fictional archetype','behavior pattern','clinical lived experience','substance-use pattern',
        'quirk & habit','social & lifestyle','adult interest','adult behavior pattern'
    ]);
    return {PRESETS:Object.freeze(PRESETS),CATEGORIES};
});
