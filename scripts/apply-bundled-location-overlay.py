#!/usr/bin/env python3
"""Apply bounded location text to existing stable IDs, never geometry or media.

Import apply_overlay(companion, overlay) from the bundle builder, or use the CLI
to write a separate preview. --projection prepares an unexecuted service command.
No network, provider, production database or server access occurs here.
"""
import argparse
import copy
import hashlib
import json
import math
from pathlib import Path

FORMAT='horde-bundled-location-overlay'
PLACE_FIELDS={'label':160,'detail':500,'referenceDescription':1500,'referenceAliases':500,'googlePlaceId':300}
ROOM_FIELDS={'label':120,'description':2000}
AUTHORED_FIELDS={'socialWorld','backstory','description','routine','habits','privateLife','relationshipContext'}


def validate(overlay):
    allowed={'format','version','characterName','places','rooms','authoredTextReplacements','referenceReplacementPlan','notes'}
    if not isinstance(overlay,dict) or set(overlay)-allowed or overlay.get('format')!=FORMAT or overlay.get('version')!=1:
        raise ValueError('Unsupported location overlay format.')
    if not isinstance(overlay.get('characterName'),str) or not overlay['characterName'].strip():raise ValueError('A character name is required.')
    for section,limits in (('places',PLACE_FIELDS),('rooms',ROOM_FIELDS)):
        rows=overlay.get(section,[])
        if not isinstance(rows,list) or len(rows)>100:raise ValueError('Invalid '+section+' list.')
        seen=set()
        for row in rows:
            permitted={'id','set','provenance'}|({'placeId'} if section=='rooms' else set())
            if not isinstance(row,dict) or set(row)-permitted or not isinstance(row.get('id'),str) or not row['id'] or row['id'] in seen:raise ValueError('Every overlay row needs a unique stable ID.')
            seen.add(row['id'])
            patch=row.get('set')
            if not isinstance(patch,dict) or not patch or set(patch)-set(limits):raise ValueError('Only supported location text fields may be changed.')
            if 'googlePlaceId' in patch and patch['googlePlaceId']!='':raise ValueError('An overlay may clear an inaccurate provider ID; adding one requires separately verified geography.')
            for key,value in patch.items():
                if not isinstance(value,str) or len(value)>limits[key] or (key in ('label','description','detail') and not value.strip()):raise ValueError('Invalid or overlong '+section+'.'+key)
            provenance=row.get('provenance',{})
            if not isinstance(provenance,dict) or set(provenance)-{'kind','sources','note'}:raise ValueError('Invalid provenance.')
            if provenance.get('kind') not in ('fictional','public_place_inspired'):raise ValueError('Reference scope must be explicit.')
            if not isinstance(provenance.get('note'),str) or len(provenance['note'])>2000:raise ValueError('Invalid provenance note.')
            urls=provenance.get('sources',[])
            if not isinstance(urls,list) or len(urls)>8 or any(not isinstance(u,str) or not u.startswith('https://') or len(u)>2000 for u in urls):raise ValueError('Use bounded HTTPS source references.')
    for replacement in overlay.get('authoredTextReplacements',[]):
        if not isinstance(replacement,dict) or set(replacement)!={'field','old','new'} or replacement['field'] not in AUTHORED_FIELDS:
            raise ValueError('Only named authored-text replacements are supported.')
        if any(not isinstance(replacement[k],str) or not replacement[k] or len(replacement[k])>2000 for k in ('old','new')):
            raise ValueError('Invalid exact text replacement.')


def apply_overlay(companion,overlay):
    validate(overlay)
    if companion.get('name')!=overlay['characterName']:raise ValueError('The overlay belongs to another character.')
    result=copy.deepcopy(companion)
    rooms=result.get('vh2Visual',{}).get('zones')
    if rooms is None:rooms=result.get('lifeSetupPolicies',{}).get('rooms',[])
    collections={'places':result.get('lifeProfile',{}).get('places',[]),'rooms':rooms}
    changes=[]
    for section,targets in collections.items():
        indices={r['id']:r for r in targets}
        if len(indices)!=len(targets):raise ValueError('Existing '+section+' contains duplicate IDs.')
        for patch in overlay.get(section,[]):
            row=indices.get(patch['id'])
            if row is None:raise ValueError('Missing stable '+section+' ID: '+patch['id'])
            if section=='rooms' and row.get('placeId')!=patch.get('placeId'):raise ValueError('A room overlay cannot change its place link.')
            for key,value in patch['set'].items():
                if row.get(key)!=value:
                    changes.append({'section':section,'id':row['id'],'field':key,'before':row.get(key),'after':value})
                    row[key]=value
    for patch in overlay.get('authoredTextReplacements',[]):
        value=result.get(patch['field'],'')
        if not isinstance(value,str):raise ValueError('Authored text field is not text.')
        if patch['old'] not in value:
            if patch['new'] in value:continue # Idempotent regeneration.
            raise ValueError('Authored text changed; review the '+patch['field']+' replacement.')
        if value.count(patch['old'])!=1:raise ValueError('Ambiguous authored text replacement.')
        revised=value.replace(patch['old'],patch['new'],1)
        if len(revised)>4000:raise ValueError('Authored text exceeds supported length after replacement.')
        result[patch['field']]=revised
        changes.append({'section':'authored','field':patch['field'],'before':value,'after':revised})
    report={'format':FORMAT,'version':1,'changedFields':len(changes),'changes':changes,
        'preserved':['entity IDs','room-place links','map coordinates','routes','media','personality','relationships','life state'],
        'provenance':{section:{row['id']:row['provenance'] for row in overlay.get(section,[])} for section in ('places','rooms')}}
    return result,report


def prepare_command(projection,overlay,authored_template=None):
    """A revision-fenced payload; caller must refresh it if the life has advanced."""
    state=projection['state'];c=copy.deepcopy(state['truth']['companion']);restored=[]
    if state.get('mergedInto'):raise ValueError('Select the canonical life, not a merged archive.')
    if authored_template is not None:
        validate(overlay)
        if authored_template.get('name')!=c.get('name'):raise ValueError('The authored fallback belongs to another character.')
        for row in overlay.get('authoredTextReplacements',[]):
            field=row['field']
            if field not in c:
                if not isinstance(authored_template.get(field),str):raise ValueError('The authored fallback lacks '+field+'.')
                c[field]=authored_template[field];restored.append(field)
    patched,report=apply_overlay(c,overlay)
    for field in restored:
        existing=next((r for r in report['changes'] if r.get('section')=='authored' and r.get('field')==field),None)
        if existing:existing['before']=None;existing['source']='explicit authored template fallback'
        else:report['changes'].append({'section':'authored','field':field,'before':None,'after':patched[field],'source':'explicit authored template fallback'})
    report['changedFields']=len(report['changes']);report['restoredMissingAuthoredFields']=restored
    if overlay.get('rooms') and c.get('lifeRuntime',{}).get('world',{}).get('journey'):
        raise ValueError('The existing authoring command requires the current journey to finish. Do not override it.')
    old_places={p['id']:p for p in c.get('lifeProfile',{}).get('places',[])}
    def known_coordinates(row):
        v=row.get('mapCoordinates')
        return isinstance(v,list) and len(v)==2 and all(type(n) in (int,float) and math.isfinite(n) for n in v) and abs(v[0])<=180 and abs(v[1])<=90
    changed_endpoints={row['id'] for row in overlay.get('places',[]) if 'googlePlaceId' in row['set'] and old_places[row['id']].get('googlePlaceId')!=row['set']['googlePlaceId'] and not known_coordinates(old_places[row['id']])}
    journey=c.get('lifeRuntime',{}).get('world',{}).get('journey') or {}
    if any(journey.get(side) in changed_endpoints for side in ('from','to')):
        raise ValueError('The current route endpoint lacks coordinate proof. Wait for arrival before clearing its provider identity.')
    for actor in c.get('vh2People',{}).get('actors',{}).values():
        journey=actor.get('journey') or {}
        if any(journey.get(side) in changed_endpoints for side in ('from','to')):
            raise ValueError('A supporting person is travelling to or from a corrected endpoint. Wait for arrival; do not override the route safeguard.')
    proposal={'places':[{'id':row['id'],**row['set']} for row in overlay.get('places',[])],
        'rooms':[{'id':row['id'],'placeId':row['placeId'],**row['set']} for row in overlay.get('rooms',[])]}
    fields={row['field']:patched[row['field']] for row in overlay.get('authoredTextReplacements',[])}
    if fields:proposal['expression']=fields
    report['liveCommandEffects']=['Requires a fresh expectedRevision and baseSetupVersion.','Uses the existing atomic authoring command, with replay and history retained.','Clearing a provider Place ID preserves routes and weather when established coordinates remain identical. Unknown endpoints retain the existing route-invalidation safeguard.','Room revisions advance; historical captures keep their original reference revisions.']
    digest=hashlib.sha256(json.dumps(proposal,sort_keys=True).encode()).hexdigest()[:20]
    return {'schemaVersion':1,'key':'location-overlay:'+projection['worldId']+':'+str(projection['revision'])+':'+digest,
        'worldId':projection['worldId'],'expectedRevision':projection['revision'],'type':'apply_life_proposal','version':2,
        'baseSetupVersion':c.get('vh2SetupVersion',0),'proposal':proposal},report


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input',type=Path)
    parser.add_argument('overlay',type=Path)
    parser.add_argument('output',type=Path)
    parser.add_argument('--report',type=Path)
    parser.add_argument('--projection',action='store_true',help='Prepare one unexecuted live-service command from a projection JSON.')
    parser.add_argument('--authored-template',type=Path,help='Explicit fallback for an absent authored field in a projection; existing fields are never replaced from this source.')
    args=parser.parse_args()
    original=json.loads(args.input.read_text());overlay=json.loads(args.overlay.read_text())
    if args.authored_template and not args.projection:parser.error('--authored-template requires --projection')
    fallback=json.loads(args.authored_template.read_text()) if args.authored_template else None
    if isinstance(fallback,dict) and 'companion' in fallback:fallback=fallback['companion']
    if args.projection:result,report=prepare_command(original,overlay,fallback)
    else:
        if 'companion' in original:
            result=copy.deepcopy(original);result['companion'],report=apply_overlay(original['companion'],overlay)
        else:result,report=apply_overlay(original,overlay)
    args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    if args.report:args.report.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'output':str(args.output),'changedFields':report['changedFields'],'executedLiveCommand':False}))


if __name__=='__main__':main()
