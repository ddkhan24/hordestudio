'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function runtime(bridge, clock = Date) {
    const elements = new Map();
    const notices = [];
    const warnings = [];
    const context = { console: { ...console, warn: (...args) => warnings.push(args) }, Date: clock, Math, Set, Map, Object, Array, String, Number, RegExp,
        AbortController, DOMException, setTimeout, clearTimeout, setInterval, clearInterval,
        state: {}, saveState: async () => {}, mcpBridgeRequest: bridge,
        mcpBridgeBase: () => 'http://audit.invalid', showToast: (...args) => notices.push(args),
        document: { getElementById(id) {
            if (!elements.has(id)) elements.set(id, { value: '', dataset: {}, textContent: '', innerHTML: '',
                disabled: false, classList: { toggle() {}, add() {}, remove() {} },
                setAttribute() {}, removeAttribute() {}, load() {}, play: async () => {},
                querySelector() { return null; }, querySelectorAll() { return []; } });
            return elements.get(id);
        } } };
    context.window = context;
    vm.createContext(context);
    const source = fs.readFileSync('video-worlds.js', 'utf8').replace('window.HordeVideoWorlds = {',
        'window.HordeVideoWorlds = { __audit: { requestRoutedVideoRender, requestVideoRender, finishVideoJob, resumeVideoJob, ensureState, cancelGeneration },');
    vm.runInContext(source, context, { filename: 'video-worlds.js' });
    const video = context.HordeVideoWorlds;
    const world = video.normalizeWorld({ id: 'world', contentRoute: 'standard_then_spicy' });
    const session = video.normalizeSession({ id: 'take' });
    Object.assign(context.state, { videoWorlds: [world], activeVideoWorldId: world.id,
        videoWorldSessions: { [world.id]: { activeSessionId: session.id, sessions: [session] } } });
    return { context, video, audit: video.__audit, world, session, notices, warnings };
}

async function main() {
    {
        const paths = [];
        const { audit, world, session } = runtime(async path => {
            paths.push(path);
            if (path === '/fal/video/jobs') return { jobId: 'fal_running' };
            throw new Error('Bridge connection interrupted');
        });
        await assert.rejects(audit.requestRoutedVideoRender(world, session, { action: 'Enter' }, {}, new AbortController().signal),
            error => error.code === 'VIDEO_JOB_PENDING');
        assert.equal(session.pendingVideoJob.jobId, 'fal_running');
        assert.equal(paths.filter(path => path === '/hotapi/video/jobs').length, 0,
            'polling failure must not duplicate paid work through another provider');
        await audit.resumeVideoJob(world, session);
        assert.equal(session.pendingVideoJob.jobId, 'fal_running',
            'recovery failure must retain the durable job for the next reconnect');
    }
    {
        const paths = [];
        const { audit, world, session } = runtime(async path => {
            paths.push(path);
            if (path === '/fal/video/jobs') return { jobId: 'fal_failed' };
            if (path === '/fal/video/jobs/fal_failed') return { status: 'failed', error: 'Renderer declined' };
            if (path === '/hotapi/video/jobs') return { jobId: 'hot_completed' };
            if (path === '/hotapi/video/jobs/hot_completed') return { status: 'completed', result: { mediaId: 'a'.repeat(32) } };
            throw new Error(`Unexpected ${path}`);
        });
        const result = await audit.requestRoutedVideoRender(world, session, { action: 'Enter' }, {}, new AbortController().signal);
        assert.equal(result.mediaId, 'a'.repeat(32));
        assert.equal(paths.filter(path => path === '/hotapi/video/jobs').length, 1,
            'confirmed provider failure still permits the configured fallback');
    }
    {
        let tick = 0;
        class Clock extends Date { static now() { return ++tick * 400000; } }
        const paths = [];
        const { audit, world, session } = runtime(async path => {
            paths.push(path); return { jobId: 'slow_job' };
        }, Clock);
        await assert.rejects(audit.requestRoutedVideoRender(world, session, { action: 'Enter' }, {}, new AbortController().signal),
            error => error.code === 'VIDEO_JOB_PENDING');
        assert.equal(session.pendingVideoJob.jobId, 'slow_job');
        assert.equal(paths.length, 1, 'local polling deadline must not invoke another provider');
    }
    {
        let release;
        const pending = new Promise(resolve => { release = resolve; });
        const paths = [];
        const { audit, world, session, context, video } = runtime(async path => {
            paths.push(path);
            if (path.endsWith('/cancel')) return {};
            return pending;
        });
        assert.equal(video.hasPendingWork(), false);
        session.pendingVideoJob = { jobId: 'source_job', provider: 'fal' };
        const recovered = audit.resumeVideoJob(world, session);
        assert.equal(video.hasPendingWork(), true,
            'backup and purge guards must observe active video recovery');
        audit.ensureState();
        assert.equal(context.state.videoWorldSessions[world.id].sessions[0], session,
            'a library normalization must preserve the live session receiving the paid render');
        const second = video.normalizeSession({ id: 'second', pendingVideoJob: { jobId: 'other_job', provider: 'hotapi' } });
        context.state.videoWorldSessions[world.id].sessions.push(second);
        context.state.videoWorldSessions[world.id].activeSessionId = second.id;
        audit.cancelGeneration();
        assert.equal(session.pendingVideoJob, null);
        assert.equal(second.pendingVideoJob.jobId, 'other_job',
            'cancelling from another visible timeline must leave its own saved job intact');
        assert.ok(paths.includes('/fal/video/jobs/source_job/cancel'));
        release({ status: 'completed', result: { mediaId: 'a'.repeat(32) } });
        await recovered;
        assert.equal(video.hasPendingWork(), false,
            'the video maintenance guard must clear once recovery settles');
        assert.equal(session.shots.length, 0, 'a cancelled recovery must not activate stale provider results');
    }
    {
        const { audit, world, session, context, warnings } = runtime(async () => ({}));
        session.storyBlock = { nodes: [{ id: 'opening', shotId: '', renderError: '' }] };
        const snapshots = [];
        context.saveState = async () => { snapshots.push(JSON.parse(JSON.stringify(session))); };
        const pending = { prepared: true, storyNodeId: 'opening', action: 'Enter', prompt: 'Enter the scene',
            plan: { sceneSummary: 'Enter', choices: [], statePatch: {} } };
        const result = { mediaId: 'b'.repeat(32), mediaUrl: '/video-world-media/clip.mp4', model: 'minimax/h3-max', duration: 5 };
        session.pendingVideoJob = { ...pending, jobId: 'completed_job' };
        const first = await audit.finishVideoJob(world, session, pending, result);
        assert.equal(warnings.length, 1, 'frame-capture failure is diagnosed without losing the saved clip');
        assert.equal(snapshots[0].storyBlock.nodes[0].shotId, first.id,
            'the first durable write of a completed paid shot must include its playable node binding');
        assert.equal(snapshots[0].pendingVideoJob, null);
        session.storyBlock.nodes[0].shotId = '';
        session.pendingVideoJob = { ...pending, jobId: 'completed_job' };
        const recovered = await audit.finishVideoJob(world, session, pending, result);
        assert.equal(recovered.id, first.id);
        assert.equal(session.storyBlock.nodes[0].shotId, first.id,
            'replaying a completed job must repair orphaned node bindings without charging another scene');
        assert.equal(session.shots.length, 1);
    }
    console.log('video_worlds_release_job_regression: ok');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
