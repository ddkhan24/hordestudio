"""Bounded iCalendar VEVENT subset (RFC 5545); no inferred venues or recurrence expansion."""
import datetime,hashlib,re
from zoneinfo import ZoneInfo,ZoneInfoNotFoundError
UTC=datetime.timezone.utc

PERSONAL_KINDS=('birthday','anniversary','milestone','holiday','other')

def personal_date(value):
 if not isinstance(value,str):raise ValueError('Choose a valid calendar date.')
 partial=bool(re.fullmatch(r'--\d{2}-\d{2}',value))
 try:
  parsed=datetime.date.fromisoformat('2000'+value[1:] if partial else value)
  if not partial and parsed.isoformat()!=value:raise ValueError()
 except ValueError:raise ValueError('Choose a valid calendar date.')
 return parsed,partial

def validate_personal(rows,c,as_of=None):
 if not isinstance(rows,list) or len(rows)>200:raise ValueError('Use up to 200 personal calendar entries.')
 known={'self'}|{p['id'] for p in c.get('lifeProfile',{}).get('socialCircle',[])}
 ids=set();birthdays=set();out=[]
 fields={'id','title','date','kind','recurrence','personId','reminderDays','notes','source','enabled'}
 for row in rows:
  if not isinstance(row,dict) or set(row)-fields:raise ValueError('Unsupported personal calendar fields.')
  if not isinstance(row.get('id'),str) or not 1<=len(row['id'])<=80 or row['id'] in ids:raise ValueError('Calendar entries need unique IDs.');
  ids.add(row['id'])
  if not isinstance(row.get('title'),str) or not 1<=len(row['title'].strip())<=160:raise ValueError('Give every calendar date a short title.')
  parsed,partial=personal_date(row.get('date'))
  kind=row.get('kind','other');recurrence=row.get('recurrence','none');person=row.get('personId','')
  if kind not in PERSONAL_KINDS or recurrence not in ('none','yearly') or partial and recurrence!='yearly':raise ValueError('Month-and-day dates must repeat yearly.')
  if person and person not in known:raise ValueError('A personal date refers to an unknown person.')
  if kind=='birthday':
   if not person or recurrence!='yearly' or person in birthdays:raise ValueError('Use one yearly birthday per known person.')
   if not partial and (parsed.year<1800 or as_of and (parsed>as_of or age_on(parsed,as_of) is None)):raise ValueError('A full birthday must be a birth date giving an age from 0 to 130 at the current life date.')
   birthdays.add(person)
  reminder=row.get('reminderDays',7)
  if type(reminder) is not int or not 0<=reminder<=90:raise ValueError('Use a reminder from 0 to 90 days before the event.')
  if not isinstance(row.get('notes',''),str) or len(row.get('notes',''))>1000:raise ValueError('Keep calendar notes under 1000 characters.')
  if row.get('source','authored') not in ('authored','fictional_assumption'):raise ValueError('Mark dates as authored or fictional assumptions.')
  if type(row.get('enabled',True)) is not bool:raise ValueError('Calendar reminders must be on or off.')
  out.append({**row,'title':row['title'].strip(),'kind':kind,'recurrence':recurrence,'personId':person,'reminderDays':reminder,'notes':row.get('notes',''),'source':row.get('source','authored'),'enabled':row.get('enabled',True)})
 return out

def prepare(state):
 """One persistent birthday per authored known person; no inferred relationships.

 Missing month/day reminders remain marked fictional. They never infer a year.
 Derived live ages have their own provenance; authored ages remain unchanged.
 Hidden birthday entries retain their date instead of regenerating after reload.
 """
 c=state.get('truth',{}).get('companion')
 if not c:return
 life=c['lifeProfile'];rows=life.setdefault('personalCalendar',[])
 existing={r.get('personId') for r in rows if r.get('kind')=='birthday'}
 for ident,name in [('self',c['name'])]+[(p['id'],p['name']) for p in life.get('socialCircle',[])]:
  if ident in existing or len(rows)>=200:continue
  key=c['id']+'|birthday|'+ident;digest=hashlib.sha256(key.encode()).hexdigest()
  day=datetime.date(2000,1,1)+datetime.timedelta(days=int(digest[:8],16)%366)
  rows.append({'id':'birthday_'+hashlib.sha256(ident.encode()).hexdigest()[:16],'title':name+'’s birthday','date':day.strftime('--%m-%d'),'kind':'birthday','recurrence':'yearly','personId':ident,'reminderDays':7,'notes':'','source':'fictional_assumption','enabled':True})
 prepare_ages(state)

def local_datetime(state,person_id='self'):
 c=state['truth']['companion']
 if person_id=='self':zone=c.get('vh2Travel',{}).get('currentContext',{}).get('timeZone') or c.get('timezone')
 else:zone=c.get('vh2People',{}).get('actors',{}).get(person_id,{}).get('policy',{}).get('timeZone') or c.get('timezone')
 try:tz=ZoneInfo(zone) if zone else datetime.timezone(datetime.timedelta(minutes=c.get('timezoneOffsetMinutes',0)))
 except (ZoneInfoNotFoundError,ValueError,TypeError):tz=UTC
 return datetime.datetime.fromtimestamp(state['simAt']/1000,tz)

def age_on(born,today):
 """Chronological age: a leap-day birthday reaches its boundary on March 1.

 Reminder celebrations may be on February 28, but adulthood is never advanced
 a day early. This is a simulation convention, not a jurisdictional legal rule.
 """
 age=today.year-born.year-((today.month,today.day)<(born.month,born.day))
 return age if 0<=age<=130 and born<=today else None

def prepare_ages(state):
 if type(state.get('simAt')) not in (int,float) or state['simAt']<=0:return
 c=state['truth']['companion'];life=c.get('lifeProfile',{})
 people={'self':c,**{p['id']:p for p in life.get('socialCircle',[])}}
 prior=c.get('vh2Calendar',{}).get('ages',{});records={}
 for row in life.get('personalCalendar',[])[:200]:
  ident=row.get('personId')
  if row.get('kind')!='birthday' or ident not in people:continue
  person=people[ident];today=local_datetime(state,ident).date();authored=person.get('age')
  try:date,partial=personal_date(row.get('date'))
  except ValueError:continue
  record=prior.get(ident,{})
  source=row.get('source','authored')
  if not partial:
   # A full fictional DOB explicitly authored into a template is distinct from
   # an automatically suggested month/day placeholder.
   born=date;origin='authored_fictional_dob' if source=='fictional_assumption' else 'authored_dob'
  elif source=='authored' and type(authored) is int and 0<=authored<=120:
   if record.get('sourceDate')==row['date'] and record.get('source')=='inferred_birth_year' and record.get('authoredAge')==authored:
    try:born=datetime.date.fromisoformat(record['birthDate'])
    except (KeyError,ValueError,TypeError):continue
   else:
    year=today.year-authored-((today.month,today.day)<(date.month,date.day))
    try:born=date.replace(year=year)
    except ValueError:continue # A supplied leap day and age may be inconsistent.
    if born.year<1800 or age_on(born,today)!=authored:continue
    record={}
   origin='inferred_birth_year'
  else:continue
  same=record.get('sourceDate')==row['date'] and record.get('source')==origin and record.get('birthDate')==born.isoformat() and record.get('authoredAge')==authored
  records[ident]={'birthDate':born.isoformat(),'sourceDate':row['date'],'source':origin,'authoredAge':authored,
                 'referenceDate':record['referenceDate'] if same else today.isoformat(),
                 'currentAge':age_on(born,today) if born.year>=1800 else None,'asOf':today.isoformat()}
 if records or 'vh2Calendar' in c:c['vh2Calendar']={'version':1,'ages':records}

def current_age(companion,person=None):
 person=companion if person is None else person
 ident='self' if person is companion or person.get('id')==companion.get('id') else person.get('id')
 records=companion.get('vh2Calendar',{}).get('ages',{})
 value=records[ident].get('currentAge') if ident in records else person.get('age')
 return value if type(value) in (int,float) and 0<=value<=130 else None

def age_confirmation_matches(companion,person,recorded):
 age=current_age(companion,person)
 if age is None or age<18 or type(recorded) is not int or recorded<18:return False
 anchored=person.get('id') in companion.get('vh2Calendar',{}).get('ages',{})
 return recorded<=age if anchored else recorded==age

def next_age_boundary(state):
 c=state.get('truth',{}).get('companion',{});records=c.get('vh2Calendar',{}).get('ages',{})
 boundaries=[]
 for ident in records:
  local=local_datetime(state,ident)
  midnight=datetime.datetime.combine(local.date()+datetime.timedelta(days=1),datetime.time(),tzinfo=local.tzinfo)
  at=int(midnight.timestamp()*1000)
  if at>state['simAt']:boundaries.append(at)
 return min(boundaries) if boundaries else None

def occurrence(row,year):
 origin,partial=personal_date(row['date'])
 if row.get('recurrence')!='yearly':return origin if origin.year==year else None
 if not partial and year<origin.year:return None
 # February 29 is observed on February 28 in non-leap years.
 try:return origin.replace(year=year)
 except ValueError:return datetime.date(year,2,28)

def personal_context(c,today):
 upcoming=[];recent=[];known={'self':c['name'],**{p['id']:p['name'] for p in c['lifeProfile'].get('socialCircle',[])}}
 for row in c['lifeProfile'].get('personalCalendar',[]):
  if row.get('enabled',True) is False or row.get('personId') and row['personId'] not in known:continue
  dates=[occurrence(row,y) for y in range(today.year-1,today.year+2)]
  for date in filter(None,dates):
   days=(date-today).days
   item={**row,'personName':known.get(row.get('personId')),'occursOn':date.isoformat(),'daysAway':days,'reminderActive':0<=days<=row.get('reminderDays',7),'scope':'known_personal_date_not_completed_activity'}
   if 0<=days<=366:upcoming.append(item)
   elif -7<=days<0:recent.append(item)
 # Each recurring entry appears once in the upcoming list, including leap years.
 upcoming.sort(key=lambda r:(r['occursOn'],r['id']));seen=set();upcoming=[r for r in upcoming if r['id'] not in seen and not seen.add(r['id'])]
 birthdays=[{k:r[k] for k in ('id','personId','title','date','source') if k in r} for r in c['lifeProfile'].get('personalCalendar',[]) if r.get('kind')=='birthday' and r.get('enabled',True) and r.get('personId') in known]
 reminders=[{k:r[k] for k in ('id','title','occursOn','daysAway','source')} for r in upcoming if r['reminderActive']]
 return {'knownBirthdays':birthdays,'activeReminders':reminders,'upcomingDates':[{**r,'notes':r.get('notes','')[:300]} for r in upcoming[:30]],'recentDates':sorted(recent,key=lambda r:r['occursOn'],reverse=True)[:15],
         'personalDateScope':'Known birthdays and important dates, not proof of celebrations, attendance, gifts, messages or relationship milestones. Suggested fictional dates are editable. February 29 is observed on February 28 in other years.'}

def unescape(value):
 out=[];i=0
 while i<len(value):
  if value[i]=='\\' and i+1<len(value):i+=1;out.append('\n' if value[i] in 'nN' else value[i])
  else:out.append(value[i])
  i+=1
 return ''.join(out)

def timestamp(field,default_zone):
 params,value=field
 if params.get('VALUE')=='DATE' or len(value)==8:
  if not default_zone:return None
  try:return int(datetime.datetime.strptime(value,'%Y%m%d').replace(tzinfo=ZoneInfo(default_zone)).timestamp()*1000)
  except (ValueError,ZoneInfoNotFoundError,OverflowError):return None
 try:
  if value.endswith('Z'):dt=datetime.datetime.strptime(value,'%Y%m%dT%H%M%SZ').replace(tzinfo=UTC)
  else:
   zone=params.get('TZID',default_zone)
   if not zone:return None
   local=datetime.datetime.strptime(value,'%Y%m%dT%H%M%S');dt=local.replace(tzinfo=ZoneInfo(zone))
   if dt.astimezone(UTC).astimezone(dt.tzinfo).replace(tzinfo=None)!=local:return None
  return int(dt.timestamp()*1000)
 except (ValueError,ZoneInfoNotFoundError,OverflowError):return None

def parse(text,source,now):
 if len(text)>1000000 or '\x00' in text:raise ValueError('Calendar is too large or contains invalid bytes.')
 lines=[]
 for line in text.replace('\r\n','\n').split('\n'):
  if line.startswith((' ','\t')) and lines:lines[-1]+=line[1:]
  else:lines.append(line)
 if not lines or lines[0].strip()!='BEGIN:VCALENDAR' or 'END:VCALENDAR' not in lines:raise ValueError('Invalid iCalendar envelope.')
 events=[];current=None;depth=0
 for line in lines:
  if line=='BEGIN:VEVENT':
   if current is not None:raise ValueError('Nested calendar events are unsupported.')
   current={};depth=0;continue
  if line=='END:VEVENT':
   if current is not None:events.append(current)
   current=None
   if len(events)>5000:raise ValueError('Calendar exceeds 5000 events.')
   continue
  if current is None:continue
  if line.startswith('BEGIN:'):depth+=1;continue
  if line.startswith('END:'):depth=max(0,depth-1);continue
  if depth or ':' not in line:continue
  key,value=line.split(':',1);parts=key.split(';');params={}
  for p in parts[1:]:
   if '=' in p:k,v=p.split('=',1);params[k.upper()]=v.strip('"')
  key=parts[0].upper()
  if key not in current:current[key]=(params,value)
 if current is not None:raise ValueError('Calendar contains an unfinished event.')
 rows=[];unsupported=0
 for e in events:
  if any(k in e for k in ('RRULE','RDATE','EXDATE','RECURRENCE-ID')):unsupported+=1;continue
  start=timestamp(e.get('DTSTART',({},'')),source.get('timeZone'));end=timestamp(e.get('DTEND',({},'')),source.get('timeZone'))
  title=unescape(e.get('SUMMARY',({},''))[1])[:300];uid=e.get('UID',({},''))[1]
  if not uid or not title or start is None or end is None or end<=start:unsupported+=1;continue
  if end<=now or start>now+90*86400000:continue
  status=e.get('STATUS',({},'CONFIRMED'))[1].upper();location=unescape(e.get('LOCATION',({},''))[1])[:500]
  rows.append(dict(id=hashlib.sha256((source['id']+'|calendar|'+uid).encode()).hexdigest(),sourceId=source['id'],title=title,publishedAt=timestamp(e.get('DTSTAMP',({},'')),source.get('timeZone')),receivedAt=now,expiresAt=end,startsAt=start,endsAt=end,eventStatus='cancelled' if status=='CANCELLED' else 'tentative' if status=='TENTATIVE' else 'listed',locationText=location,placeId=source.get('placeId') if source.get('calendarVenueConfirmed') else None,sourceUrl=source['url'],scope='publisher_claim',confidence='unverified',versionKey=hashlib.sha256((title+str(start)+str(end)+status+location).encode()).hexdigest()[:16],type='calendar_event',tags=source.get('tags',[])))
 source['warning']=f'{unsupported} calendar entries skipped: recurrence, missing timezone or unsupported times.' if unsupported else ''
 return rows


def validate_dates(row):
 """Validate optional date bounds on the existing recurring commitments."""
 if not isinstance(row,dict):raise ValueError('A calendar entry must be an object.')
 for key in ('startsOn','endsOn'):
  if key not in row or row[key]=='':continue
  value=row[key]
  if not isinstance(value,str):raise ValueError('Use YYYY-MM-DD calendar dates.')
  try:valid=datetime.date.fromisoformat(value).isoformat()==value
  except ValueError:valid=False
  if not valid:raise ValueError('Use valid YYYY-MM-DD calendar dates.')
 if row.get('startsOn') and row.get('endsOn') and row['endsOn']<row['startsOn']:raise ValueError('A commitment cannot end before its start date.')
 breaks=row.get('breaks',[])
 if not isinstance(breaks,list) or len(breaks)>30:raise ValueError('Use up to thirty calendar breaks.')
 for item in breaks:
  if not isinstance(item,dict) or set(item)!={'label','startsOn','endsOn'} or not isinstance(item['label'],str) or not 1<=len(item['label'])<=120 or not item['startsOn'] or not item['endsOn']:raise ValueError('Every break needs a label, start date and end date.')
  validate_dates(item)
 if 'calendarSource' in row and (not isinstance(row['calendarSource'],str) or len(row['calendarSource'])>1000):raise ValueError('Use a short calendar source or authoring note.')


def context(state):
 c=state['truth']['companion'];zone=c.get('vh2Travel',{}).get('currentContext',{}).get('timeZone') or c.get('timezone')
 try:tz=ZoneInfo(zone) if zone else datetime.timezone(datetime.timedelta(minutes=c.get('timezoneOffsetMinutes',0)))
 except (ZoneInfoNotFoundError,ValueError,TypeError):tz=UTC;zone='UTC'
 now=datetime.datetime.fromtimestamp(state['simAt']/1000,tz);date=now.date().isoformat()
 result={'localDate':date,'localTime':now.strftime('%H:%M'),'timeZone':zone or str(tz),'commitments':[], 'scope':'Authored calendar. End of a term is not proof of graduation or exam success.'}
 result.update(personal_context(c,now.date()))
 result['ages']=[{'personId':ident,**record} for ident,record in c.get('vh2Calendar',{}).get('ages',{}).items()]
 result['ageScope']='Current ages follow explicit birth dates or a once-inferred year from an established birthday and authored age. Authored setup ages stay unchanged. Fictional month/day placeholders and unknown dates do not infer birth years. Leap-day chronological age changes March 1 in non-leap years; reminder celebrations may be February 28.'
 for row in c.get('lifeProfile',{}).get('weeklySchedule',[]):
  if not row.get('startsOn') and not row.get('endsOn') and not row.get('breaks'):continue
  phase='upcoming' if row.get('startsOn','')>date else 'ended' if row.get('endsOn') and row['endsOn']<date else 'in_term'
  breaks=[b for b in row.get('breaks',[]) if b['endsOn']>=date]
  current=next((b for b in breaks if b['startsOn']<=date),None)
  result['commitments'].append({'id':row['id'],'activity':row.get('activity'),'startsOn':row.get('startsOn'),'endsOn':row.get('endsOn'),'phase':'break' if current and phase=='in_term' else phase,'currentBreak':current,'upcomingBreaks':breaks[:6],'source':row.get('calendarSource','authored')})
 return result
