"""Checkpointed, non-destructive runtime reboot for an existing life."""
import hashlib,json
COMMANDS=('reboot_life','catch_up_life')

def faulty_sleep_seed(db,world_id,state):
 current=state['truth']['companion'].get('humanDynamics',{}).get('sleep') or {}
 if current.get('initializationVersion')==2:return False
 # Inspect persisted initialization evidence, not a guess from current tiredness.
 for row in db.execute('SELECT payload FROM events WHERE world_id=? ORDER BY seq',(world_id,)):
  for change in json.loads(row[0]).get('changes',[]):
   if change.get('path')!=['truth','companion','humanDynamics','sleep']:continue
   seed=change.get('value')
   if not isinstance(seed,dict):continue
   if seed.get('initializationVersion')==2:return False
   age=(seed.get('lastAt',0)-seed.get('lastWakeAt',0))/3600000
   return (seed.get('stage')=='awake' and not seed.get('sleepStartedAt') and not seed.get('wakeAt')
           and seed.get('debtHours',0)==0 and seed.get('pressure',0)>=80 and 17<age<=24
           and current.get('lastWakeAt')==seed.get('lastWakeAt') and not current.get('wakeAt'))
 return False

def command(service,db,world_id,revision,state,body):
 from vh2_runtime import encode
 checkpoint_id=hashlib.sha256((world_id+':reboot:'+str(revision)+':'+encode(state)).encode()).hexdigest()
 db.execute('INSERT OR IGNORE INTO kernel_checkpoints VALUES (?,?,?,?)',(checkpoint_id,world_id,revision,encode(state)))
 after=json.loads(encode(state))
 if body['type']=='catch_up_life':
  now=service.clock()
  if state['simAt']>now:raise ValueError('This life is ahead of real time. Catch-up cannot rewind its history.')
  after.update(running=True,wallAnchor=now,simAnchor=now)
  after['liveClockSync']={'requestedAt':now,'fromSimAt':state['simAt'],'checkpointId':checkpoint_id,'automatic':body.get('automatic') is True}
  for source in after['truth']['companion'].get('vh2Signals',{}).get('sources',[]):
   if source.get('kind') in ('ticketmaster','aviationstack'):source.update(lastAttemptAt=None,error='',errorCode='')
  revision=service.commit_event(db,world_id,revision,state,after,'LIVE_CLOCK_CATCHUP_REQUESTED',{'checkpointId':checkpoint_id})
  return revision,after,checkpoint_id
 repair=faulty_sleep_seed(db,world_id,state)
 result=service.kernel({'companion':after['truth']['companion'],'now':after['simAt'],'inspect':True,'repairSleepInitialization':repair})
 result.pop('communication',None)
 after['truth']=result
 # Retain the timeline clock, running/paused choice, work, history and provider jobs.
 # An active life follows real time; a deliberately paused life stays paused.
 # Only the target moves. Actual missed time still executes through the kernel.
 after.update(wallAnchor=service.clock(),simAnchor=max(after['simAt'],service.clock()) if after['running'] else after['simAt'])
 after['runtimeReboot']={'at':service.clock(),'simAt':after['simAt'],'sleepInitializationRepaired':repair,'checkpointId':checkpoint_id}
 revision=service.commit_event(db,world_id,revision,state,after,'LIFE_REBOOTED',{'checkpointId':checkpoint_id,'sleepInitializationRepaired':repair})
 return revision,after,checkpoint_id
