"""Shared immutable offline map library. Per-life imports retain replayable snapshots."""
import hashlib,json,time
SCHEMA='CREATE TABLE IF NOT EXISTS world_packs(id TEXT PRIMARY KEY,name TEXT NOT NULL,content TEXT NOT NULL,bytes INTEGER NOT NULL,created_at INTEGER NOT NULL)'
def library(service,body=None):
 with service.connect() as db:
  db.execute(SCHEMA)
  if body is not None:
   pack=body.get('pack');name=body.get('name')
   if not isinstance(pack,dict) or pack.get('version')!=1 or not isinstance(pack.get('places'),list) or not 1<=len(pack['places'])<=500 or not isinstance(pack.get('routes'),list) or len(pack['routes'])>5000:raise ValueError('Invalid version 1 world pack.')
   if not isinstance(name,str) or not 1<=len(name)<=160 or not pack.get('license') or not pack.get('source'):raise ValueError('Provide a region name, source and licence.')
   raw=json.dumps(pack,sort_keys=True,separators=(',',':'),ensure_ascii=False);size=len(raw.encode())
   if size>1900000:raise ValueError('Split world packs larger than 1.9 MB into smaller regions.')
   ident=hashlib.sha256(raw.encode()).hexdigest()
   db.execute('INSERT OR IGNORE INTO world_packs VALUES (?,?,?,?,?)',(ident,name,raw,size,service.clock()))
  return {'packs':[{'id':r['id'],'name':r['name'],'bytes':r['bytes'],'installedAt':r['created_at'],'placeCount':len(json.loads(r['content'])['places'])} for r in db.execute('SELECT * FROM world_packs ORDER BY name')]}
def get(db,ident):
 db.execute(SCHEMA)
 row=db.execute('SELECT content FROM world_packs WHERE id=?',(ident,)).fetchone()
 if not row:raise ValueError('Install this region before using it.')
 return json.loads(row['content'])

def detail(service,ident):
 with service.connect() as db:return get(db,ident)
