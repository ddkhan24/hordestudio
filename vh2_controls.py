"""Installation-wide proactive pause, committed for every persistent life."""
import json

def settings(service,paused=None):
 from vh2_runtime import encode
 with service.connect() as db:
  db.execute('CREATE TABLE IF NOT EXISTS vh2_controls (id INTEGER PRIMARY KEY CHECK(id=1),paused INTEGER NOT NULL)')
  if paused is not None:
   if type(paused) is not bool:raise ValueError('Set paused to true or false.')
   db.execute('BEGIN IMMEDIATE')
   db.execute('INSERT INTO vh2_controls VALUES (1,?) ON CONFLICT(id) DO UPDATE SET paused=excluded.paused',(int(paused),))
   for row in db.execute('SELECT id FROM worlds').fetchall():
    revision,state=service.read(db,row['id']);after=json.loads(encode(state))
    after['truth']['companion']['vh2AutonomyPaused']=paused
    service.commit_event(db,row['id'],revision,state,after,'PROACTIVE_PAUSE_CHANGED',{'paused':paused})
  row=db.execute('SELECT paused FROM vh2_controls WHERE id=1').fetchone()
  return {'paused':bool(row and row[0]),'scope':'All VH2 lives: new exploration, invitations, captures, sharing and automatic image submissions. Existing journeys and direct replies continue. Submitted provider requests may finish.'}
