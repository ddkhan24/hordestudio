"""Build a portable world pack from downloaded OSM XML or PBF (PBF requires pyosmium).
No network access. Example: --bbox west,south,east,north --limit 120.
Walking times are estimates at 4.5 km/h, not live routing predictions.
"""
import argparse,heapq,json,math

def distance(a,b):
 lat=math.radians((a[1]+b[1])/2);return math.hypot((a[0]-b[0])*111320*math.cos(lat),(a[1]-b[1])*111320)
def pedestrian_directions(tags):
 # Vehicle one-way restrictions do not prohibit walking against traffic.
 # Explicit pedestrian direction/access restrictions do.
 foot=tags.get('foot','').lower();access=tags.get('access','').lower()
 if foot in ('no','private') or access in ('private','no') and foot not in ('yes','designated','permissive'):return False,False
 direction=tags.get('oneway:foot','').lower()
 forward=direction not in ('-1','reverse') and tags.get('foot:forward') not in ('no','private')
 backward=direction not in ('yes','1','true') and tags.get('foot:backward') not in ('no','private')
 return forward,backward

def walking_routes(selected,nodes,edges,neighbors=12):
 # A directed nearest-neighbour graph can strand a peripheral residence even
 # when its underlying footpaths are bidirectional. Retain proven reverse
 # paths as part of the same edge, rather than inventing return journeys later.
 routes={};neighbor_limit=min(neighbors,max(1,5000//max(1,2*len(selected))))
 reverse_edges={a:{b for b,_ in adjacent} for a,adjacent in edges.items()}
 for place in selected:
  queue=[(0,place['_node'])];dist={};previous={};best={place['_node']:0};targets={q['_node'] for q in selected if q is not place};found=[]
  while queue and len(found)<neighbor_limit:
   length,node=heapq.heappop(queue)
   if node in dist or length>6000:continue
   dist[node]=length
   if node in targets:found.extend((length+place['_access']+q['_access'],q) for q in selected if q is not place and q['_node']==node)
   for n,d in edges.get(node,[]):
    if n not in dist and length+d<best.get(n,float('inf')):best[n]=length+d;previous[n]=node;heapq.heappush(queue,(length+d,n))
  for length,q in sorted(found,key=lambda x:(x[0],x[1]['id']))[:neighbor_limit]:
   node=q['_node'];node_path=[node]
   while node!=place['_node'] and node in previous:node=previous[node];node_path.append(node)
   node_path.reverse();geometry=[place['mapCoordinates']]+[nodes[n] for n in node_path]+[q['mapCoordinates']]
   route={'from':place['id'],'to':q['id'],'mode':'WALK','minutes':round(max(1,length/75),2),'geometry':geometry}
   routes[(route['from'],route['to'])]=route
   if all(a in reverse_edges.get(b,set()) for a,b in zip(node_path,node_path[1:])):
    routes.setdefault((route['to'],route['from']),{**route,'from':route['to'],'to':route['from'],'geometry':list(reversed(geometry))})
 return list(routes.values())

def main():
 p=argparse.ArgumentParser();p.add_argument('input');p.add_argument('output');p.add_argument('--bbox',required=True);p.add_argument('--limit',type=int,default=120);p.add_argument('--source',default='OpenStreetMap / Geofabrik');args=p.parse_args();west,south,east,north=map(float,args.bbox.split(','));nodes={};pois=[];edges={}
 def categories(t):
  if t.get('amenity') in ('cafe','restaurant','fast_food','food_court'):return ['food','leisure']
  if t.get('leisure') in ('fitness_centre','sports_centre','swimming_pool'):return ['exercise','leisure']
  if t.get('leisure') in ('park','garden'):return ['rest','leisure']
  if t.get('amenity') in ('library','community_centre'):return ['leisure','rest']
  return []
 def poi(ident,t,xy):
  caps=categories(t)
  if (caps or t.get('amenity') in ('university','college')) and t.get('name'):pois.append({'id':'osm:'+ident,'label':t['name'],'mapCoordinates':xy,'capabilities':{'capabilities':caps,'hours':[{'days':list(range(7)),'start':0,'end':1440}] if t.get('opening_hours')=='24/7' else None},'sourceTags':{k:t[k] for k in ('amenity','leisure','opening_hours','addr:street','addr:housenumber') if k in t}})
 def add_node(ident,xy,tags):
  if west<=xy[0]<=east and south<=xy[1]<=north:nodes[ident]=xy;poi('node/'+str(ident),tags,xy)
 def add_way(ident,ids,t):
  inside=[nodes[i] for i in ids if i in nodes]
  if not inside:return
  if len(inside)==len(ids):poi('way/'+str(ident),t,[sum(x[0] for x in inside)/len(inside),sum(x[1] for x in inside)/len(inside)])
  if t.get('highway') not in ('footway','pedestrian','path','steps','residential','living_street','service','unclassified','tertiary','secondary','primary'):return
  forward,backward=pedestrian_directions(t)
  if not forward and not backward:return
  # Do not invent walking access alongside major roads without sidewalk evidence.
  if t.get('highway') in ('primary','secondary') and t.get('sidewalk') not in ('yes','both','left','right'):return
  for a,b in zip(ids,ids[1:]):
   if a not in nodes or b not in nodes:continue
   length=distance(nodes[a],nodes[b])
   if forward:edges.setdefault(a,[]).append((b,length))
   if backward:edges.setdefault(b,[]).append((a,length))
 if args.input.lower().endswith('.pbf'):
  import osmium
  class Extract(osmium.SimpleHandler):
   def node(self,n):
    if n.location.valid():add_node(n.id,[n.location.lon,n.location.lat],dict(n.tags))
   def way(self,w):add_way(w.id,[n.ref for n in w.nodes],dict(w.tags))
  Extract().apply_file(args.input)
 else:
  import xml.etree.ElementTree as ET
  # Overpass XML can interleave ways and nodes; two bounded streaming passes
  # preserve references without retaining the complete source document in RAM.
  for wanted in ('node','way'):
   for _,element in ET.iterparse(args.input,events=('end',)):
    if element.tag==wanted:
     tags={t.attrib['k']:t.attrib['v'] for t in element.findall('tag')}
     if wanted=='node':add_node(int(element.attrib['id']),[float(element.attrib['lon']),float(element.attrib['lat'])],tags)
     else:add_way(int(element.attrib['id']),[int(n.attrib['ref']) for n in element.findall('nd')],tags)
    if element.tag in ('node','way','relation'):element.clear()
 graphNodes=list(edges);selected=[];seen=set()
 for place in sorted(pois,key=lambda p:distance(p['mapCoordinates'],[(west+east)/2,(south+north)/2])):
  key=(place['label'].lower(),tuple(round(v,4) for v in place['mapCoordinates']))
  if key in seen:continue
  node=min(graphNodes,key=lambda n:distance(nodes[n],place['mapCoordinates']),default=None)
  # Preserve uncertainty of the short entrance connection instead of treating it as surveyed.
  if node is None or distance(nodes[node],place['mapCoordinates'])>100:continue
  seen.add(key);place['_node']=node;place['_access']=distance(nodes[node],place['mapCoordinates']);selected.append(place)
  if len(selected)>=min(500,args.limit):break
 routes=walking_routes(selected,nodes,edges)
 for place in selected:place.pop('_node');place.pop('_access')
 out={'version':1,'routingVersion':2,'source':args.source+'; walking network with estimated entrance connections and 4.5 km/h walking speed','license':'ODbL 1.0 — © OpenStreetMap contributors; https://www.openstreetmap.org/copyright','bbox':[west,south,east,north],'places':selected,'routes':routes}
 with open(args.output,'w') as f:json.dump(out,f,ensure_ascii=False,separators=(',',':'))
 print(json.dumps({'places':len(selected),'routes':len(routes),'nodes':len(nodes),'output':args.output}))
if __name__=='__main__':main()
