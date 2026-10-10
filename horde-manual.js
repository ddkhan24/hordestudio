/* Offline illustrated manual: content is shared with Pip's retrieval. */
(() => {
    'use strict';
    const pages = window.HordeHandbook.pages;
    const $ = id => document.getElementById(id);
    let selected = pages[0].id;
    const el = (tag, text, cls) => { const node=document.createElement(tag); if(text!==undefined)node.textContent=text; if(cls)node.className=cls; return node; };
    function paragraph(text) {
        const node=el('p'); let cursor=0;
        for (const match of text.matchAll(/https?:\/\/[^\s<>]+/g)) {
            node.append(document.createTextNode(text.slice(cursor,match.index)));
            const link=el('a',match[0]); link.href=match[0]; link.target='_blank'; link.rel='noopener noreferrer'; node.append(link); cursor=match.index+match[0].length;
        }
        node.append(document.createTextNode(text.slice(cursor))); return node;
    }
    const diagrams = {
        'person-life':['Author identity','Choose models','Create starter life','Start life','Chat & review live state'],
        'hosting':['Local browser','Local life service','Recovery backup','Optional private server'],
        'world-flow':['Author World','Locations & routes','Starting Life','Save & enter','Canonical play'],
        'multiplayer':['Host creates session','Share invite','Guests join','Submit actions','Host commits round']
    };
    function open(id, update=true) {
        const page=pages.find(p=>p.id===id)||pages[0]; selected=page.id;
        const article=$('manual-article'); article.replaceChildren();
        article.append(el('p',page.ch,'manual-kicker'),el('h1',page.title));
        for(const text of page.body.split('\n').filter(Boolean)) article.append(paragraph(text));
        if(page.diagram){ const flow=el('ol',undefined,'manual-flow'); for(const label of diagrams[page.diagram]||[])flow.append(el('li',label)); article.append(flow); }
        if(page.example){ const box=el('aside',undefined,'manual-example'); box.append(el('h2','Worked example'),el('pre',page.example.replace(/\\n/g,'\n'))); article.append(box); }
        if(page.table){const wrap=el('div',undefined,'manual-table-wrap'),table=el('table'); page.table.forEach((row,i)=>{const tr=el('tr');row.forEach(value=>tr.append(el(i?'td':'th',value)));table.append(tr);}); wrap.append(table);article.append(wrap);}
        if(page.image){const figure=el('figure'),button=el('button',undefined,'manual-image-button');button.type='button';button.setAttribute('aria-label','Enlarge screenshot: '+page.title);const image=el('img');image.src=page.image;image.alt='Horde Studio screenshot — '+page.title;image.loading='lazy';button.append(image);button.onclick=()=>{const dialog=$('manual-image-dialog');$('manual-large-image').src=page.image;$('manual-large-image').alt=image.alt;dialog.showModal();};figure.append(button,el('figcaption','Real application screenshot · '+page.title+' · Click to enlarge'));article.append(figure);}
        const footer=el('div',undefined,'manual-pager'),index=pages.indexOf(page);
        for(const [label,target] of [['← Previous',pages[index-1]],['Next →',pages[index+1]]])if(target){const b=el('button',label,'btn btn-ghost');b.onclick=()=>open(target.id);footer.append(b);}
        const ask=el('button','Ask Pip about this topic','btn btn-primary');ask.onclick=()=>{window.HordePip?.askTopic(page.title);};footer.append(ask);article.append(footer);
        article.scrollTop=0; $('manual-content').scrollTop=0;
        if(update && location.hash!=='#manual/'+page.id)history.pushState(null,'','#manual/'+page.id);
        $('manual-toc').querySelectorAll('[data-topic]').forEach(b=>{b.classList.toggle('selected',b.dataset.topic===selected);if(b.dataset.topic===selected)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
    }
    function search(){const query=$('manual-search').value.trim().toLowerCase();const tokens=query.split(/\s+/).filter(Boolean);const matches=pages.filter(p=>tokens.every(t=>JSON.stringify([p.ch,p.title,p.body,p.terms,p.table,p.example]).toLowerCase().includes(t)));const toc=$('manual-toc');toc.replaceChildren();let chapter='';for(const p of matches){if(chapter!==p.ch){chapter=p.ch;toc.append(el('h3',chapter));}const button=el('button',p.title);button.type='button';button.dataset.topic=p.id;button.classList.toggle('selected',p.id===selected);button.onclick=()=>open(p.id);toc.append(button);} $('manual-search-count').textContent=matches.length+' topics'+(query?' match':'');if(!matches.length)toc.append(el('p','No match. Try fewer words, or browse the index.'));}
    function index(){const dialog=$('manual-index-dialog'),list=$('manual-index-list');list.replaceChildren();const terms=new Map();for(const p of pages)for(const term of p.terms){if(!terms.has(term))terms.set(term,[]);terms.get(term).push(p);}for(const [term,topics] of [...terms].sort((a,b)=>a[0].localeCompare(b[0]))){const row=el('div');row.append(el('strong',term+': '));for(const p of topics){const b=el('button',p.title);b.onclick=()=>{dialog.close();open(p.id);};row.append(b);}list.append(row);}dialog.showModal();}
    function print(){const output=$('manual-print');output.replaceChildren();for(const p of pages){const section=el('section');section.append(el('p',p.ch),el('h1',p.title));p.body.split('\n').forEach(t=>section.append(el('p',t)));if(p.example)section.append(el('pre',p.example.replace(/\\n/g,'\n')));if(p.table){const table=el('table');p.table.forEach((r,i)=>{const tr=el('tr');r.forEach(t=>tr.append(el(i?'td':'th',t)));table.append(tr);});section.append(table);}if(p.image){const img=el('img');img.src=p.image;section.append(img);}output.append(section);}Promise.all([...output.querySelectorAll('img')].map(i=>i.decode().catch(()=>{}))).then(()=>window.print());}
    function mount(){search();open(selected,false);$('manual-search').oninput=search;$('manual-index-btn').onclick=index;$('manual-print-btn').onclick=print;document.querySelectorAll('[data-close-manual-dialog]').forEach(b=>b.onclick=()=>b.closest('dialog').close());window.addEventListener('popstate',route);window.addEventListener('hashchange',route);route();}
    function route(){if(location.hash.startsWith('#manual/')){window.HordeManualNavigate?.();let id; try { id=decodeURIComponent(location.hash.slice(8)); } catch { id=pages[0].id; } open(id,false);}}
    window.HordeManual={mount,open:id=>{window.HordeManualNavigate?.();open(id);},route};
})();
