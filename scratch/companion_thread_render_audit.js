const assert = require('node:assert/strict');
const vm = require('node:vm');
const { functionSource } = require('./app_source');

class EntryNode {
    constructor() {
        this.className = '';
        this.dataset = {};
        this.parentNode = null;
        this._html = '';
        this.classList = { contains: name => this.className.split(/\s+/).includes(name) };
    }
    set innerHTML(value) { this._html = value; }
    get innerHTML() { return this._html; }
    get offsetTop() { return Math.max(0, this.parentNode?.children.indexOf(this) || 0) * 20; }
    get offsetHeight() { return 20; }
    get firstElementChild() {
        return this._html ? { offsetTop: this.offsetTop, offsetHeight: this.offsetHeight } : null;
    }
    get nextElementSibling() {
        if (!this.parentNode) return null;
        return this.parentNode.children[this.parentNode.children.indexOf(this) + 1] || null;
    }
    remove() {
        if (!this.parentNode) return;
        const index = this.parentNode.children.indexOf(this);
        if (index >= 0) this.parentNode.children.splice(index, 1);
        this.parentNode = null;
    }
}

class Container {
    constructor() {
        this.dataset = {};
        this.children = [];
        this.clientHeight = 200;
        this._scrollTop = 0;
    }
    get firstElementChild() { return this.children[0] || null; }
    get scrollHeight() { return this.children.length * 20; }
    get scrollTop() { return this._scrollTop; }
    set scrollTop(value) {
        this._scrollTop = Math.max(0, Math.min(Number(value) || 0,
            Math.max(0, this.scrollHeight - this.clientHeight)));
    }
    replaceChildren() {
        this.children.forEach(node => { node.parentNode = null; });
        this.children = [];
        this._scrollTop = 0;
    }
    insertBefore(node, reference) {
        if (node.parentNode) {
            const oldIndex = node.parentNode.children.indexOf(node);
            if (oldIndex >= 0) node.parentNode.children.splice(oldIndex, 1);
        }
        const index = reference ? this.children.indexOf(reference) : this.children.length;
        this.children.splice(index < 0 ? this.children.length : index, 0, node);
        node.parentNode = this;
    }
}

const ctx = { document: { createElement: () => new EntryNode() } };
vm.createContext(ctx);
vm.runInContext(functionSource('reconcileCompanionThreadEntries'), ctx);

const entries = count => Array.from({ length: count }, (_, index) => ({
    id: `message-${index}`,
    html: `<div>Message ${index}</div>`,
    signature: `v1-${index}`
}));

const container = new Container();
ctx.reconcileCompanionThreadEntries(container, entries(100), 'human|timeline');
assert.equal(container.children.length, 100);
assert.equal(container.scrollTop, 1800, 'initial render follows the newest message');
const stableNodes = new Map(container.children.map(node => [node.dataset.messageId, node]));

container.scrollTop = 600;
ctx.reconcileCompanionThreadEntries(container, entries(101), 'human|timeline');
assert.equal(container.scrollTop, 600, 'an append does not pull a reader away from older messages');
assert.equal(container.children[40], stableNodes.get('message-40'), 'unchanged bubbles retain their DOM nodes');

const updated = entries(101);
updated[50] = { ...updated[50], html: '<div>Updated delivery state</div>', signature: 'v2-50' };
ctx.reconcileCompanionThreadEntries(container, updated, 'human|timeline');
assert.equal(container.children[50], stableNodes.get('message-50'), 'a changed bubble updates in place');
assert.equal(container.scrollTop, 600, 'an in-place status update preserves the scroll anchor');

container.scrollTop = container.scrollHeight;
ctx.reconcileCompanionThreadEntries(container, entries(102), 'human|timeline');
assert.equal(container.scrollTop, 1840, 'a reader already at the bottom follows a new reply');

console.log('PASS: long-thread reconciliation retains DOM nodes and preserves intentional scroll position');
