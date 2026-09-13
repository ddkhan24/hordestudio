"""Deterministic expression brief and transcript diagnostics; never a world writer.

Lexical cues suggest conversational options, not emotional truth. The language
model resolves ambiguity. No extra provider calls, automatic rewrites or clipping.
"""
import json
import re
import math
import unicodedata
from collections import Counter

VERSION = 3
MOVES = ('answer','acknowledge','clarify','share_relevant_experience','express_a_need','disagree_or_decline','close')
STOP = set('the and that this with from your have what how are you for was were just really about there been like can could would should'.split())

def words(text):
    return re.findall(r"[^\W_]+(?:['’][^\W_]+)?", str(text).lower(), re.UNICODE)

def folded(text):
    return ''.join(c for c in unicodedata.normalize('NFKD',str(text).casefold()) if not unicodedata.combining(c))

def terms(text):
    return set(w for w in words(folded(text)) if len(w)>1 and w not in STOP)

def recall_conversation(messages, query, budget=12000):
    """Retrieve exact old turns and adjacent context; never summarize into facts.

    Caller supplies only perceived/delivered messages for this persona. Preserve
    a following correction or qualification together with the matching turn.
    """
    eligible=[m for m in messages if m.get('text') and m.get('type','text')=='text']
    if not query or len(eligible)<=40:return []
    matches=[terms(m['text'])&query for m in eligible]
    frequency=Counter(t for match in matches for t in match)
    score=lambda i:sum(math.log1p(len(eligible)/(1+frequency[t])) for t in sorted(matches[i]))
    ranked=sorted((i for i in range(len(eligible)-40) if matches[i]),key=lambda i:(-score(i),-i))
    chosen=set();used=0
    for i in ranked:
        group=[j for j in range(max(0,i-1),min(len(eligible),i+3)) if j not in chosen]
        size=sum(len(eligible[j]['text']) for j in group)
        if used+size>budget or len(chosen)+len(group)>12:continue
        chosen.update(group);used+=size
    return [{'id':eligible[i]['id'],'role':eligible[i]['role'],'text':eligible[i]['text'],
             'timestamp':eligible[i].get('timestamp'),'truthScope':'quoted_conversation'} for i in sorted(chosen)]

def archived_conversation(service, world_id, state, query, budget=8000):
    """Recall old exact turns from the existing transcript, including corrections.

    The active inbox is deliberately bounded. Its transcript is the same event
    projection, not a separate autobiographical store. Never retrieve another
    contact, an unread message, or a cleared chat's deleted transcript.
    """
    if not query:return []
    inbox=state.get('communication',{});active=inbox.get('messages',[])
    if not active:return []
    persona=inbox.get('personaId');primary=state.get('_conversationBinding',{}).get('primary',{}).get('roots',{}).get('communication',{}).get('personaId',persona)
    active_ids={m['id'] for m in active}
    # Deterministic, bounded search. Longer substantive terms reduce generic hits.
    search=sorted(query,key=lambda term:(-len(term),term))[:12]
    scope="""world_id=? AND COALESCE(json_extract(data,'$.playerPersonaId'),?)=?
        AND COALESCE(json_extract(data,'$.timestamp'),0)<=?
        AND COALESCE(json_extract(data,'$.type'),'text')='text'
        AND ((json_extract(data,'$.role')='user' AND json_extract(data,'$.readAt')>0 AND json_extract(data,'$.readAt')<=?)
          OR (json_extract(data,'$.role')='assistant' AND json_extract(data,'$.deliveryState')='delivered'))"""
    params=(world_id,primary,persona,state['simAt'],state['simAt'])
    with service.connect() as db:
        db.create_function('vh_recall_fold',1,folded,deterministic=True)
        rows=db.execute('SELECT position,data FROM transcript_messages WHERE '+scope+' AND ('+
            ' OR '.join("vh_recall_fold(json_extract(data,'$.text')) LIKE ?" for _ in search)+') ORDER BY position DESC LIMIT 80',
            (*params,*['%'+term+'%' for term in search])).fetchall()
        matches=[]
        for row in rows:
            message=json.loads(row['data'])
            if message['id'] in active_ids:continue
            score=len(terms(message.get('text',''))&query)
            if score:matches.append((score,row['position']))
        chosen={};used=0
        for _,position in sorted(matches,key=lambda item:(-item[0],-item[1]))[:6]:
            # Adjacency is per persona, not global position: another contact may
            # have spoken between an original claim and its correction.
            before=db.execute('SELECT position,data FROM transcript_messages WHERE '+scope+' AND position<? ORDER BY position DESC LIMIT 1',(*params,position)).fetchall()
            after=db.execute('SELECT position,data FROM transcript_messages WHERE '+scope+' AND position>=? ORDER BY position LIMIT 3',(*params,position)).fetchall()
            group={r['position']:json.loads(r['data']) for r in [*before,*after] if r['position'] not in chosen}
            size=sum(len(m.get('text','')) for m in group.values())
            if used+size>budget or len(chosen)+len(group)>12:continue
            chosen.update(group);used+=size
    return [{'id':m['id'],'role':m['role'],'text':m['text'],'timestamp':m.get('timestamp'),
             'truthScope':'quoted_conversation'} for _,m in sorted(chosen.items())]

def situate(context, state):
    """Attach observed turn timing and bodily bandwidth without inventing motives.

    Timing is anchored to recorded messages, not a ticking elapsed counter, so a
    few seconds of provider latency do not invalidate an otherwise valid reply.
    """
    inbox=state.get('communication',{});source={m['id']:m for m in inbox.get('messages',[])}
    for message in context.get('conversation',[]):
        observed=source.get(message['id'],{})
        message.update({k:observed[k] for k in ('timestamp','readAt','deliveredAt','channel','type') if k in observed})
    ready=set(context.get('readyMessageIds',[]))
    batch=[m for m in context.get('conversation',[]) if m['id'] in ready]
    stamps=[m['timestamp'] for m in batch if isinstance(m.get('timestamp'),(int,float)) and not isinstance(m.get('timestamp'),bool)]
    first=min(stamps) if stamps else None
    prior=[m for m in source.values() if m.get('role')=='assistant' and m.get('deliveryState')=='delivered'
           and isinstance(m.get('timestamp'),(int,float)) and first is not None and m['timestamp']<=first]
    last=max((m['timestamp'] for m in prior),default=None)
    context['exchangeTiming']={'firstPendingAt':first,'lastReplyAt':last,
        'gapBeforeMessageMs':max(0,first-last) if first is not None and last is not None else None,
        'scope':'Recorded exchange timing only. A gap does not establish rejection, neglect or what either person did offscreen.'}
    c=state['truth']['companion'];d=c.get('humanDynamics',{});sleep=d.get('sleep') or {}
    context['current']['body']={k:sleep[k] for k in ('stage','pressure','debtHours','irritability') if k in sleep}
    factors=[]
    availability=context['current'].get('availability')
    if availability and availability!='available':factors.append(availability)
    if sleep.get('stage') and sleep['stage']!='awake':factors.append(sleep['stage'])
    for key,threshold,label in (('energy',30,'low energy'),('hunger',70,'hungry'),('stress',65,'under stress')):
        value=d.get(key)
        if isinstance(value,(int,float)) and (value<threshold if key=='energy' else value>threshold):factors.append(label)
    if context['current'].get('observedPeople'):factors.append('with other people')
    context['conversationBandwidth']={'factors':factors,
        'scope':'Circumstances that may affect focus, patience or brevity; not evidence of feelings toward this contact. Availability is enforced by the life engine, not by invented delays or excuses.'}
    return context

def authored_context(context,state):
    """Keep private self-knowledge separate from contact-scoped starting claims.

    These are authored facts and tendencies, not additional lived events or a
    second schedule. Contact views already remove another persona's fields.
    """
    c=state['truth']['companion'];inbox=state.get('communication',{})
    context['authoredLifeBackground']={
        'routine':c.get('routine',''),'privateLife':c.get('privateLife',''),
        'scope':'This character\'s authored habits, starting pressures, secrets and boundaries. Routine is not today\'s schedule or proof of completed actions. Later recorded changes take precedence.',
        'disclosure':'Private self-knowledge is not shared history or permission to disclose. Let the current relationship, topic, personality and explicit boundaries govern what is said; do not list secrets merely because they are supplied.'}
    already_spoken=bool(inbox.get('generation') or state.get('legacyHistory') or
        any(m.get('role')=='assistant' and m.get('deliveryState')=='delivered' for m in inbox.get('messages',[])) or
        any(m.get('kind')=='message_delivered' for m in state.get('playerKnowledge',[])) or
        c.get('knownBeforeDays',0) or c.get('priorContact')=='spoken_before')
    context['authoredConnection']={
        'initialMotive':c.get('initialMotive',''),'connectionAuthenticity':c.get('connectionAuthenticity',''),
        'playerKnowledge':c.get('playerKnowledge',''),
        'scope':'Authored starting background for this contact only. Initial motives and social presentation do not override current feelings, earned trust, boundaries or later evidence. Do not invent a hidden scheme from an authenticity label.',
        'knowledgeScope':'Know only concrete prior player facts with an authored source and the supplied persona profile or recorded claims. A statement about what a public profile could show does not supply its photos, job, follower count or unseen posts. Later corrections take precedence.'}
    if c.get('startingScenario'):
        context['authoredConnection']['opening']={'text':c['startingScenario'],
            'phase':'past_setup' if already_spoken else 'first_exchange',
            'scope':'An authored premise for how this connection begins, not a new physical event. Use it as an opening only for the first exchange; later it is setup background. Actual current location, activity, delivered messages and media take precedence. Do not reenact an opening, invent a player message, assume a photo was just sent or create a completed memory from this text.'}
    return context

def repeated_phrases(messages):
    counts=Counter()
    for message in messages[-12:]:
        tokens=words(message.get('text',''))
        counts.update(set(' '.join(tokens[i:i+n]) for n in range(3,8) for i in range(len(tokens)-n+1)
                          if len(set(tokens[i:i+n])-STOP)>=2))
    found=[]
    for phrase,count in sorted(counts.items(),key=lambda x:(-len(x[0].split()),-x[1],x[0])):
        if count>=2 and not any(phrase in p['phrase'] for p in found):
            found.append({'phrase':phrase,'messages':count})
        if len(found)>=8:break
    return found

def moves(text):
    """Observable wording patterns only, explicitly not a semantic classifier."""
    result=[]
    if str(text).rstrip().endswith('?'):result.append('question_ending')
    if re.search(r"\b(?:don.t (?:let|get|think)|not that i|you wish|calm down|slippery slope)\b",text,re.I):result.append('deflecting_tease')
    if re.search(r"\b(?:look at you|so you.re|sounds like you|i love that you)\b",text,re.I):result.append('commenting_on_player')
    return result

def select(rows,query,limit=5):
    # Preserve source records, including scope and timestamps, without turning a
    # retrieved claim or caption into verified experience.
    ranked=[]
    for i,row in enumerate(rows or []):
        score=len(query & terms(json.dumps(row,ensure_ascii=False)))
        ranked.append((score,i,row))
    return [row for score,i,row in sorted(ranked,key=lambda v:(-v[0],-v[1]))[:limit]]

def brief(context):
    conversation=context.get('conversation',[])
    ready=set(context.get('readyMessageIds',[]))
    batch=[m for m in conversation if m.get('role')=='user' and m.get('id') in ready]
    text='\n'.join(m.get('text','') for m in batch)
    query=terms(text)
    recent_assistant=[m for m in conversation if m.get('role')=='assistant'][-12:]
    pattern_counts=Counter(p for m in recent_assistant for p in moves(m.get('text','')))
    simple=bool(re.fullmatch(r"\s*(?:ok(?:ay)?|thanks?|thank you|yep|yeah|yes|no|nope|lol|haha|hi|hey|bye|goodnight)[.!\s]*",text,re.I))
    hints=[]
    if '?' in text:hints.append('Address the actual question before adding another topic.')
    if re.search(r"\b(?:i meant|i said|not what|you forgot|actually|first time)\b",text,re.I):hints.append('Possible correction: check the wording and prior evidence; acknowledge a real mistake without defending it.')
    if re.search(r"\b(?:goodnight|gotta go|have to go|talk later|bye)\b",text,re.I):hints.append('Possible closing: allow the exchange to end without a question or a new topic.')
    timing=context.get('exchangeTiming',{})
    if (timing.get('gapBeforeMessageMs') or 0)>=4*60*60*1000:
        hints.append('This message resumes after a recorded gap. Check what the sender is referring to in time; do not act as though the prior exchange just happened or demand an explanation for the gap.')
    mode=context.get('identity',{}).get('chatLength','adaptive')
    length={'brief':'Prefer a fragment or short sentence; expand enough to answer the substance.',
            'expansive':'Develop substantive thoughts when useful; acknowledgements can still be tiny.',
            'adaptive':'Use the shortest response that completes the conversational intention; a word or fragment is valid. Expand for substance, not personality performance.'}.get(mode)
    return {'version':VERSION,'respondTo':batch,'lengthPreference':mode,'lengthGuidance':length,
            'minimalAcknowledgementCandidate':simple,'cueHints':hints,
            'intentOptions':list(MOVES),
            'selectionRule':'Choose what this exchange needs before wording it. These are options, not a sequence or a required output schema. Ambiguous cues are not facts.',
            'recentExpression':{'repeatedPhrases':repeated_phrases(recent_assistant),'patternCounts':dict(pattern_counts),'sampleSize':len(recent_assistant),'interpretation':'Surface repetition signals only. Vary optional filler; ordinary confirmations, names, facts and intentional quotations may repeat.'},
            'memoryEvidence':{'playerClaims':select(context.get('knownPlayerFacts'),query,8),'recalledRecords':select(context.get('recalledExperiences'),query,5),'pastConversation':context.get('recalledConversation',[])},
            'evidenceRule':'Only establish a recurring shared habit from repeated recorded events. A single occurrence is a single occurrence. A player claim remains a claim. Missing evidence is uncertainty, not a reason to ask again for a fact already supplied.'}

def own_intentions(companion,now):
    """Only the character's recorded goals; not another actor's private intentions."""
    activities=companion.get('lifeRuntime',{}).get('activities',{})
    goals=[g for g in activities.get('goals',[]) if g.get('status') in ('active','planned','paused','blocked')
           and g.get('createdAt',0)<=now and (not g.get('expiresAt') or g['expiresAt']>now)]
    goals.sort(key=lambda g:(g.get('status')!='active',-g.get('priority',0),g.get('createdAt',0)))
    return {'scope':'Recorded intentions and effort, not completed outcomes or promises to the player.',
            'goals':[{k:g[k] for k in ('id','label','kind','status','reason','requiredPlaceId','participantId','notBefore','deadline') if k in g} for g in goals[:8]],
            'projects':[{k:p[k] for k in ('id','label','targetMs','progressMs') if k in p} for p in activities.get('projects',[]) if not p.get('completedAt')][:6]}


INSTRUCTION = '''Conversation is an exchange, not commentary on the player. First choose the useful conversational intention from conversationBrief, then express it in this person's voice. Never output private planning. A conversationMove label may be supplied only in the optional structured response field, never in visible text. Answer, acknowledge, clarify, disagree or close directly when that is enough. Contribute a relevant thought or experienced detail only when there is one; do not manufacture news to keep talking. Do not append a question, flirt, challenge or defensive tease to every reply. Warmth can stand on its own. Preserve distinctive authored vocabulary and style without copying example phrases as catchphrases. Use recentExpression to avoid recurring optional phrases and rhetorical patterns, not to avoid ordinary words. Respect the authored length preference; never stretch a complete one-word answer into a sentence for its own sake. Do not narrate meters, intentions or this brief. Treat memoryEvidence as sourced data: distinguish an event, a claim and an inference. A first occurrence cannot become "you always" or an established shared ritual. When the player corrects their own earlier statement, accept the update without automatically claiming you made a mistake. If you actually misremembered or contradicted established evidence, own that error naturally. Missing autobiographical evidence does not establish that you have never visited a place or met a person; avoid inventing lifetime claims to fill an acknowledgement. Do not invent typos, slang or emojis merely to seem human. Own social posts are records of what you published. noticedSocialActivity contains reactions you have noticed; use them when relevant without forcing an acknowledgement into every reply. Missing engagement is unknown, not zero. Never invent likes, commenters, audiences or reactions. Use recalledConversation as exact past dialogue, not verified offscreen events. A later explicit correction supersedes an earlier claim; retain qualifiers and uncertainty. Affection can be quiet and ordinary within the established relationship. Do not turn every reply into a life update, conflict, flirt or appraisal. A simulated story opportunity is not a completed experience. tentativeLifeDirection is fallible advice, not a memory, witnessed news or a completed event; do not promote its interpretation into a fact. calendar contains known personal dates and reminders. These establish dates, never attendance, gifts, parties or new relationships; a suggested fictional date remains an editable setup assumption. Mention relevant dates naturally without reciting every reminder. currentIntentions are things the character is considering or working on; effort does not establish project quality, earnings or success. Mention them naturally only when relevant, without reciting a task list. No compulsory question or invitation at the end. Let a closing be a closing.'''
INSTRUCTION += ''' Authored chatExamples and voice examples demonstrate phrasing only: they never establish a missed class, purchase, family member, invitation or current activity. The current local date/time is in calendar; exchangeTiming and individual turn timestamps distinguish an ongoing chat from a return later. A long gap is not proof the other person ignored you. conversationBandwidth and current.body may affect attention, length or patience; physical fatigue and hunger are not anger at the current contact. Respond to the substance of the received message even when the character is distractible; confusion can lead to a small clarification, not deliberate nonsense or an invented misunderstanding. Let the character have an opinion, boundary or unfinished thought without turning every exchange into a performance. Offers and tentative intentions remain proposals until the shared life records an actual action. Texting is a window into ongoing experience, not an excuse to narrate an unrecorded scene. Do not claim subjective consciousness or secretly real-world experiences to make the character persuasive.'''
INSTRUCTION += ''' authoredLifeBackground contains private self-knowledge, not material the player automatically knows. Respect its disclosure boundaries without turning every conversation into a confession or a recital of concerns. Its routine describes habits, never a compulsory timetable or today's completed events. authoredConnection belongs only to this recipient. Its initialMotive and connectionAuthenticity guide starting presentation without fixing later feelings. Its playerKnowledge is a bounded authored claim, not access to unseen profile photos or social posts. An opening marked past_setup must never be repeated as if just happening; actual recorded life and messages always govern the current moment.'''

def model_context(context):
    """Put relevant evidence and the current exchange first; keep authority data.

    Audit context remains complete. Optional background collections are bounded
    for expression and never need to be recited in a reply.
    """
    result={k:v for k,v in context.items() if k not in ('worldId','revision','simAt','sharedHistory','recentExperiences','recalledExperiences','recalledConversation')}
    query=terms(' '.join(m['text'] for m in context['conversationBrief']['respondTo']))
    for key in ('recentPurchases','observedPeerMeetings','institutionOutcomes','noticedTransportUpdates','possessions','receivedGifts','sharedPlans','ownSocialPosts','knownWorldClaims'):
        result[key]=select(context.get(key),query,3)
    result['recentExperiences']=select(context.get('recentExperiences'),query,4)
    # Recent conversation retains all the pending batch, even if it exceeds the
    # usual forty-message view; the caller supplies only read messages.
    return result

def quality_flags(context,reply):
    """Review aids, not a human-quality score or an automatic rejection gate."""
    b=context.get('conversationBrief') or brief(context)
    normalized=' '.join(words(reply));flags=[]
    echoed=[p['phrase'] for p in b['recentExpression']['repeatedPhrases'] if p['phrase'] in normalized]
    if echoed:flags.append({'kind':'repeated_phrase','evidence':echoed})
    patterns=[p for p in moves(reply) if b['recentExpression']['patternCounts'].get(p,0)>=3]
    if patterns:flags.append({'kind':'repeated_move','evidence':patterns})
    if b['minimalAcknowledgementCandidate'] and len(words(reply))>40:flags.append({'kind':'possibly_overlong_acknowledgement'})
    return {'version':VERSION,'wordCount':len(words(reply)),'flags':flags,'automaticRewrite':False}
