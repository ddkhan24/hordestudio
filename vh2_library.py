"""Durable media metadata with a bounded working projection and paginated history."""
import json
import vh2_social
SCHEMA='''CREATE TABLE IF NOT EXISTS media_records (
 world_id TEXT NOT NULL REFERENCES worlds(id), kind TEXT NOT NULL, id TEXT NOT NULL,
 position INTEGER NOT NULL, data TEXT NOT NULL,
 PRIMARY KEY(world_id,kind,id), UNIQUE(world_id,kind,position));'''
WINDOW={'photo':50,'post':200}
def index(db,world_id,kind,items):
 position=db.execute('SELECT COALESCE(MAX(position),0) FROM media_records WHERE world_id=? AND kind=?',(world_id,kind)).fetchone()[0]
 for item in items:
  data=json.dumps(item,sort_keys=True,separators=(',',':'),allow_nan=False)
  found=db.execute('SELECT data FROM media_records WHERE world_id=? AND kind=? AND id=?',(world_id,kind,item['id'])).fetchone()
  if found is None:
   position+=1;db.execute('INSERT INTO media_records VALUES (?,?,?,?,?)',(world_id,kind,item['id'],position,data))
  elif found['data']!=data:db.execute('UPDATE media_records SET data=? WHERE world_id=? AND kind=? AND id=?',(data,world_id,kind,item['id']))
def persist(db,world_id,state):
 for kind,items in [('photo',state.get('photos',[])),('post',state.get('social',{}).get('posts',[]))]:
  items=sorted(items,key=lambda p:(p.get('at',p.get('publishedAt',0)),p['id']))
  index(db,world_id,kind,items);recent={p['id'] for p in items[-WINDOW[kind]:]}
  social_active={p['id'] for p in sorted(items,key=vh2_social.activity_at)[-20:]} if kind=='post' else set()
  retained=[p for p in items if p['id'] in recent or kind=='photo' and (p['status']=='submitted' or p['status']=='captured' and (p.get('origin')!='autonomous' or p.get('publicationIntent'))) or kind=='post' and (p['id'] in social_active or p.get('status')=='draft' or vh2_social.pending(p))]
  if kind=='photo' and 'photos' in state:state['photos']=retained
  elif kind=='post' and 'social' in state:state['social']['posts']=retained

def get(db,world_id,kind,ident):
 row=db.execute('SELECT data FROM media_records WHERE world_id=? AND kind=? AND id=?',(world_id,kind,ident)).fetchone()
 return json.loads(row['data']) if row else None

def published(db,world_id,photo_id):
 return bool(db.execute("SELECT 1 FROM media_records WHERE world_id=? AND kind='post' AND json_extract(data,'$.photoId')=?",(world_id,photo_id)).fetchone())

def page(service,world_id,kind,before=0,limit=50):
 if kind not in WINDOW or type(before) is not int or before<0 or type(limit) is not int or not 1<=limit<=200:raise ValueError('Invalid media page.')
 with service.connect() as db:
  db.execute('BEGIN');revision,_=service.read(db,world_id)
  rows=db.execute('SELECT position,data FROM media_records WHERE world_id=? AND kind=? AND (?=0 OR position<?) ORDER BY position DESC LIMIT ?', (world_id,kind,before,before,limit+1)).fetchall()
  more=len(rows)>limit;rows=rows[:limit]
  return {'worldId':world_id,'revision':revision,'kind':kind,'items':[json.loads(r['data']) for r in reversed(rows)],'before':rows[-1]['position'] if more else None}
