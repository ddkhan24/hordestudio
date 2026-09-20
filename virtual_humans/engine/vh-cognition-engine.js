/* Provider-free cognition profile for authored Virtual Humans.
 * The IQ-style anchor is a convenient fictional baseline, not a diagnosis.
 * Specific abilities, learned knowledge and adaptive skills remain independent.
 */
(function(root,factory){
    const engine=factory();
    if(typeof module==='object'&&module.exports)module.exports=engine;
    else root.VHCognitionEngine=engine;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
    'use strict';
    const clamp=(value,min=0,max=100)=>Math.max(min,Math.min(max,Number(value)||0));
    const text=(value,limit=3000)=>String(value||'').trim().slice(0,limit);
    const AXES=Object.freeze({
        abstractReasoning:{label:'Abstract reasoning',hint:'Patterns, novel problems and concepts',factor:1.25},
        verbalReasoning:{label:'Verbal reasoning',hint:'Language, explanation and argument',factor:1},
        quantitativeReasoning:{label:'Quantitative reasoning',hint:'Numbers, measurement and formal logic',factor:1},
        workingMemory:{label:'Working memory',hint:'Holding and manipulating several pieces at once',factor:.9},
        processingSpeed:{label:'Processing speed',hint:'How quickly they take in and respond to information',factor:.8},
        executiveFunction:{label:'Planning & executive control',hint:'Sequencing, inhibition, organization and follow-through',factor:.7},
        practicalReasoning:{label:'Practical reasoning',hint:'Everyday judgment, tools and real-world problem solving',factor:.55},
        socialInference:{label:'Social inference',hint:'Reading implication, context and other minds',factor:.35},
        creativity:{label:'Creativity',hint:'Novel associations, imagination and divergent ideas',factor:.3},
        knowledgeBreadth:{label:'Knowledge breadth',hint:'Amount of learned general information',factor:.5},
        metacognition:{label:'Self-correction',hint:'Noticing uncertainty, checking work and changing approach',factor:.5}
    });
    const DETAILS=Object.freeze({
        expertise:'Expertise and unusually deep knowledge',
        gaps:'Knowledge gaps and unfamiliar domains',
        learning:'Learning style and pace',
        blindSpots:'Recurring reasoning mistakes or blind spots',
        adaptiveSkills:'Everyday adaptive and practical skills'
    });
    function iqLabel(iq){
        const value=clamp(iq,55,160);
        if(value<70)return'Very limited abstract reasoning';
        if(value<85)return'Concrete / slower reasoning';
        if(value<100)return'Everyday reasoning';
        if(value<115)return'Capable';
        if(value<130)return'Very capable';
        if(value<145)return'Gifted';
        return'Exceptional / genius-level';
    }
    function normalizeProfile(raw={}){
        const source=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
        const axes={};
        for(const key of Object.keys(AXES))if(Number.isFinite(Number(source.axes?.[key])))axes[key]=Math.round(clamp(source.axes[key]));
        const details={};for(const key of Object.keys(DETAILS))details[key]=text(source.details?.[key]);
        const authored=source.iq!==undefined||Object.keys(axes).length||Object.values(details).some(Boolean);
        return{version:1,enabled:source.enabled===true||(source.enabled!==false&&!!authored),iq:Math.round(clamp(source.iq==null?100:source.iq,55,160)),axes,details};
    }
    function resolvedAxes(raw){
        const profile=normalizeProfile(raw),delta=profile.iq-100,result={};
        for(const [key,item] of Object.entries(AXES))result[key]=Math.round(clamp(50+delta*item.factor));
        for(const [key,value] of Object.entries(profile.axes))result[key]=Math.round(clamp(value));
        return result;
    }
    const GROUPS=Object.freeze({
        abstractReasoning:['analy','reason','solve','puzzle','chess','strategy','investigat','research','theory','logic','debug'],
        verbalReasoning:['read','writ','essay','language','debate','explain','literature','journal'],
        quantitativeReasoning:['math','budget','account','finance','spreadsheet','statistic','calculate','coding','program'],
        workingMemory:['multitask','complex','rehears','memor','study','exam','learn'],
        executiveFunction:['plan','organiz','prepare','manage','schedule','project','deadline'],
        practicalReasoning:['repair','cook','build','navigate','shop','household','tool'],
        socialInference:['negotiat','mediate','network','interview','persuad','social','conversation'],
        creativity:['paint','draw','design','invent','compose','music','creative','craft','photograph'],
        knowledgeBreadth:['museum','lecture','documentary','trivia','history','science','study','research'],
        metacognition:['review','proofread','revise','reflect','check','practice']
    });
    function demands(goal={}){
        const haystack=`${goal.label||''} ${goal.id||''} ${goal.definitionKey||''} ${goal.reason||''}`.toLowerCase(),matches={};
        for(const [axis,terms] of Object.entries(GROUPS)){const count=terms.reduce((sum,term)=>sum+(haystack.includes(term)?1:0),0);if(count)matches[axis]=Math.min(1.5,.65+count*.25);}
        return matches;
    }
    function activityScore(raw,goal={}){
        const profile=normalizeProfile(raw);if(!profile.enabled)return 0;
        const axes=resolvedAxes(profile),needed=demands(goal),entries=Object.entries(needed);if(!entries.length)return 0;
        const total=entries.reduce((sum,[axis,weight])=>sum+(axes[axis]-50)*weight,0)/entries.reduce((sum,[,weight])=>sum+weight,0);
        return Math.round(clamp(total*.42,-24,24)*100)/100;
    }
    function mechanics(raw){
        const profile=normalizeProfile(raw),axes=resolvedAxes(profile);
        if(!profile.enabled)return{decisionTemperatureMultiplier:1,replyMultiplier:1,planningReliability:50};
        const planning=(axes.abstractReasoning+axes.workingMemory+axes.executiveFunction+axes.metacognition)/4;
        return{decisionTemperatureMultiplier:Math.round(clamp(1.25-planning/200,.72,1.28)*1000)/1000,
            replyMultiplier:Math.round(clamp(1.3-axes.processingSpeed*.006,.7,1.3)*1000)/1000,
            planningReliability:Math.round(planning)};
    }
    function contextSnapshot(raw){const profile=normalizeProfile(raw),axes=resolvedAxes(profile);return{enabled:profile.enabled,iq:profile.iq,label:iqLabel(profile.iq),axes,overrides:Object.keys(profile.axes),details:profile.details,mechanics:mechanics(profile),guardrails:{notDiagnosis:true,knowledgeIsLearned:true,adaptiveFunctionIsSeparate:true,intelligenceDoesNotDefineWorth:true}};}
    function prompt(raw){
        const snapshot=contextSnapshot(raw);if(!snapshot.enabled)return'';
        const details=Object.entries(snapshot.details).filter(([,value])=>value).map(([key,value])=>`${DETAILS[key]}: ${value}`).join('\n');
        return `COGNITION (authored capability profile):\nOverall IQ-style reasoning anchor: ${snapshot.iq} · ${snapshot.label}. This is a fictional authoring control, not a clinical score or diagnosis.\nSpecific abilities: ${Object.entries(snapshot.axes).map(([key,value])=>`${AXES[key].label} ${value}/100`).join('; ')}.\n${details?`${details}\n`:''}Use the specific abilities over the overall anchor whenever they differ. Intelligence changes how this person notices structure, holds information, learns, plans, explains, checks assumptions and makes mistakes. Knowledge must come from authored experience or supplied facts; high reasoning is not omniscience. Low reasoning does not mean childish speech, bad spelling, passivity, cruelty, comic stupidity or lack of adult agency. High reasoning does not mean perfect judgment, emotional maturity, morality, social skill or immunity to bias. Social inference, creativity, practical skill, adaptive functioning and learned expertise are independent. Show cognition through the quality, speed and limits of actual reasoning rather than announcing a score or label.`;
    }
    return{AXES,DETAILS,normalizeProfile,resolvedAxes,iqLabel,demands,activityScore,mechanics,contextSnapshot,prompt};
});
