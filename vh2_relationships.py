"""Explicit relationship pace and optional per-person adult romantic compatibility."""
import json
COMMANDS=('configure_social_progression','configure_romantic_potential')
BOUNDS={'contactMeetings':(2,50),'contactDays':(1,365),'contactStartHour':(0,23),'contactEndHour':(1,24),'friendMeetings':(3,100),'friendDays':(1,365),'friendWarmth':(0,100),'datingMeetings':(3,100),'datingDays':(7,365),'partnerMeetings':(6,200),'partnerDays':(14,730),'strainThreshold':(5,100),'quietDays':(1,365),'distantDays':(7,730)}
def command(service,db,world_id,revision,state,body):
 from vh2_runtime import encode
 after=json.loads(encode(state));c=after['truth']['companion'];r=c['vh2SocialBonds']
 if body['type']=='configure_social_progression':
  p=body.get('policy')
  if not isinstance(p,dict) or set(p)!=set(BOUNDS) or any(type(p[k]) not in (int,float) or not low<=p[k]<=high for k,(low,high) in BOUNDS.items()):raise ValueError('Provide all valid social progression settings.')
  if any(type(p[k]) is not int for k in BOUNDS if k.endswith('Meetings') or k.endswith('Days')):raise ValueError('Meeting counts and days must be whole numbers.')
  if p['contactStartHour']>=p['contactEndHour']:raise ValueError('Contact hours must form a window within one day.')
  if p['partnerMeetings']<p['datingMeetings'] or p['partnerDays']<p['datingDays'] or p['distantDays']<p['quietDays']:raise ValueError('Later milestones cannot precede earlier milestones.')
  r['policy']=p
 else:
  ident=body.get('personId');person=next((p for p in c['lifeProfile']['socialCircle'] if p['id']==ident),None);p=body.get('policy')
  if not person:raise ValueError('Choose someone already known to this character.')
  if not isinstance(p,dict) or set(p)!={'enabled','personAge','selfPotential','otherPotential'} or type(p['enabled']) is not bool:raise ValueError('Provide complete romantic-potential settings.')
  if type(p['personAge']) is not int or not 0<=p['personAge']<=120 or any(type(p[k]) not in (int,float) or not 0<=p[k]<=100 for k in ('selfPotential','otherPotential')):raise ValueError('Invalid age or compatibility.')
  from vh2_calendar import current_age
  own_age=current_age(c);other_age=current_age(c,person)
  anchored=ident in c.get('vh2Calendar',{}).get('ages',{})
  if other_age is None and not anchored and person.get('age') is None:other_age=p['personAge']
  if p['enabled'] and (own_age is None or own_age<18 or other_age is None or other_age<18 or p['personAge']<18 or anchored and p['personAge']>other_age or person['role']=='family'):raise ValueError('Romantic progression requires two established adults who are not family.')
  pair=r['pairs'].get(ident)
  if not pair:raise ValueError('Advance life once to initialize this relationship.')
  pair.setdefault('lifecycle',{'status':'partner' if person['role']=='partner' else 'separated' if person['role']=='ex' else 'none','contactExchangedAt':None,'events':[]})['policy']=p
 revision=service.commit_event(db,world_id,revision,state,after,'SOCIAL_PROGRESSION_CONFIGURED',{'operation':body['type']})
 return revision,after
