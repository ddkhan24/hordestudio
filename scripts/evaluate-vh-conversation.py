#!/usr/bin/env python3
"""Build a blinded transcript review from supplied outputs; never calls providers.

Input: JSON array with id, context (conversation, readyMessageIds, evidence),
reviewFor, candidates {variant: visible reply}. Default candidates are authored
fixtures, not model performance. Human ratings are intentionally not fabricated.
"""
import argparse,json,random,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import vh2_conversation as engine

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--input',type=Path,default=Path(__file__).resolve().parents[1]/'scratch/fixtures/vh2/conversation-quality.json');p.add_argument('--output',type=Path,required=True);args=p.parse_args()
 cases=json.loads(args.input.read_text());args.output.mkdir(parents=True,exist_ok=True)
 report=[];review=['# Blinded conversation review','', 'Offline supplied outputs only. No provider was called. Default candidates are authored fixtures, not a measured model improvement.','', 'For each candidate rate relevance, memory grounding, appropriate familiarity, repetition and appropriate length from 1–5. Then choose a preference or tie. These ratings require a human reviewer.','']
 rng=random.Random(42)
 for case in cases:
  ctx=case['context'];ctx['conversationBrief']=engine.brief(ctx);variants=list(case['candidates'].items());rng.shuffle(variants);results=[]
  review+=['## '+case['id'],'',case.get('reviewFor',''),'','```json',json.dumps(ctx,ensure_ascii=False,indent=2),'```','']
  for index,(variant,text) in enumerate(variants):
   label=chr(65+index);results.append({'label':label,'variant':variant,'diagnostics':engine.quality_flags(ctx,text)})
   review+=['### Candidate '+label,'','> '+text.replace('\n','\n> '),'','Ratings: __ / __ / __ / __ / __','']
  review+=['Preference: __   Notes: __',''];report.append({'id':case['id'],'candidates':results})
 (args.output/'review.md').write_text('\n'.join(review));(args.output/'diagnostics-and-key.json').write_text(json.dumps({'liveCalls':0,'humanRatings':None,'cases':report},indent=2))
 print(f'Prepared {len(cases)} blinded exchanges; human quality remains unrated.')
if __name__=='__main__':main()
