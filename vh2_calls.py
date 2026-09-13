"""Calls share the life-owned conversation, attention and expression pipeline."""
import json,re
COMMANDS=('start_call','end_call','call_turn')
def command(service,db,world,revision,state,body):
 from vh2_runtime import encode,Conflict
 revision,state=service.synchronize_communication(db,world,revision,state)
 after=json.loads(encode(state));inbox=after['communication'];now=after['simAt'];kind=body['type'];ident=body.get('callId')
 if not isinstance(ident,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}',ident):raise ValueError('Provide a call ID.')
 current=inbox.get('call')
 if kind=='start_call':
  contacts=__import__('vh2_conversations')
  if any((lambda call:call.get('status')=='active' and call.get('expiresAt',0)>now)(contacts.view(after,p)['communication'].get('call',{})) for p in contacts.ids(after)):
   raise Conflict('They are already on a call. Try again after it ends.')
  if not after['running']:raise Conflict('Resume this life before calling.')
  if current and current['status']=='active' and current['expiresAt']>now:raise Conflict('There is already an active call.')
  if after['truth']['present']['availability']!='available':raise Conflict('They cannot answer a call during their current activity.')
  inbox['call']={'id':ident,'status':'active','startedAt':now,'expiresAt':now+600000}
  revision=service.commit_event(db,world,revision,state,after,'CALL_STARTED',{'callId':ident})
  return service.communication_command(db,world,revision,after,dict(body,type='receive_message',messageType='call',text='[Phone call connected] Say hello naturally.'))
 if not current or current['id']!=ident:raise Conflict('This call is no longer active.')
 if kind=='end_call':
  if current['status']=='ended':return revision,state
  current.update(status='ended',endedAt=now)
  for message in inbox['messages']:
   if message.get('callId')==ident and message.get('awaitingReply'):message.update(awaitingReply=False,callEndedAt=now)
  revision=service.commit_event(db,world,revision,state,after,'CALL_ENDED',{'callId':ident});return revision,after
 if current['status']!='active' or current['expiresAt']<=now:raise Conflict('This call has ended. Start a new call.')
 current['expiresAt']=now+600000
 revision=service.commit_event(db,world,revision,state,after,'CALL_TURN_RECEIVED',{'callId':ident})
 return service.communication_command(db,world,revision,after,dict(body,type='receive_message',messageType='call'))
