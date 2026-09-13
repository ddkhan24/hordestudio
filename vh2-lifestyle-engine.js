/* Shared cash ledger, procedural closet and persistent local-time context. */
'use strict';
const {random}=require('./vh2-decision-engine');
function ensure(c){
 c.vh2Finance ||= {policy:{enabled:false,incomePerHour:0,dailyIncome:0,dailyExpense:0,workPlaceIds:[]},lastAt:null,nextDue:null,trackedBalance:null,incomeRemainder:0,unpaid:0,ledger:[],sequence:0};
 c.vh2Closet ||= {enabled:false,styles:[],history:[],sequence:0,repetitionPenalty:12};
 return c;
}
function entry(c,at,kind,amount,detail){const r=c.vh2Finance,last=r.ledger.at(-1);if(kind==='earned_income'&&last?.kind===kind&&Math.floor(last.at/3600000)===Math.floor(at/3600000)){last.amountMinor+=Math.round(amount*100);last.balanceMinor=Math.round(c.lifeRuntime.world.balance*100);last.throughAt=at;return;}r.ledger.push({id:`finance:${c.id}:${++r.sequence}`,at,kind,amountMinor:Math.round(amount*100),currency:c.vh2Gifts?.currency||'USD',balanceMinor:Math.round(c.lifeRuntime.world.balance*100),detail});r.ledger=r.ledger.slice(-400);}
function finance(c,at,baseline){ensure(c);const r=c.vh2Finance,w=c.lifeRuntime.world,p=r.policy;if(!p.enabled)return;
 if(r.trackedBalance!==null&&Math.abs(w.balance-r.trackedBalance)>.001)entry(c,at,'life_cashflow',w.balance-r.trackedBalance,'Recorded change from travel, gifts or another life action.');
 const minutes=r.lastAt===null?0:Math.max(0,Math.min(1,(at-r.lastAt)/60000));r.lastAt=at;
 if(r.nextDue===null)r.nextDue=at+86400000;
 if(!w.journey&&p.workPlaceIds.includes(w.placeId)&&baseline.placeId===w.placeId&&baseline.source==='schedule'&&baseline.availability!=='asleep'){
  const cents=r.incomeRemainder+minutes*p.incomePerHour*100/60,whole=Math.floor(cents+1e-8);r.incomeRemainder=cents-whole;
  if(whole){w.balance=Math.round((w.balance+whole/100)*100)/100;entry(c,at,'earned_income',whole/100,'Income for actual time at a configured work place.');}
 }
 if(at>=r.nextDue){const periods=Math.floor((at-r.nextDue)/86400000)+1;r.nextDue+=periods*86400000;
  const income=periods*p.dailyIncome;if(income){w.balance+=income;entry(c,at,'recurring_income',income,'Configured recurring income.');}
  const due=Math.round(periods*p.dailyExpense*100)/100,paid=Math.min(w.balance,due);w.balance=Math.round((w.balance-paid)*100)/100;r.unpaid=Math.round((r.unpaid+due-paid)*100)/100;
  if(due){entry(c,at,'recurring_expense',-paid,`Due ${due.toFixed(2)}; unpaid total ${r.unpaid.toFixed(2)}.`);if(paid<due)c.humanDynamics.stress=Math.min(100,c.humanDynamics.stress+Math.min(10,(due-paid)/Math.max(1,due)*10));}
 }
 r.trackedBalance=w.balance;
}
// Choose a missing garment color once, not once per photograph. Named colors
// and visual references remain authoritative; no additional model call is needed.
const colorWords=/\b(?:black|white|ivory|cream|ecru|beige|tan|camel|brown|chocolate|grey|gray|charcoal|silver|gold|navy|blue|indigo|teal|turquoise|cyan|green|sage|olive|khaki|emerald|mint|red|burgundy|maroon|rust|coral|orange|peach|yellow|mustard|pink|rose|mauve|purple|lavender|lilac|violet|plum|nude|multicolou?red|rainbow|clear|transparent)\b/gi;
function garmentName(c,name,key){
 if(String(name).match(colorWords)||/\b(?:barefoot|denim|jeans|leopard|tortoiseshell)\b/i.test(name))return name;
 const fashion=String(c.lifeProfile?.fashionSense||'');
 // Read only a positive palette clause, not colors in exclusions or anecdotes.
 const clause=fashion.match(/(?:palette|colors?|colours?|neutrals|earth tones|pastels)\s*(?:are|of|include|:|—|-)\s*([^.!?;]+)/i)?.[1]||'';
 let palette=[...new Set((clause.match(colorWords)||[]).map(x=>x.toLowerCase()))];
 if(!palette.length)palette=/pastel/i.test(fashion)?['dusty pink','sage','powder blue','lavender','cream']:['charcoal','navy','sage','burgundy','tan','dusty rose'];
 return palette[Math.floor(random(c.id+'|garment-color|'+key)*palette.length)]+' '+name;
}
function resolveGarmentColor(c,item){
 if(!item.id?.startsWith('closet:')||item.photo||!['top','bottom','dress','underwear','outerwear','shoes'].includes(item.category))return;
 if(c.vh2Assets?.entries?.some(e=>e.role==='garment'&&e.entityId===item.id))return;
 const source=item.name,resolved=garmentName(c,source,item.id).slice(0,160);
 if(source!==resolved){ensure(c);c.vh2Closet.garmentNames||={};c.vh2Closet.garmentNames[item.id]={source,resolved};item.name=resolved;}
}
function prepareCloset(c,at,context){ensure(c);const r=c.vh2Closet;if(!r.enabled||c.lifeProfile.world.closet.mode!=='items')return;
 context=({'free time':'casual','unscheduled time':'casual','relaxing':'home'})[context]||context;
 const styles=r.styles.filter(s=>s.context==='any'||context.includes(s.context));if(!styles.length)return;
 const style=styles[Math.floor(random(c.id+'|closet-style|'+Math.floor(at/86400000)+'|'+context)*styles.length)],items=c.lifeProfile.world.items;
 for(const [category,names] of Object.entries(style.pieces)){
  if(!names.length)continue;const name=names[Math.floor(random(c.id+'|closet-item|'+style.id+'|'+category+'|'+Math.floor(at/86400000))*names.length)];
  if(items.some(i=>(i.name===name||r.garmentNames?.[i.id]?.source===name)&&i.category===category)||items.length>=140)continue;
  const id=`closet:${c.id}:${++r.sequence}`;items.push({id,name,category,tags:[style.context,...style.tags],warmth:style.warmth,photo:'',owned:true,incompatible:[]});
  r.history.push({id,at,kind:'closet_item',summary:`Identified ${name} in the existing ${style.name} wardrobe.`,styleId:style.id});
 }r.history=r.history.slice(-200);
}
function repetition(c,id,at){const r=c.vh2Closet;if(!r?.enabled)return 0;const atWear=r.lastWorn?.[id];return atWear===undefined?0:Math.max(0,1-(at-atWear)/ (4*86400000))*r.repetitionPenalty;}
function wore(c,ids,at){if(!c.vh2Closet?.enabled)return;c.vh2Closet.lastWorn ||= {};for(const id of ids)c.vh2Closet.lastWorn[id]=at;}
module.exports={ensure,entry,finance,prepareCloset,repetition,wore,garmentName,resolveGarmentColor};
