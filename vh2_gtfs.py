"""Bounded GTFS Schedule adapter: explicit stops, calendars and timezone-aware services."""
import csv,io,zipfile,datetime,hashlib
from zoneinfo import ZoneInfo

def parse(raw,source,now):
 if not isinstance(raw,bytes) or len(raw)>20000000:raise ValueError('GTFS archive exceeds 20 MB.')
 try:z=zipfile.ZipFile(io.BytesIO(raw))
 except zipfile.BadZipFile:raise ValueError('Invalid GTFS ZIP.') from None
 with z:
  infos=z.infolist()
  if sum(x.file_size for x in infos)>100000000 or len(infos)>100:raise ValueError('GTFS expanded archive exceeds limits.')
  if len({x.filename for x in infos})!=len(infos):raise ValueError('GTFS contains duplicate files.')
  def rows(name):
   if name not in z.namelist():return []
   data=list(csv.DictReader(io.StringIO(z.read(name).decode('utf-8-sig'))))
   if len(data)>500000:raise ValueError('GTFS table exceeds row limit.')
   return data
  agencies=rows('agency.txt');zones={a.get('agency_timezone') for a in agencies}
  if len(zones)!=1 or not next(iter(zones),None):raise ValueError('GTFS must identify one agency timezone; split multi-timezone feeds.')
  zone=ZoneInfo(next(iter(zones)));routes={r['route_id']:r for r in rows('routes.txt')};trips=rows('trips.txt');calendar=rows('calendar.txt');exceptions=rows('calendar_dates.txt');frequency={r['trip_id'] for r in rows('frequencies.txt')}
  mapping=source.get('stopMappings',{});times={}
  for row in rows('stop_times.txt'):
   if row.get('stop_id') in mapping:times.setdefault(row['trip_id'],[]).append(row)
  services=[];day=datetime.datetime.fromtimestamp(now/1000,zone).date();skipped=0
  def seconds(value):
   pieces=value.split(':')
   if len(pieces)!=3:raise ValueError()
   h,m,s=map(int,pieces)
   if not 0<=h<=71 or not 0<=m<60 or not 0<=s<60:raise ValueError()
   return h*3600+m*60+s
  for offset in (-1,0,1,2):
   date=day+datetime.timedelta(days=offset);key=date.strftime('%Y%m%d');weekday=date.strftime('%A').lower()
   active={c['service_id'] for c in calendar if c.get('start_date','')<=key<=c.get('end_date','') and c.get(weekday)=='1'}
   for ex in exceptions:
    if ex.get('date')==key:
     if ex.get('exception_type')=='1':active.add(ex['service_id'])
     elif ex.get('exception_type')=='2':active.discard(ex['service_id'])
   # GTFS service-day times are measured from local noon minus twelve hours.
   start=int(datetime.datetime.combine(date,datetime.time(12),zone).timestamp()*1000)-12*3600000
   for trip in trips:
    if trip.get('service_id') not in active:continue
    if trip['trip_id'] in frequency:skipped+=1;continue
    route=routes.get(trip.get('route_id'),{});kind={'0':'train','1':'train','2':'train','3':'bus','4':'ferry'}.get(route.get('route_type'))
    if not kind:continue
    stops=sorted(times.get(trip['trip_id'],[]),key=lambda s:int(s['stop_sequence']))
    for index,a in enumerate(stops):
     if a.get('pickup_type','0')=='1':continue
     for b in stops[index+1:]:
      if b.get('drop_off_type','0')=='1' or mapping[a['stop_id']]==mapping[b['stop_id']]:continue
      try:dep=start+seconds(a['departure_time'])*1000;arr=start+seconds(b['arrival_time'])*1000
      except (ValueError,KeyError):skipped+=1;continue
      if dep<now or not dep<arr or arr-dep>72*3600000:continue
      ident='gtfs:'+hashlib.sha256((source['id']+key+trip['trip_id']+a['stop_sequence']+':'+b['stop_sequence']).encode()).hexdigest()[:40]
      services.append({'id':ident,'label':route.get('route_short_name') or route.get('route_long_name') or trip['trip_id'],'kind':kind,'from':mapping[a['stop_id']],'to':mapping[b['stop_id']],'departsAt':dep,'arrivesAt':arr,'boardingMinutes':source.get('boardingMinutes',2),'cost':source.get('fare',0),'source':'GTFS '+source['url'],'sourceId':source['id'],'sourceTripId':trip['trip_id'],'departureStopSequence':int(a['stop_sequence']),'arrivalStopSequence':int(b['stop_sequence']),'serviceDate':key,'status':'scheduled','updatedAt':now,'fareSource':'authored_estimate'})
      if len(services)>450:raise ValueError('GTFS mapping produces over 450 departures. Narrow the stop mapping.')
  source['warning']=(f'{skipped} frequency-based or incomplete entries skipped. ' if skipped else '')+'Scheduled timetable, not realtime. Fares are configured estimates.'
  return services
