#!/usr/bin/env python3
"""Current VH creation/chat acceptance gate. Fixture providers only; no paid calls."""
import argparse,json,os,subprocess,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scratch'))
from test_runtime import node_executable

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path,required=True);args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
 node=node_executable(ROOT)
 suites=['vh_creation_journey_browser_audit','vh2_chat_experience_browser_audit','vh_accessibility_browser_audit','vh_page_builder_browser_audit','vh_ai_builder_stress_audit','vh_opening_message_audit','vh_mind_architecture_audit','vh_embodiment_access_audit','vh_cognition_architecture_audit','vh_partial_builder_browser_audit','vh_save_paths_audit','vh_feedback_lifecycle_browser','vh2_budget_browser_audit']
 report={'offline':True,'checks':[],'complete':False}
 for suite in suites:
  started=time.monotonic();log=args.output/(suite+'.log')
  with log.open('w',encoding='utf-8') as output:
   try:code=subprocess.run([node,'scratch/'+suite+'.js'],cwd=ROOT,stdout=output,stderr=subprocess.STDOUT,timeout=180).returncode
   except (subprocess.TimeoutExpired,OSError) as error:output.write(str(error));code=-1
  report['checks'].append({'name':suite,'passed':code==0,'exitCode':code,'seconds':round(time.monotonic()-started,2),'log':str(log.resolve())});report['passed']=all(row['passed'] for row in report['checks'])
  (args.output/'report.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print(('PASS ' if code==0 else 'FAIL ')+suite,flush=True)
 report['complete']=True;(args.output/'report.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');return 0 if report['passed'] else 1
if __name__=='__main__':raise SystemExit(main())
