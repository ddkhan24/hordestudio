/* Shipped characters are ordinary editable templates, installed once per library. */
let bundledHumanInstallTask=null;
async function installBundledHumans(){
    if(bundledHumanInstallTask)return bundledHumanInstallTask;
    bundledHumanInstallTask=(async()=>{
        const response=await fetch('assets/bundled/humans.json');if(!response.ok)throw Error('Included character catalog could not be loaded.');
        const catalog=await response.json();if(catalog.version!==1||!Array.isArray(catalog.humans))throw Error('Unsupported included character catalog.');
        state.globalSettings.installedHumanBundles ||= [];
        for(const entry of catalog.humans){
            if(!/^assets\/bundled\/[a-z0-9_/-]+\/character\.json$/.test(entry.path))throw Error('Invalid included character path.');
            const original=state.companions.find(c=>c.id===entry.sourceCompanionId);
            {
                // Only retire identified placeholder bundles. A matching name alone
                // must never remove an authored character; existing lives/chats stay.
                const retired=new Set(entry.retiredBundleIds||[]);
                const duplicates=state.companions.filter(c=>c.id!==original?.id&&retired.has(c.bundledId)&&
                    !(state.companionTimelines?.[c.id]?.sessions||[]).some(t=>t.vh2?.worldId||t.messages?.length)&&!(state.companionThreads?.[c.id]||[]).length);
                for(const duplicate of duplicates){
                    await HordeDB.set('retired-duplicate-human:'+duplicate.id,{companion:safeJsonClone(duplicate),timelines:safeJsonClone(state.companionTimelines?.[duplicate.id]||{}),retiredAt:Date.now(),reason:'Unused duplicate of the existing source character'});
                    deleteCompanion(duplicate.id);
                }
                if(duplicates.length)await saveState();
            }
            const exists=original||state.companions.some(c=>c.bundledId===entry.id||c.id===entry.characterId);
            if(exists||state.globalSettings.installedHumanBundles.includes(entry.id)){
                if(!state.globalSettings.installedHumanBundles.includes(entry.id)){state.globalSettings.installedHumanBundles.push(entry.id);await saveState();}
                continue;
            }
            const file=await fetch(entry.path);if(!file.ok)throw Error('Included character could not be loaded: '+entry.name);
            const raw=await file.json();if(raw._kind!=='character-template')throw Error('Included characters must start fresh conversations.');
            const archive=validateCompanionArchiveData(raw);archive.companion.bundledId=entry.id;
            const previousEditing=state.editingCompanionId;
            const installed=restoreCompanionArchive(archive,Date.now(),entry.characterId);
            state.editingCompanionId=previousEditing;
            state.globalSettings.installedHumanBundles.push(entry.id);await saveState();
        }
        if(state.view==='companions')renderCompanionsGrid();
    })();
    try{return await bundledHumanInstallTask;}catch(error){bundledHumanInstallTask=null;throw error;}
}
