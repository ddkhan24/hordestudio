#!/usr/bin/env python3
"""Reviewed Aslyn v18 setup repair through the existing command architecture.

Default is a dry run. --copy-db accepts only scratch copies; --api-base accepts
only loopback HTTP. No server or provider workers are started. Nothing migrates
a kernel, resets a life, edits a transcript, replaces media, or retries a command.
Old authored values are pinned in the baseline, never sampled from the target.
"""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import sys
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
WORLD = '47a6412a-d208-54f5-a85f-eb74e10c1bfa'
FIELDS = ('socialWorld', 'privateLife', 'routine', 'playerKnowledge',
          'initialMotive', 'connectionAuthenticity', 'startingScenario')


def read(path):
    return json.loads(Path(path).read_text())


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'),
                                     ensure_ascii=False).encode()).hexdigest()


def plan(projection, include_map=False):
    if projection.get('requiresMigration'):
        raise ValueError('Activate the current kernel before applying this setup repair.')
    state = projection['state']
    c = state['truth']['companion']
    if c.get('name') != 'Aslyn Jonas' or state.get('mergedInto'):
        raise ValueError('This repair is only for the canonical Aslyn Jonas life.')
    baseline = read(ROOT / 'scripts/aslyn-v18-setup-baseline.json')
    location = read(ROOT / 'scripts/aslyn-v18-location-overlay.json')
    profile = read(ROOT / 'scripts/aslyn-v18-profile-overlay.json')
    template = read(ROOT / 'assets/bundled/aslyn-v18/character.json')['companion']
    desired = {**template, **profile['topLevel']}
    proposal, changes, preserved = {}, [], []

    def replace(path, current, old, new):
        if current == new:
            return False
        if current == old:
            changes.append(path)
            return True
        preserved.append(path)
        return False

    expression = {}
    for field in FIELDS:
        if field not in c:
            expression[field] = copy.deepcopy(desired[field])
            changes.append('expression.' + field)
        elif c[field] != desired[field]:
            expected_old = desired[field]
            for patch in location.get('authoredTextReplacements', []):
                if patch['field'] == field:
                    expected_old = expected_old.replace(patch['new'], patch['old'])
            if field in ('privateLife', 'routine'):
                expected_old = expected_old.replace('academic warning', 'academic probation warning')
            if expected_old != desired[field] and c[field] == expected_old:
                expression[field] = copy.deepcopy(desired[field])
                changes.append('expression.' + field)
            else:
                preserved.append('expression.' + field)
    if expression:
        proposal['expression'] = expression

    for section, actual in [('places', c['lifeProfile']['places']),
                            ('rooms', c['vh2Visual']['zones'])]:
        rows = {r['id']: r for r in actual}
        patches = []
        for target in location[section]:
            ident = target['id']
            if ident not in rows:
                raise ValueError('Expected stable ' + section + ' identity is missing: ' + ident)
            current = rows[ident]
            if section == 'rooms' and current['placeId'] != target['placeId']:
                preserved.append('rooms.' + ident + '.placeId and text')
                continue
            updates = {key: value for key, value in target['set'].items()
                       if replace(section + '.' + ident + '.' + key, current.get(key),
                                  baseline[section][ident].get(key), value)}
            if updates:
                if section == 'rooms':
                    patches.append({**{k: current[k] for k in ('id', 'placeId', 'label', 'description')}, **updates})
                else:
                    patches.append({'id': ident, **updates})
        if patches:
            proposal[section] = patches

    life = c['lifeProfile']
    for key, old in baseline['lifeText'].items():
        value = profile['lifeProfile'][key]
        if replace('lifeProfile.' + key, life.get(key), old, value):
            proposal[key] = value

    calendar = copy.deepcopy(life.get('personalCalendar', []))
    calendar_by_id = {r['id']: r for r in calendar}
    old_calendar = {r['id']: r for r in baseline['personalCalendar']}
    for row in profile['lifeProfile']['personalCalendar']:
        ident = row['id']
        current = calendar_by_id.get(ident)
        if current is None:
            # A removed baseline event may have been deliberately deleted.
            if ident in old_calendar:
                preserved.append('calendar.' + ident + ' (removed)')
            else:
                calendar.append(copy.deepcopy(row))
                changes.append('calendar.' + ident)
            continue
        old = old_calendar.get(ident)
        if not old:
            if current != row:
                preserved.append('calendar.' + ident)
            continue
        # Only birth year and its provenance note are new. User titles, alerts,
        # event enablement and all unrelated calendar entries remain intact.
        if row.get('kind') == 'birthday':
            if current.get('personId') != old.get('personId') or current.get('kind') != 'birthday':
                preserved.append('calendar.' + ident + ' (changed subject)')
                continue
            if replace('calendar.' + ident + '.date', current.get('date'), old.get('date'), row['date']):
                current['date'] = row['date']
            if current.get('date') == row['date'] and current.get('notes') == old.get('notes'):
                if current.get('notes') != row.get('notes'):
                    current['notes'] = row['notes']
                    changes.append('calendar.' + ident + '.notes')
    if calendar != life.get('personalCalendar', []):
        proposal['personalCalendar'] = calendar

    finance = c['vh2Finance']['policy']
    expense = profile['policies']['finance']['dailyExpense']
    if replace('finance.dailyExpense', finance.get('dailyExpense'), baseline['finance']['dailyExpense'], expense):
        proposal['finance'] = {**finance, 'dailyExpense': expense}
    relationship = c['vh2Psychology']['relationshipPolicy']
    step = profile['policies']['relationshipPolicy']['positiveStep']
    if replace('relationshipPolicy.positiveStep', relationship.get('positiveStep'),
               baseline['relationshipPolicy']['positiveStep'], step):
        proposal['relationshipPolicy'] = {'positiveStep': step}

    lives, vehicles = [], []
    for ident, target in profile['peoplePolicies'].items():
        actor = c['vh2People']['actors'].get(ident)
        if not actor:
            raise ValueError('Expected existing participant is missing: ' + ident)
        policy = actor['policy']
        updates = {k: v for k, v in target.items() if replace('people.' + ident + '.' + k,
                   policy.get(k), baseline['peoplePolicies'][ident].get(k), v)}
        # Vehicle ownership and its allowed mode are one coherent correction.
        if updates and any(policy.get(k) not in (baseline['peoplePolicies'][ident][k], v)
                           for k, v in target.items()):
            preserved.append('people.' + ident + ' (custom vehicle policy)')
            continue
        if updates:
            if actor.get('journey'):
                raise ValueError(ident + ' is travelling; wait until they arrive before correcting mobility.')
            if 'ownsCar' in updates:
                vehicles.append({'type': 'correct_person_vehicle_ownership', 'personId': ident,
                    'ownsCar': True, 'ownsBicycle': policy['ownsBicycle'],
                    'reason': 'Restore the existing authored car ownership omitted by the original independent-life setup; preserve this person, their balance and history.'})
            else:
                lives.append({'personId': ident, 'policy': {**policy, **updates}})
    if lives:
        proposal['peopleLives'] = lives

    rules = c.get('vh2Institutions', {}).get('rules', [])
    existing = {r['id']: r for r in rules}
    occupied = {r['scheduleId'] for r in rules}
    schedule_ids = {r['id'] for r in life['weeklySchedule']}
    additions = []
    for rule in profile['policies']['institutions']:
        if rule['id'] in existing:
            if rule != existing[rule['id']]:
                preserved.append('institutions.' + rule['id'])
        elif rule['scheduleId'] in occupied:
            preserved.append('institutions.' + rule['id'] + ' (custom rule for course)')
        elif rule['scheduleId'] not in schedule_ids:
            preserved.append('institutions.' + rule['id'] + ' (course removed)')
        else:
            additions.append(rule)
            changes.append('institutions.' + rule['id'])
    if additions:
        proposal['institutions'] = additions
    if c['lifeRuntime']['world'].get('journey') and {'rooms', 'peopleLives'} & set(proposal):
        raise ValueError('Aslyn is travelling; apply this repair after her current journey ends.')

    map_plan = None
    if include_map:
        old_path = ROOT / 'scratch/v18-release-results/tempe-core-before-v18.json'
        new_path = ROOT / 'world-packs/tempe-core.json'
        old_pack, new_pack = read(old_path), read(new_path)
        old_hash, new_hash = digest(old_pack), digest(new_pack)
        packs = c['vh2Geography'].get('packs', [])
        if not any(p.get('contentHash') == new_hash for p in packs):
            if not any(p['source'] == old_pack['source'] and
                       p.get('packId') == old_pack.get('id', old_pack.get('bbox')) for p in packs):
                raise ValueError('The expected original Tempe pack is absent; map replacement needs review.')
            map_plan = {'packId': new_hash, 'replacePackId': old_hash,
                        'bindings': read(ROOT / 'scripts/aslyn-v18-route-overlay.json')['bindings'],
                        'oldPath': str(old_path), 'newPath': str(new_path)}
    return {'worldId': WORLD, 'baseRevision': projection['revision'],
            'baseSetupVersion': c.get('vh2SetupVersion', 0), 'proposal': proposal,
            'mapReplacement': map_plan, 'vehicleCorrections': vehicles, 'changedFields': changes,
            'preservedUserEdits': sorted(set(preserved)),
            'inputFingerprints': {p: digest(read(ROOT / p)) for p in (
                'scripts/aslyn-v18-setup-baseline.json', 'scripts/aslyn-v18-location-overlay.json',
                'scripts/aslyn-v18-profile-overlay.json', 'assets/bundled/aslyn-v18/character.json')}}


def protected(state):
    c = state['truth']['companion']
    world = c['lifeRuntime']['world']
    return {**{k: state.get(k) for k in ('communication', 'conversations', 'memories',
              'photos', 'clips', 'social', 'playerKnowledge', 'running', 'simAt')},
            'assets': c.get('vh2Assets'),
            'main': {k: world.get(k) for k in ('balance', 'placeId', 'journey')},
            'participants': {ident: {k: a.get(k) for k in ('balance', 'placeId', 'journey',
                     'presenceHistory', 'visits', 'health', 'psychology')}
                     for ident, a in c['vh2People']['actors'].items()}}


class CopyTarget:
    def __init__(self, path):
        path = Path(path).resolve()
        if not path.is_file() or not any(parent in path.parents for parent in
                       ((ROOT / 'scratch').resolve(), Path('/private/tmp'))):
            raise ValueError('Copy mode requires an existing scratch SQLite file, never the live database.')
        from virtual_humans.backend.vh2_runtime import WorldService
        node = ROOT / 'runtime/darwin-arm64/node'
        self.service = WorldService(path, str(node), ROOT)

    def projection(self):
        return self.service.projection(WORLD)

    def command(self, body):
        return self.service.command(body)

    def install(self, pack, name):
        from virtual_humans.backend import vh2_world_packs
        return vh2_world_packs.library(self.service, {'pack': pack, 'name': name})

    def close(self):
        self.service.close()


class ApiTarget:
    def __init__(self, base):
        url = urllib.parse.urlsplit(base)
        if url.scheme != 'http' or url.hostname not in ('127.0.0.1', 'localhost', '::1') or url.path not in ('', '/') or url.username or url.password or url.query or url.fragment:
            raise ValueError('API mode requires a plain loopback HTTP base URL.')
        self.base = base.rstrip('/')

    def request(self, path, body=None):
        payload = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(self.base + path, data=payload,
                                     headers={'Content-Type': 'application/json'})
        # Local direct transport: do not send authored data through proxy settings.
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req, timeout=120) as response:
            return json.load(response)

    def projection(self):
        return self.request('/vh2/projection?worldId=' + WORLD)

    def command(self, body):
        return self.request('/vh2/command', body)

    def install(self, pack, name):
        return self.request('/vh2/world-packs', {'pack': pack, 'name': name})

    def close(self):
        pass


def apply(target, prepared):
    before = target.projection()
    if before['revision'] != prepared['baseRevision']:
        raise ValueError('Life advanced after this repair was prepared; review a fresh dry run. No retry was made.')
    receipts = []
    if prepared['proposal']:
        body = {'schemaVersion': 1, 'worldId': WORLD, 'expectedRevision': before['revision'],
                'key': 'v18-setup-repair:' + digest(prepared['proposal'])[:24],
                'type': 'apply_life_proposal', 'version': 2,
                'baseSetupVersion': prepared['baseSetupVersion'], 'proposal': prepared['proposal']}
        receipts.append(target.command(body))
    for correction in prepared.get('vehicleCorrections', []):
        current = target.projection()
        # Recheck the exact authored policy after any intervening setup command.
        fresh = plan(current)
        if correction not in fresh['vehicleCorrections']:
            raise ValueError('Vehicle policy changed after review; no vehicle correction was submitted.')
        receipts.append(target.command({'schemaVersion': 1, 'worldId': WORLD,
            'expectedRevision': current['revision'],
            'key': 'v18-vehicle-repair:' + digest(correction)[:24], **correction}))
    map_plan = prepared.get('mapReplacement')
    if map_plan:
        for key, ident in [('oldPath', 'replacePackId'), ('newPath', 'packId')]:
            pack = read(map_plan[key])
            if digest(pack) != map_plan[ident]:
                raise ValueError('Map content changed after review; setup receipt is retained, map not changed.')
            target.install(pack, 'Tempe walking region (v18 original)' if key == 'oldPath' else 'Tempe walking region (v18 corrected)')
        current = target.projection()
        receipts.append(target.command({'schemaVersion': 1, 'worldId': WORLD,
            'expectedRevision': current['revision'], 'key': 'v18-tempe-repair:' + map_plan['packId'][:24],
            'type': 'import_world_pack', **{k: map_plan[k] for k in ('packId', 'replacePackId', 'bindings')}}))
    after = target.projection()
    stable = protected(before['state']) == protected(after['state'])
    result = {'applied': True, 'fromRevision': before['revision'], 'toRevision': after['revision'],
              'commandsCompleted': len(receipts), 'protectedStateExactlyPreserved': stable,
              'receipts': [{'revision': r.get('revision'), 'status': r.get('status'),
                            'key': r.get('key')} for r in receipts]}
    if isinstance(target, CopyTarget):
        if not stable:
            mismatches = [k for k in protected(before['state']) if
                protected(before['state'])[k] != protected(after['state'])[k]]
            raise AssertionError('Protected copy state changed: ' + ', '.join(mismatches))
        result['replayMatched'] = target.service.replay(WORLD) == after['state']
        if not result['replayMatched']:
            raise AssertionError('Replay differs after setup repair.')
    else:
        result['note'] = 'Background ticks may advance live state; commands remain revision fenced. No generation or retry was requested.'
    remaining = plan(after, bool(map_plan))
    result['idempotent'] = not remaining['proposal'] and not remaining['mapReplacement'] and not remaining['vehicleCorrections']
    result['remainingPreservedUserEdits'] = remaining['preservedUserEdits']
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--copy-db')
    source.add_argument('--api-base')
    parser.add_argument('--include-map', action='store_true')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    target = CopyTarget(args.copy_db) if args.copy_db else ApiTarget(args.api_base)
    report = {'productionModified': False, 'mode': 'copy' if args.copy_db else 'api',
              'dryRun': not args.apply, 'providerCalls': 0}
    try:
        report['plan'] = plan(target.projection(), args.include_map)
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
        if args.apply:
            report['productionModified'] = bool(args.api_base)
            report['result'] = apply(target, report['plan'])
        report['passed'] = True
    except Exception as exc:
        report['passed'] = False
        report['error'] = str(exc)
        raise
    finally:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
        target.close()
    print(json.dumps({k: v for k, v in report.items() if k != 'plan'}, indent=2))
    print('Reviewable plan:', args.report)


if __name__ == '__main__':
    main()
