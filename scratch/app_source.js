/**
 * Shared source-extraction toolkit for the audit suites.
 *
 * THE PROBLEM THIS SOLVES
 *
 * There is no build step and no module system in app.js, so a suite cannot
 * import the function it wants to test. Instead each suite lifts the function's
 * SOURCE TEXT out of app.js and evaluates it inside a vm context. That works,
 * but every suite had to hand-list every name it pulled in — and a lifted
 * function whose callee was not on that list throws "X is not defined" the
 * first time a test walks that branch.
 *
 * So adding one line to a normal engine function broke two unrelated suites,
 * three features running. The failure was never a real defect; it was the
 * extractor being told an incomplete list.
 *
 * THE FIX
 *
 * Ask for what you actually want to test, and let the extractor follow the
 * calls. resolveDependencies scans each lifted function for identifiers,
 * matches them against the top-level declarations in app.js, and repeats until
 * the set closes. The emitted program is a SUBSEQUENCE OF app.js IN SOURCE
 * ORDER, so anything that worked in the real file works here for the same
 * reason and in the same order.
 *
 * Two things are deliberately never followed:
 *   - a name the suite has already stubbed on its context (stubs must win, or
 *     a suite could not isolate anything)
 *   - a declaration whose initializer runs code we cannot vouch for (anything
 *     touching the DOM, storage, or app state at load time)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '..', 'vh-simulation-core.js'), 'utf8') + '\n'
    + fs.readFileSync(path.join(__dirname, '..', 'vh-life-schema.js'), 'utf8') + '\n'
    + fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

/**
 * Find the span from startIndex to the close of the first openChar at or after
 * searchFrom. Lexer-aware: strings, template literals, comments and regex
 * literals do not count toward nesting, because an apostrophe in a comment
 * used to be enough to break this.
 */
// Index of the backtick closing the template that opens at `start`, handling
// `${ … }` interpolations and templates nested inside them.
function matchTemplateEnd(start) {
    let depth = 0;
    for (let i = start + 1; i < app.length; i++) {
        if (app[i] === '\\') { i++; continue; }
        if (!depth) {
            if (app[i] === '$' && app[i + 1] === '{') { depth = 1; i++; continue; }
            if (app[i] === '`') return i;
            continue;
        }
        const next = app[i + 1];
        if (app[i] === '/' && next === '/') { i = app.indexOf('\n', i); if (i < 0) break; continue; }
        if (app[i] === '/' && next === '*') { i = app.indexOf('*/', i + 2) + 1; continue; }
        if (app[i] === '"' || app[i] === "'") {
            const quote = app[i];
            for (i++; i < app.length; i++) {
                if (app[i] === '\\') { i++; continue; }
                if (app[i] === quote) break;
            }
            continue;
        }
        if (app[i] === '`') { i = matchTemplateEnd(i); continue; }
        if (app[i] === '{') depth++;
        else if (app[i] === '}') depth--;
    }
    return app.length - 1;
}

/**
 * Source from `start` to the semicolon that ends the statement, skipping ones
 * inside strings, regexes, comments and brackets. Used for a declaration whose
 * value starts on a later line.
 */
function matchStatementEnd(start) {
    let depth = 0;
    let lastSignificant = '=';
    for (let i = start; i < app.length; i++) {
        const char = app[i];
        const next = app[i + 1];
        if (char === '/' && next === '/') { i = app.indexOf('\n', i); if (i < 0) break; continue; }
        if (char === '/' && next === '*') { i = app.indexOf('*/', i + 2) + 1; continue; }
        if (char === '"' || char === "'") {
            for (i++; i < app.length; i++) {
                if (app[i] === '\\') { i++; continue; }
                if (app[i] === char) break;
            }
            lastSignificant = char;
            continue;
        }
        if (char === '`') { i = matchTemplateEnd(i); lastSignificant = '`'; continue; }
        if (char === '/' && /[(,=:[!&|?{};\n+\-*%^~<>]/.test(lastSignificant || '\n')) {
            let inClass = false;
            for (i++; i < app.length; i++) {
                if (app[i] === '\\') { i++; continue; }
                if (app[i] === '[') inClass = true;
                else if (app[i] === ']') inClass = false;
                else if (app[i] === '/' && !inClass) break;
            }
            lastSignificant = '/';
            continue;
        }
        if (!/\s/.test(char)) lastSignificant = char;
        if (char === '(' || char === '[' || char === '{') depth++;
        else if (char === ')' || char === ']' || char === '}') depth--;
        else if (char === ';' && depth === 0) return app.slice(start, i + 1);
    }
    return null;
}

function matchSpan(startIndex, openChar, closeChar, label, searchFrom = startIndex) {
    const open = app.indexOf(openChar, searchFrom);
    assert(open >= 0, `No opening ${openChar} for ${label}`);
    let depth = 0;
    let lastSignificant = '';
    for (let i = open; i < app.length; i++) {
        const char = app[i];
        const next = app[i + 1];
        if (char === '/' && next === '/') { i = app.indexOf('\n', i); if (i < 0) break; continue; }
        if (char === '/' && next === '*') { i = app.indexOf('*/', i + 2) + 1; continue; }
        if (char === '"' || char === "'") {
            for (i++; i < app.length; i++) {
                if (app[i] === '\\') { i++; continue; }
                if (app[i] === char) break;
            }
            lastSignificant = char;
            continue;
        }
        // Template interpolation can contain object literals and more nested
        // templates. Use the same lexer-aware matcher as statement extraction.
        if (char === '`') {
            i = matchTemplateEnd(i);
            lastSignificant = '`';
            continue;
        }
        if (char === '/' && /[(,=:[!&|?{};\n+\-*%^~<>]/.test(lastSignificant || '\n')) {
            let inClass = false;
            for (i++; i < app.length; i++) {
                if (app[i] === '\\') { i++; continue; }
                if (app[i] === '[') inClass = true;
                else if (app[i] === ']') inClass = false;
                else if (app[i] === '/' && !inClass) break;
            }
            lastSignificant = '/';
            continue;
        }
        if (!/\s/.test(char)) lastSignificant = char;
        if (char === openChar) depth++;
        else if (char === closeChar && --depth === 0) return app.slice(startIndex, i + 1);
    }
    throw new Error(`Unclosed ${label}`);
}

// --- the index of what app.js declares at the top level ----------------------

// Anything the environment supplies. Following these would be meaningless and
// pulling `state` or `document` into a context would defeat every stub.
const AMBIENT = new Set([
    'Object', 'Array', 'String', 'Number', 'Boolean', 'Math', 'JSON', 'Date', 'RegExp',
    'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 'Symbol', 'Error', 'TypeError',
    'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'console', 'window',
    'document', 'localStorage', 'sessionStorage', 'indexedDB', 'navigator', 'location',
    'fetch', 'crypto', 'performance', 'structuredClone', 'AbortController', 'Intl',
    'state', 'undefined', 'NaN', 'Infinity', 'globalThis', 'this', 'arguments'
]);

const KEYWORDS = new Set([
    'function', 'async', 'await', 'return', 'const', 'let', 'var', 'if', 'else', 'for',
    'while', 'do', 'switch', 'case', 'default', 'break', 'continue', 'new', 'delete',
    'typeof', 'instanceof', 'in', 'of', 'try', 'catch', 'finally', 'throw', 'class',
    'extends', 'super', 'yield', 'void', 'true', 'false', 'null'
]);

/**
 * A const is safe to lift only if evaluating it cannot reach outside itself.
 * Frozen tables, literals and plain collections qualify; anything that calls
 * into the app or the DOM at load time does not.
 */
function constInitializerIsInert(source) {
    // Literal text is data, not code, and must not be scanned for calls — a
    // regex like /\b(fire|siege)/ otherwise reads as a call to `b(`.
    const body = source.slice(source.indexOf('=') + 1)
        .replace(/'(?:\\.|[^'\\])*'/g, "''")
        .replace(/"(?:\\.|[^"\\])*"/g, '""')
        .replace(/`(?:\\.|[^`\\])*`/g, '``')
        .replace(/(^|[=(,[:|?&!+\s])\/(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n])+\/[gimsuy]*/g, '$1/RE/');
    const withoutObjectKeys = body.replace(
        /\b(document|window|localStorage|sessionStorage|indexedDB|navigator|state)\s*:/g,
        ''
    );
    if (/\b(document|window|localStorage|sessionStorage|indexedDB|navigator|state)\b/.test(withoutObjectKeys)) return false;
    // A call is fine only if it is one of the shapes we recognise as inert.
    const calls = body.match(/\b[A-Za-z_$][\w$.]*\s*\(/g) || [];
    return calls.every(call => /^(Object\.freeze|Object\.entries|Object\.keys|Object\.values|Object\.fromEntries|[A-Za-z_$][\w$]*\.map|Set|Map|Array|String|Number|Boolean|RegExp|Symbol)\s*\($/.test(call));
}

// name -> { kind, index, source }. Built once; every suite shares it.
const declarations = (() => {
    const found = new Map();
    const add = (name, kind, index, source) => {
        if (!found.has(name)) found.set(name, { name, kind, index, source });
    };

    const fnPattern = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
    let match;
    while ((match = fnPattern.exec(app))) {
        const name = match[1];
        const start = match.index;
        try {
            const params = matchSpan(start, '(', ')', `params of ${name}`);
            add(name, 'function', start, matchSpan(start, '{', '}', `function ${name}`, start + params.length));
        } catch (error) { /* an unparsable declaration simply is not offered */ }
    }

    const constPattern = /^(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/gm;
    while ((match = constPattern.exec(app))) {
        const name = match[1];
        const start = match.index;
        let source = null;
        const initializerStart = app.indexOf('=', start) + 1;
        const frozen = /^\s*Object\.freeze\(/.test(app.slice(initializerStart, initializerStart + 80));
        try {
            if (frozen) {
                source = matchSpan(start, '(', ')', `const ${name}`) + ';';
            } else {
                const line = app.slice(start, app.indexOf('\n', start) + 1);
                // A declaration that finishes on its own line is taken as-is;
                // anything else — a value on the next line, an array or object
                // over several, `new RegExp(` spread across three — runs to the
                // statement's semicolon. Special-casing each shape meant every
                // new formatting style silently vanished from the index.
                source = /;\s*(\/\/.*)?$/.test(line.trim())
                    ? line.trim()
                    : matchStatementEnd(start);
            }
        } catch (error) { source = null; }
        if (source && constInitializerIsInert(source)) add(name, 'const', start, source);
    }
    return found;
})();

function functionSource(name) {
    const found = declarations.get(name);
    assert(found && found.kind === 'function', `Missing function: ${name}`);
    return found.source;
}

/**
 * The source text WITHOUT the leading `async`, for suites that assert on the
 * text rather than running it — an extracted `async` function body containing
 * `await` will not parse on its own.
 */
function asyncFunctionSource(name) {
    return functionSource(name).replace(/^async\s+/, '');
}

function constSource(name) {
    const found = declarations.get(name);
    assert(found && found.kind === 'const', `Missing const: ${name}`);
    return found.source;
}

/**
 * Close over the call graph from `seeds`. Returns declarations in app.js source
 * order, so the emitted program behaves exactly as the same lines do in the
 * real file.
 */
function resolveDependencies(seeds, options = {}) {
    const provided = new Set(options.provided || []);
    const exclude = new Set(options.exclude || []);
    const chosen = new Map();
    const queue = [...seeds];
    const missing = [];

    while (queue.length) {
        const name = queue.shift();
        if (chosen.has(name) || exclude.has(name) || AMBIENT.has(name)) continue;
        const found = declarations.get(name);
        if (!found) {
            // A seed the suite asked for by name is a mistake worth reporting;
            // an identifier merely mentioned inside a body is not.
            if (seeds.includes(name)) missing.push(name);
            continue;
        }
        chosen.set(name, found);
        // Comments are prose, not dependencies. A guard comment mentioning a
        // large function once caused a one-line boolean to pull the entire
        // runtime into a VM and fail with an unrelated parse error.
        const dependencySource = found.source
            .replace(/\/\/[^\n]*/g, '')
            .replace(/\/\*[\s\S]*?\*\//g, '');
        const identifiers = dependencySource.match(/\b[A-Za-z_$][\w$]*\b/g) || [];
        identifiers.forEach(identifier => {
            if (identifier === name) return;
            if (KEYWORDS.has(identifier) || AMBIENT.has(identifier)) return;
            // A stub the suite installed must never be replaced by the real one.
            if (provided.has(identifier)) return;
            if (chosen.has(identifier) || exclude.has(identifier)) return;
            if (declarations.has(identifier)) queue.push(identifier);
        });
    }
    assert(!missing.length, `Missing declaration(s): ${missing.join(', ')}`);
    return [...chosen.values()].sort((left, right) => left.index - right.index);
}

/**
 * Build a vm context holding `seeds` and everything they reach.
 *
 * The suite passes the stubs it needs as `context`; those names are honoured
 * and never followed. Every resolved declaration is exported onto the context,
 * so a test can reach a helper it never named without the suite listing it.
 */
function buildContext(vm, seeds, context = {}, options = {}) {
    context.HordeHumanPackage ||= require('../human-package.js');
    context.Blob ||= Blob;
    context.crypto ||= require('node:crypto').webcrypto;
    context.VHWorldEngine ||= require('../vh-world-engine.js');
    context.VHActivityEngine ||= require('../vh-activity-engine.js');
    context.VHConversationEngine ||= require('../vh-conversation-engine.js');
    context.HordeHumanPackage ||= require('../human-package.js');
    const resolved = resolveDependencies(seeds, {
        provided: Object.keys(context),
        exclude: options.exclude || []
    });
    vm.createContext(context);
    const program = resolved.map(entry => entry.source).join('\n') + '\n' +
        resolved.map(entry => `try { this.${entry.name} = ${entry.name}; } catch (e) {}`).join('\n');
    vm.runInContext(program, context);
    context.__resolved = resolved.map(entry => entry.name);
    return context;
}

module.exports = {
    app, matchSpan, declarations,
    functionSource, asyncFunctionSource, constSource,
    resolveDependencies, buildContext
};
