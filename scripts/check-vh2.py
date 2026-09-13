#!/usr/bin/env python3
"""Run the offline VH2 acceptance gates and retain an exact machine-readable report.

Example: python3 scripts/check-vh2.py --browser --output /tmp/vh2-acceptance
Browser checks require HORDE_PLAYWRIGHT_MODULE and permission to launch Chrome.
All service suites use temporary databases; language/image responses are fixtures.
"""
import argparse
import datetime
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scratch'))
from test_runtime import node_executable

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser',action='store_true')
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    args.output.mkdir(parents=True,exist_ok=True)
    try:node=node_executable(ROOT)
    except RuntimeError as error:parser.error(str(error))
    commands=[('runtime_discovery',[sys.executable,'scratch/test_runtime_audit.py']),('engine',[node,'scripts/check-engine.js'])]
    commands.append(('multiweek',[node,'scratch/vh2_multiweek_acceptance.js',str(args.output/'multiweek-results.json')]))
    commands.append(('network_multiweek',[node,'scratch/vh2_network_multiweek_audit.js',str(args.output/'network-multiweek-results.json')]))
    commands.append(('conversations',[sys.executable,'scratch/vh2_conversations_audit.py']))
    commands.append(('saved_gallery',[sys.executable,'scratch/vh_saved_gallery_audit.py']))
    commands.append(('weather_context',[sys.executable,'scratch/vh2_weather_context_audit.py']))
    commands.append(('participant_setup',[sys.executable,'scratch/vh2_participant_setup_audit.py']))
    commands.append(('age',[sys.executable,'scratch/vh2_age_audit.py']))
    commands.append(('world_pack_builder',[sys.executable,'scratch/vh_world_pack_builder_audit.py']))
    commands.append(('institution_setup',[sys.executable,'scratch/vh2_institution_setup_audit.py']))
    commands.append(('geography_service',[sys.executable,'scratch/vh2_geography_service_audit.py']))
    commands.append(('location_overlay',[sys.executable,'scratch/vh2_location_overlay_audit.py']))
    commands.append(('coordinate_edit',[sys.executable,'scratch/vh2_coordinate_edit_audit.py']))
    commands.append(('authored_context',[sys.executable,'scratch/vh2_authored_context_audit.py']))
    commands.append(('authored_profile_contract',[node,'scratch/vh_authored_profile_contract_audit.js']))
    for suite in ('personal_calendar','life_adviser','story_service','complete_builder','compatibility','social_awareness','social_worker','weather','calls','starter_social','foundation','migration','horde_integration','dialogue','conversation_quality','texting','provider','communication','memory','media','transcript','outing_service','social','presence_service','plans_service','agency_service','library','backup','npc_service','population_service','people_service','relationship_lifecycle','gifts','travel_service','ecosystem','workers','lifestyle','extended_travel','reference_studies','calendar','player','history','delivery_gaps','realtime','live_data','expression_matrix','flights','feed_discovery','open_airports','flow_overhaul'):
        commands.append((suite,[sys.executable,'scratch/vh2_'+suite+'_audit.py']))
    if args.browser:
        commands.append(('human_package_browser',[node,'scratch/human_package_browser_audit.js']))
        commands.append(('social_profile_browser',[node,'scratch/vh_social_profile_browser_audit.js']))
        commands.append(('conversations_export_browser',[node,'scratch/vh_conversations_export_browser_audit.js']))
        commands.append(('horde_browser',[node,'scratch/vh2_horde_browser_audit.js']))
        commands.append(('workspace_browser',[node,'scratch/vh_ux_browser_audit.js']))
        commands.append(('master_browser',[node,'scratch/vh_master_ux_audit.js']))
        commands.append(('guided_setup_browser',[node,'scratch/vh_guided_setup_audit.js']))
    report={'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'offline':True,'browserRequested':args.browser,'checks':[],
            'scope':'Implemented mechanisms only; not certification of the complete VH2 roadmap or live model quality.'}
    for name,command in commands:
        started=time.monotonic()
        log=args.output/(name+'.log')
        with log.open('w') as output:
            try:
                result=subprocess.run(command,cwd=ROOT,stdout=output,stderr=subprocess.STDOUT,timeout=600)
                code=result.returncode
            except (subprocess.TimeoutExpired,OSError) as error:
                output.write('\n'+str(error));code=-1
        report['checks'].append({'name':name,'passed':code==0,'exitCode':code,'seconds':round(time.monotonic()-started,2),'log':str(log.resolve())})
        print(('PASS ' if code==0 else 'FAIL ')+name,flush=True)
        report['passed']=all(c['passed'] for c in report['checks'])
        (args.output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    report['complete']=True
    (args.output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    return 0 if report['passed'] else 1

if __name__=='__main__':sys.exit(main())
