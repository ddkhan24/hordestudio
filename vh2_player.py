"""Per-timeline player profile claims, separate from remembered conversation facts."""
import json
import vh2_profile
COMMANDS=('configure_player_profile','configure_expression_profile','configure_personal_preferences')
def command(service,db,world,revision,state,body):
 from vh2_runtime import encode
 if body['type']=='configure_personal_preferences':
  profile=body.get('profile')
  text_fields=('interests','aversions','boundaries','affectionStyle','contextNotes')
  numeric_fields=('openness','privacyPreference','initiative','restraint')
  if not isinstance(profile,dict) or set(profile)!=set(text_fields+numeric_fields):raise ValueError('Provide all personal preference fields.')
  age=__import__('vh2_calendar').current_age(state['truth']['companion'])
  if isinstance(age,bool) or not isinstance(age,(int,float)) or age<18:raise ValueError('Personal preference controls require an adult character.')
  for key in text_fields:
   if not isinstance(profile[key],str) or len(profile[key])>2000:raise ValueError('Preference text must be at most 2000 characters per field.')
  for key in numeric_fields:
   if isinstance(profile[key],bool) or not isinstance(profile[key],(int,float)) or not 0<=profile[key]<=100:raise ValueError('Preference levels must be numbers from 0 to 100.')
  after=json.loads(encode(state));after['truth']['companion']['personalPreferences']={**profile,'scope':'authored_preferences','updatedAt':state['simAt']}
  revision=service.commit_event(db,world,revision,state,after,'PERSONAL_PREFERENCES_CHANGED',{'fields':sorted(profile)})
  return revision,after
 if body['type']=='configure_expression_profile':
  fields=body.get('fields');allowed={'appearance','personality','behaviorExamples','description','backstory','chatStyle','textingStyle','conversationStyle','chatExamples','chatAvoid','chatLength','values','contradictions','vulnerabilities','relationshipStyle','habits','photoStyle','photoDirection','voice'}
  if not isinstance(fields,dict) or not fields or set(fields)-(allowed|vh2_profile.FIELDS) or len(encode(fields))>60000:raise ValueError('Supply only supported character expression settings, up to 60 KB.')
  for k,v in fields.items():
   if k in vh2_profile.FIELDS:
    vh2_profile.validate(k,v);continue
   if k in ('chatStyle','textingStyle','conversationStyle','voice'):
    if not isinstance(v,(str,dict)):raise ValueError('Invalid style settings.')
   elif not isinstance(v,str):raise ValueError('Expression fields must be text.')
  after=json.loads(encode(state));c=after['truth']['companion']
  for k,v in fields.items():
   if k=='voice':c['lifeProfile']['world']['voice']=v
   else:c[k]=v
  vh2_profile.apply(c,fields)
  revision=service.commit_event(db,world,revision,state,after,'EXPRESSION_PROFILE_CHANGED',{'fields':sorted(fields)})
  return revision,after
 profile=body.get('profile')
 if not isinstance(profile,dict) or set(profile)!={'templateId','name','text'}:raise ValueError('Provide a profile template ID, name and text.')
 for key,limit in (('templateId',120),('name',160),('text',6000)):
  if not isinstance(profile[key],str) or len(profile[key])>limit:raise ValueError('Player profile exceeds its field limits.')
 after=json.loads(encode(state));after['communication']['playerProfile']={**profile,'updatedAt':after['simAt'],'scope':'player_claim'}
 # Canonical conversation identity and remembered facts are deliberately retained.
 # Dialogue fingerprints include this profile, so stale pending expression is superseded.
 revision=service.commit_event(db,world,revision,state,after,'PLAYER_PROFILE_CHANGED',{'templateId':profile['templateId']})
 return revision,after
