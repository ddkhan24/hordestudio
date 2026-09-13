"""Bounded live weather observations for the service-owned current location."""
import concurrent.futures,json,math,urllib.parse
from vh2_feeds import fetch

def location(state):
 c=state['truth']['companion'];present=state['truth']['present'];point=(present.get('position') or {}).get('coordinates')
 if not point:
  place=next((p for p in c['lifeProfile']['places'] if p['id']==present.get('placeId')),None)
  point=place.get('mapCoordinates') if place else None
  # A linked listing with no returned location is unresolved; the character's
  # broad profile location is not evidence of that listing's coordinates.
  homes=[p for p in c['lifeProfile']['places'] if p.get('kind')=='home']
  residence=c.get('vh2Travel',{}).get('residenceId') or (homes[0]['id'] if len(homes)==1 else None)
  if not point and place and place['id']==residence and not place.get('googlePlaceId'):point=[c.get('locationLongitude'),c.get('locationLatitude')]
 if not isinstance(point,list) or len(point)!=2 or any(type(x) not in (int,float) or not math.isfinite(x) for x in point) or abs(point[0])>180 or abs(point[1])>90:return None
 return [round(point[0],3),round(point[1],3)]

def context(state):
 """Expose a weather sample only while it still describes this place and time."""
 environment=state['truth']['companion'].get('lifeRuntime',{}).get('environment')
 if not isinstance(environment,dict) or environment.get('stale'):return None
 temperature=environment.get('temperature')
 if type(temperature) not in (int,float) or not math.isfinite(temperature):return None
 observed=environment.get('observedAt',environment.get('fetchedAt'))
 if type(observed) in (int,float) and math.isfinite(observed):
  if not 0<=state['simAt']-observed<=3600000:return None
 elif environment.get('scope')=='weather_model_observation':return None
 coordinates=environment.get('coordinates')
 if isinstance(coordinates,list):
  point=location(state)
  if not point or len(coordinates)!=2 or any(type(x) not in (int,float) or not math.isfinite(x) for x in coordinates):return None
  longitude,latitude=coordinates;longitude_delta=(point[0]-longitude+540)%360-180
  if 111.2*math.hypot(point[1]-latitude,longitude_delta*math.cos((point[1]+latitude)*math.pi/360))>20:return None
 return environment

def read(point):
 url='https://api.open-meteo.com/v1/forecast?'+urllib.parse.urlencode({'latitude':point[1],'longitude':point[0],'current':'temperature_2m,apparent_temperature,precipitation,weather_code,cloud_cover,wind_speed_10m,is_day','timezone':'UTC','timeformat':'unixtime'})
 raw=json.loads(fetch(url,250000));v=raw.get('current',{})
 def number(key,low,high):
  n=v.get(key)
  if type(n) not in (int,float) or not math.isfinite(n) or not low<=n<=high:raise ValueError('Weather response has invalid '+key)
  return n
 code=number('weather_code',0,99)
 description='Thunderstorm' if code>=95 else 'Snow' if code in (71,73,75,77,85,86) else 'Rain' if code>=51 else 'Fog' if code>=45 else 'Cloudy' if code>=2 else 'Clear'
 return {'temperature':number('temperature_2m',-100,70),'apparentTemperature':number('apparent_temperature',-120,90),'precipitation':number('precipitation',0,1000),'weatherCode':code,'cloudCover':number('cloud_cover',0,100),'windSpeed':number('wind_speed_10m',0,600),'isDay':bool(v.get('is_day')),'description':description,'observedAt':number('time',0,9e12)*1000,'source':'Open-Meteo','coordinates':point,'scope':'weather_model_observation','stale':False}

def poll(service):
 from vh2_runtime import encode
 if not hasattr(service,'_weather_pending'):service._weather_pending={};service._weather_pool=concurrent.futures.ThreadPoolExecutor(max_workers=2)
 for world,(future,point) in list(service._weather_pending.items()):
  if not future.done():continue
  del service._weather_pending[world]
  with service.connect() as db:
   db.execute('BEGIN IMMEDIATE');revision,before=service.read(db,world);after=json.loads(encode(before));c=after['truth']['companion']
   if not c.get('lifeWeatherEnabled') or location(after)!=point or abs(service.clock()-after['simAt'])>300000:continue
   try:
    result=future.result()
    if abs(service.clock()-result['observedAt'])>3600000:raise ValueError('Weather observation is stale.')
    result['fetchedAt']=service.clock();c['lifeRuntime']['environment']=result;after.setdefault('worldData',{})['weatherError']='';event='WEATHER_OBSERVED'
   except Exception as error:
    after.setdefault('worldData',{})['weatherError']=str(error)[:300]
    if c['lifeRuntime'].get('environment'):c['lifeRuntime']['environment']['stale']=True
    event='WEATHER_REFRESH_FAILED'
   service.commit_event(db,world,revision,before,after,event)
 with service.connect() as db:worlds=[r[0] for r in db.execute("SELECT id FROM worlds WHERE json_extract(state,'$.running')=1")]
 for world in worlds:
  if world in service._weather_pending or len(service._weather_pending)>=2:continue
  with service.connect() as db:
   db.execute('BEGIN IMMEDIATE');revision,before=service.read(db,world);c=before['truth']['companion'];point=location(before)
   if before['kernelVersion']!=service.kernel_version or not c.get('lifeWeatherEnabled') or not point or abs(service.clock()-before['simAt'])>300000:continue
   if before.get('worldData',{}).get('weatherAttemptPoint')==point and service.clock()-before.get('worldData',{}).get('weatherAttemptAt',0)<1800000:continue
   after=json.loads(encode(before));after.setdefault('worldData',{}).update(weatherAttemptAt=service.clock(),weatherAttemptPoint=point)
   service.commit_event(db,world,revision,before,after,'WEATHER_REFRESH_REQUESTED')
   service._weather_pending[world]=(service._weather_pool.submit(getattr(service,'weather_executor',read),point),point)
