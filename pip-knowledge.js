/* Product-only retrieval. No library, chat, persona or timeline data is indexed. */
(() => {
    'use strict';
    const STOP = new Set('a an and are as at be been but by can could did do does for from had has have how i if in into is it its just like me my of on or please running set should that the their them there these they this to up use using was we what when where which who why will with would you your'.split(' '));
    const tokenize = value => String(value).toLowerCase().replace(/\bvh2?\b|\bcompanions?\b/g, 'virtual human').match(/[a-z0-9]+/g)?.filter(word => word.length > 1 && !STOP.has(word)).map(word => word.length > 4 && word.endsWith('ies') ? word.slice(0, -3) + 'y' : word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word) || [];
    let documents = [], frequencies = new Map(), averageLength = 1, signature = '', vectors = null;
    const selfQuestion = question => /\b(?:you|your|pip)\b/i.test(question) && /\b(?:llm|model|provider|running|knowledge|embedding|powered|brain)\b/i.test(question);

    function initialize() {
        const pages = window.HordeHandbook.pages;
        documents = [];
        for (const page of pages) {
            const paragraphs = [page.body, page.example || '', page.table ? JSON.stringify(page.table) : ''].join('\n').split(/\n+/).filter(Boolean);
            let chunk = '', number = 0;
            const push = () => {
                if (!chunk) return;
                documents.push({ id: page.id + ':' + number++, pageId: page.id, title: page.title, ch: page.ch, text: chunk, terms: page.terms.join(' ') });
                chunk = '';
            };
            for (const paragraph of paragraphs) {
                if (chunk.length + paragraph.length > 1500) push();
                chunk += (chunk ? '\n' : '') + paragraph;
            }
            push();
        }
        // This registry is authored product documentation, never live field values.
        for (const entry of window.HordeHelp?.knowledgeEntries?.() || []) {
            documents.push({ id: 'control:' + entry.id, title: 'Control reference: ' + entry.id, ch: 'Interface reference', text: entry.text, terms: entry.id.replace(/-/g, ' ') });
        }
        frequencies = new Map();
        documents.forEach(doc => {
            doc.words = tokenize(doc.title + ' ' + doc.terms + ' ' + doc.text);
            doc.counts = new Map();
            doc.words.forEach(word => doc.counts.set(word, (doc.counts.get(word) || 0) + 1));
            doc.counts.forEach((_, word) => frequencies.set(word, (frequencies.get(word) || 0) + 1));
        });
        averageLength = documents.reduce((sum, doc) => sum + doc.words.length, 0) / documents.length;
        // Content fingerprint invalidates cached vectors after documentation changes.
        let hash = 2166136261;
        for (const character of JSON.stringify(documents.map(doc => [doc.id, doc.ch, doc.title, doc.text]))) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
        signature = window.HordeHandbook.version + ':' + hash.toString(16);
        vectors = null;
    }

    function search(question, limit = 8) {
        if (!documents.length) initialize();
        if (selfQuestion(question)) return documents.filter(doc => doc.pageId && /Pip, customization/.test(doc.title)).slice(0, 2).map(doc => ({ ...doc, score: 20 }));
        const query = [...new Set(tokenize(question))];
        if (query.includes('setup') || query.includes('starter')) query.push('start', 'first', 'starting');
        const vh = /virtual humans?|\bvh2?\b|companion/i.test(question);
        const world = !vh && /\bworlds?\b/i.test(question);
        const ranked = documents.map(doc => {
            let score = 0;
            for (const word of query) {
                const count = doc.counts.get(word) || 0;
                if (!count) continue;
                const idf = Math.log(1 + (documents.length - (frequencies.get(word) || 0) + 0.5) / ((frequencies.get(word) || 0) + 0.5));
                score += idf * count * 2.2 / (count + 1.2 * (0.25 + 0.75 * doc.words.length / averageLength));
                if (tokenize(doc.title + ' ' + doc.terms).includes(word)) score += idf * 1.5;
            }
            if (score && (vh && doc.ch === 'Virtual Humans 2.0' || world && doc.ch === 'Worlds')) score *= 1.4;
            return { ...doc, score };
        }).filter(doc => doc.score > 0).sort((a, b) => b.score - a.score);
        return diversify(ranked, limit);
    }

    function diversify(ranked, limit) {
        const counts = new Map(), result = [];
        for (const doc of ranked) {
            const group = doc.pageId || doc.id;
            if ((counts.get(group) || 0) >= 2) continue;
            counts.set(group, (counts.get(group) || 0) + 1);
            result.push(doc);
            if (result.length >= limit) break;
        }
        return result;
    }

    function validVector(vector) {
        return Array.isArray(vector) && vector.length > 0 && vector.every(value => typeof value === 'number' && Number.isFinite(value)) && vector.some(value => value !== 0);
    }
    function cosine(left, right) {
        if (left.length !== right.length) return 0;
        let dot = 0, a = 0, b = 0;
        for (let i = 0; i < left.length; i++) { dot += left[i] * right[i]; a += left[i] ** 2; b += right[i] ** 2; }
        return a && b ? dot / Math.sqrt(a * b) : 0;
    }
    function restore(cache, provider) {
        if (!cache || cache.signature !== signature || cache.provider !== provider || !Array.isArray(cache.vectors) || cache.vectors.length !== documents.length) return false;
        const size = cache.vectors[0]?.length;
        if (!cache.vectors.every(vector => validVector(vector) && vector.length === size)) return false;
        vectors = cache;
        return true;
    }
    async function build(adapter, signal, progress) {
        const provider = adapter.embeddingIdentity();
        if (!provider) throw new Error('Configure and test an embedding model in Settings → Memory before building the semantic index.');
        const output = [];
        for (let start = 0; start < documents.length; start += 16) {
            if (signal.aborted) throw new DOMException('Index build cancelled', 'AbortError');
            const batch = documents.slice(start, start + 16);
            const result = await adapter.embed(batch.map(doc => doc.ch + ' > ' + doc.title + '\n' + doc.text), signal);
            if (!Array.isArray(result) || result.length !== batch.length || !result.every(validVector)) throw new Error('Embedding provider returned an invalid batch. Previous index was kept.');
            output.push(...result);
            progress(Math.min(start + batch.length, documents.length), documents.length);
        }
        if (signal.aborted) throw new DOMException('Index build cancelled', 'AbortError');
        if (adapter.embeddingIdentity() !== provider || !output.every(vector => vector.length === output[0].length)) throw new Error('Embedding model changed or returned inconsistent dimensions. Rebuild the index.');
        const cache = { signature, provider, vectors: output };
        await adapter.saveIndex(cache);
        vectors = cache;
        return output.length;
    }
    async function retrieve(question, mode, adapter, signal) {
        const lexical = search(question, documents.length);
        if (mode !== 'semantic' || selfQuestion(question)) return { sources: lexical.slice(0, 8), method: 'full-text knowledge retrieval' };
        const provider = adapter.embeddingIdentity();
        if (!vectors || vectors.provider !== provider) return { sources: lexical.slice(0, 8), method: 'full-text knowledge retrieval', notice: 'Semantic index is missing or belongs to a different embedding model. Build it in Assistant settings.' };
        try {
            const response = await adapter.embed([question], signal);
            const query = response[0];
            if (!validVector(query) || query.length !== vectors.vectors[0].length) throw new Error('Query embedding has invalid dimensions. Rebuild the semantic index.');
            const lexicalRanks = new Map(lexical.map((doc, i) => [doc.id, i]));
            const semantic = documents.map((doc, i) => ({ ...doc, similarity: cosine(query, vectors.vectors[i]) })).sort((a, b) => b.similarity - a.similarity);
            const ranked = semantic.map((doc, i) => ({ ...doc, score: 1 / (60 + i) + (lexicalRanks.has(doc.id) ? 1 / (60 + lexicalRanks.get(doc.id)) : 0) })).sort((a, b) => b.score - a.score);
            return { sources: diversify(ranked, 8), method: 'semantic + full-text knowledge retrieval' };
        } catch (error) {
            if (signal.aborted) throw error;
            return { sources: lexical.slice(0, 8), method: 'full-text knowledge retrieval', notice: 'Semantic lookup failed: ' + error.message };
        }
    }
    window.HordePipKnowledge = { initialize, search, retrieve, build, restore, selfQuestion, info: provider => ({ chunks: documents.length, signature, indexed: !!vectors && (!provider || vectors.provider === provider) }), directory: () => window.HordeHandbook.pages.map(p => p.ch + ' > ' + p.title).join('\n') };
})();
