#!/usr/bin/env python3
"""Verify the shipped character catalog and every referenced local asset."""
import hashlib,json,pathlib,sys
root=pathlib.Path(sys.argv[1]);html=(root/'index.html').read_text()
assert 'bundled-humans.js' in html and (root/'bundled-humans.js').is_file()
for retired in ('ashlyn-reynolds-human.js','jane-harlow-human.js','Ashlyn Reynolds.horde_human'):
 assert retired not in html and not (root/retired).exists(),retired
catalog=json.loads((root/'assets/bundled/humans.json').read_text());assert len(catalog['humans'])==1
for entry in catalog['humans']:
 path=root/entry['path'];a=json.loads(path.read_text());c=a['companion'];assert a['_kind']=='character-template' and c['bundledId']==entry['id']
 assert not a.get('timelines') and not a.get('vh2ServiceArchives')
 inventory=json.loads((path.parent/'inventory.json').read_text())
 for name,info in inventory['files'].items():
  raw=(path.parent/name).read_bytes();assert len(raw)==info['bytes'] and hashlib.sha256(raw).hexdigest()==info['sha256'],name
 def visit(v):
  if isinstance(v,str) and v.startswith('assets/bundled/'):assert (root/v).is_file(),v
  elif isinstance(v,dict):
   for value in v.values():visit(value)
  elif isinstance(v,list):
   for value in v:visit(value)
 visit(c)
 for key,count in [('startingSocialPosts','posts'),('startingGallery','galleryPhotos'),('startingVideoClips','clips'),('startingReferences','references')]:assert len(c[key])==inventory[count]
 print('Verified included',c['name'],{k:inventory[k] for k in ('posts','galleryPhotos','clips','references')})
