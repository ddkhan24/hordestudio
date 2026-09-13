"""Validated configuration and requests for the canonical joint-activity lifecycle."""
import json,math,uuid
COMMANDS=('propose_plan','cancel_plan','leave_plan','respond_plan','configure_social_plans')
DEFAULT_SOCIAL_PLAN_POLICY={'enabled':False,'remoteInvitations':True,'hostedEvents':True,'privateVisits':False,'invitationCooldownMinutes':360,'socialNeedThreshold':55,'maxGuests':5,'privateVisitInterest':35}
SOCIAL_PLAN_BOUNDS={'invitationCooldownMinutes':(10,10080),'socialNeedThreshold':(0,100),'maxGuests':(1,8),'privateVisitInterest':(0,100)}
def validate_social_plan_policy(policy):
    if not isinstance(policy,dict) or set(policy)-set(DEFAULT_SOCIAL_PLAN_POLICY):raise ValueError('Supply only supported social plan settings.')
    result={**DEFAULT_SOCIAL_PLAN_POLICY,**policy}
    for key in ('enabled','remoteInvitations','hostedEvents','privateVisits'):
        if type(result[key]) is not bool:raise ValueError(key+' must be true or false.')
    for key,(low,high) in SOCIAL_PLAN_BOUNDS.items():
        if type(result[key]) not in (int,float) or not math.isfinite(result[key]) or not low<=result[key]<=high or key=='maxGuests' and type(result[key]) is not int:raise ValueError(key+' is outside the supported range.')
    return result

def validate_private_visit_permissions(companion,items):
    if not isinstance(items,list) or len(items)>30:raise ValueError('Supply up to thirty private-visit preferences.')
    known={p['id'] for p in companion.get('lifeProfile',{}).get('socialCircle',[])}|{p['id'] for p in companion.get('vh2Population',{}).get('residents',[])};seen=set();result=[]
    for item in items:
        fields={'personId','personAge','enabled','selfWillingness','otherWillingness','allowIntimacy'}
        if not isinstance(item,dict) or set(item)!=fields:raise ValueError('Supply supported private-visit preference fields.')
        ident=item['personId']
        if not isinstance(ident,str) or ident not in known or ident in seen:raise ValueError('Choose distinct known people for private-visit preferences.')
        seen.add(ident)
        person=next((p for p in companion['lifeProfile']['socialCircle'] if p['id']==ident),{})
        resident=next((p for p in companion.get('vh2Population',{}).get('residents',[]) if p.get('id')==ident),{})
        if item.get('allowIntimacy') and person.get('role')=='family':raise ValueError('Family visits cannot enable romantic or intimate outcomes.')
        from vh2_calendar import current_age,age_confirmation_matches
        subject=person or resident;known_age=current_age(companion,subject)
        if type(known_age) not in (int,float) or not math.isfinite(known_age) or not 18<=known_age<=130:raise ValueError('Record this person’s adult age in their character setup first.')
        if not age_confirmation_matches(companion,subject,item.get('personAge')):raise ValueError('Private-visit age must match a confirmed adult age for this person.')
        if type(item['personAge']) is not int or not 18<=item['personAge']<=130:raise ValueError('An explicit adult age is required for each private-visit participant.')
        if any(type(item[k]) is not bool for k in ('enabled','allowIntimacy')):raise ValueError('Private-visit switches must be true or false.')
        for key in ('selfWillingness','otherWillingness'):
            if type(item[key]) not in (int,float) or not math.isfinite(item[key]) or not 0<=item[key]<=100:raise ValueError('Private-visit willingness must be 0–100.')
        if item['enabled'] and (type(companion.get('age')) not in (int,float) or not 18<=companion['age']<=130):raise ValueError('The main character must have an explicit adult age.')
        result.append(dict(item))
    return result

def _members(companion,plan):return plan.get('people',[companion['id'],plan.get('personId')])
def _committed(companion,plan,ident):return ident in _members(companion,plan) and ident not in plan.get('departures',{}) and plan.get('responses',{}).get(ident,{}).get('decision')!='decline'
def _home(companion,ident):
    if ident!=companion['id']:return companion.get('vh2People',{}).get('actors',{}).get(ident,{}).get('policy',{}).get('homePlaceId')
    places=companion['lifeProfile']['places'];homes=[p['id'] for p in places if p['kind']=='home']
    return companion.get('vh2Travel',{}).get('residenceId') or (homes[0] if len(homes)==1 else None)

def visible_shared_plans(companion):
    """Invitation knowledge and experienced outcomes, never unrelated peer truth."""
    result=[];ident=companion['id']
    fields=('id','personId','people','placeId','label','startsAt','endsAt','durationMinutes','status','activityKind','modality','initiatorId','hostId')
    for plan in companion.get('vh2Plans',{}).get('plans',[]):
        if ident not in plan.get('people',[] if plan.get('scope')=='peers' else [ident]):continue
        item={k:plan[k] for k in fields if k in plan}
        departure=plan.get('departures',{}).get(ident)
        if departure:
            item.update(status='left',departedAt=departure['at'])
        elif plan.get('privateOutcome') and ident in plan['privateOutcome'].get('participantIds',[]):
            item['privateOutcome']=plan['privateOutcome']
        if ident in plan.get('attendance',{}):item['ownParticipation']=plan['attendance'][ident]
        result.append(item)
    return result[-12:]

def command(service,db,world_id,revision,state,body):
    from vh2_runtime import Conflict,encode
    revision,state=service.synchronize_communication(db,world_id,revision,state)
    c=state['truth']['companion'];plans=c.get('vh2Plans',{}).get('plans',[]);now=state['simAt']
    if body['type']=='configure_social_plans':
        policy=validate_social_plan_policy({**c.get('vh2Plans',{}).get('policy',{}),**body.get('policy',{})})
        permissions=validate_private_visit_permissions(c,body['privateVisitPermissions']) if 'privateVisitPermissions' in body else None
        after=json.loads(encode(state));r=after['truth']['companion'].setdefault('vh2Plans',{'plans':[],'events':[]});r['policy']=policy
        if permissions is not None:r['privateVisitPermissions']=permissions
        revision=service.commit_event(db,world_id,revision,state,after,'SOCIAL_PLAN_POLICY_CONFIGURED')
        return revision,after,None
    if body['type']=='propose_plan':
        if sum(p['status'] in ('proposed','accepted','active') for p in plans)>=100:raise Conflict('Resolve an outstanding shared plan before proposing another.')
        known={p['id'] for p in c['lifeProfile']['socialCircle']}
        if body.get('personId') not in known:raise ValueError('Choose a supporting person from this profile.')
        participants=body.get('personIds',[body['personId']])
        if not isinstance(participants,list) or not 1<=len(participants)<=8 or any(not isinstance(p,str) or p not in known for p in participants) or len(set(participants))!=len(participants) or body['personId'] not in participants:raise ValueError('Choose one to eight distinct supporting participants.')
        modality=body.get('modality','in_person');kind=body.get('activityKind','meeting')
        if modality not in ('in_person','call') or kind not in ('meeting','hosted_event','private_visit','event_outing'):raise ValueError('Choose a supported shared activity and contact mode.')
        if modality=='call' and kind!='meeting':raise ValueError('This activity requires physical attendance.')
        place=next((p for p in c['lifeProfile']['places'] if p['id']==body.get('placeId')),None)
        if modality!='call' and not place:raise ValueError('Choose a recorded place.')
        if modality=='call' and any(p not in c.get('vh2People',{}).get('actors',{}) for p in participants):raise ValueError('Calls require each person to have a participating life.')
        ids=[c['id'],*participants];host=body.get('hostId') or next((p for p in ids if place and _home(c,p)==place['id']),None);initiator=body.get('initiatorId',c['id'])
        if initiator not in ids or host is not None and host not in ids:raise ValueError('The initiator and host must be participants.')
        if modality!='call' and place['kind']=='home' and (not host or _home(c,host)!=place['id']):raise ValueError('Home access requires its resident host to participate.')
        if kind=='private_visit':
            if len(participants)!=1 or not place or place['kind']!='home':raise ValueError('A private visit requires two people and a recorded host home.')
            pref=next((p for p in c.get('vh2Plans',{}).get('privateVisitPermissions',[]) if p['personId']==body['personId'] and p['enabled']),None)
            if pref:validate_private_visit_permissions(c,[pref])
            else:
                from vh2_calendar import current_age
                individual=next(p for p in c['lifeProfile']['socialCircle'] if p['id']==body['personId']);age=current_age(c,individual)
                explicit=next((p for p in c.get('vh2Plans',{}).get('privateVisitPermissions',[]) if p['personId']==body['personId']),None)
                if explicit is not None or not c.get('vh2Plans',{}).get('policy',{}).get('privateVisits') or not (current_age(c) is not None and current_age(c)>=18) or type(age) not in (int,float) or age<18:raise ValueError('Private visits require known adults and enabled individual preferences.')
        label=body.get('label');start=body.get('startsAt');end=body.get('endsAt');duration=body.get('durationMinutes')
        if not isinstance(label,str) or not 1<=len(label.strip())<=160:raise ValueError('Describe the plan in 1–160 characters.')
        if type(duration) is not int or not 1<=duration<=120:raise ValueError('Duration must be 1–120 minutes.')
        if type(start) is int and end is None:end=start+max(duration,kind=='hosted_event' and 120 or 30)*60000
        if type(start) is not int or type(end) is not int or not now<start<end<=now+7*86400000 or end-start>4*3600000:raise ValueError('Choose a future window of at most four hours within seven days.')
        if duration*60000>end-start:raise ValueError('Duration must fit the meeting window.')
        parent=body.get('parentPlanId')
        if parent is not None and not any(p['id']==parent and _committed(c,p,c['id']) for p in plans):raise ValueError('Choose an existing plan to leave for this follow-up.')
        if any(p['id']!=parent and p['status'] in ('proposed','accepted','active') and start<p['endsAt'] and end>p['startsAt'] and any(_committed(c,p,i) for i in ids) for p in plans):raise Conflict('One of these participants has an overlapping shared plan.')
        ident=str(uuid.uuid5(uuid.NAMESPACE_URL,'vh2-plan:'+body['key']))
        request={'type':'propose_plan','planId':ident,'personId':body['personId'],'personIds':participants,'placeId':place['id'] if place else '', 'startsAt':start,'endsAt':end,'durationMinutes':duration,'label':label.strip(),'modality':modality,'activityKind':kind,'hostId':host,'initiatorId':initiator,'parentPlanId':parent}
    else:
        ident=body.get('planId');p=next((p for p in plans if p['id']==ident),None)
        if not p or p['status'] not in ('proposed','accepted','active'):raise Conflict('This shared plan is already resolved or unknown.')
        if c['id'] not in _members(c,p):raise ValueError('This private peer plan is not yours to control.')
        request={'type':body['type'],'planId':ident}
        if body['type'] in ('leave_plan','respond_plan'):
            actor=body.get('personId',c['id'])
            if actor!=c['id']:raise ValueError('Each supporting person makes their own participation decision.')
            request['personId']=actor
            if body['type']=='respond_plan':
                if p['status']!='proposed' or body.get('decision') not in ('accept','decline'):raise ValueError('Respond to an outstanding invitation with accept or decline.')
                request['decision']=body['decision']
    after=json.loads(encode(state))
    after['truth']=service.kernel({'companion':after['truth']['companion'],'now':now,'inspect':True,'planCommand':request})
    revision=service.commit_event(db,world_id,revision,state,after,'SHARED_PLAN_'+body['type'].upper(),{'planId':ident})
    return revision,after,ident
