"""Shared Maps request accounting. Stores counts only, never queries or results."""
import sqlite3
import time

MINUTE_LIMIT = 12
DAILY_LIMIT = 100


def usage(directory):
    path = directory / 'maps-usage.sqlite'
    result = {'minuteLimit': MINUTE_LIMIT, 'dailyLimit': DAILY_LIMIT,
              'scope': 'This installation, all lives; UTC day', 'providers': {}}
    if not path.exists():
        return result
    now = time.time()
    with sqlite3.connect(path.as_uri() + '?mode=ro', uri=True) as db:
        for provider in ('google', 'openrouteservice'):
            rows = db.execute('SELECT action,status,count(*) FROM calls WHERE provider=? AND at>=? GROUP BY action,status',
                              (provider, int(now // 86400) * 86400)).fetchall()
            cooldown = db.execute('SELECT until FROM cooldown WHERE provider=?', (provider,)).fetchone()
            result['providers'][provider] = {
                'today': sum(n for _, status, n in rows if status != 'blocked'),
                'blocked': sum(n for _, status, n in rows if status == 'blocked'),
                'calls': [{'action': a, 'status': s, 'count': n} for a, s, n in rows],
                'cooldownSeconds': max(0, int((cooldown[0] if cooldown else 0) - now))}
    return result


def request(directory, provider, action, send):
    directory.mkdir(parents=True, exist_ok=True)
    now = time.time()
    path = directory / 'maps-usage.sqlite'
    with sqlite3.connect(path, timeout=5) as db:
        db.execute('CREATE TABLE IF NOT EXISTS calls (id INTEGER PRIMARY KEY, at REAL, provider TEXT, action TEXT, status TEXT)')
        db.execute('CREATE TABLE IF NOT EXISTS cooldown (provider TEXT PRIMARY KEY, until REAL)')
        db.execute('BEGIN IMMEDIATE')
        db.execute('DELETE FROM calls WHERE at<?', (now - 8 * 86400,))
        wait = db.execute('SELECT until FROM cooldown WHERE provider=?', (provider,)).fetchone()
        recent, today = db.execute("SELECT sum(at>=?),count(*) FROM calls WHERE provider=? AND status!='blocked' AND at>=?",
                                   (now - 60, provider, int(now // 86400) * 86400)).fetchone()
        reason = ('Maps provider is cooling down; try again in %s seconds.' % max(1, int(wait[0] - now)) if wait and wait[0] > now else
                  'Maps daily safety limit reached (100 calls per provider). Use saved travel estimates until the next UTC day.' if today >= DAILY_LIMIT else
                  'Maps minute safety limit reached (12 calls per provider). Wait a minute before trying again.' if (recent or 0) >= MINUTE_LIMIT else '')
        cursor = db.execute('INSERT INTO calls(at,provider,action,status) VALUES(?,?,?,?)',
                            (now, provider, action, 'blocked' if reason else 'submitted'))
        ident = cursor.lastrowid
    if reason:
        raise ValueError(reason)
    status, pause = 'failed', 0
    try:
        response = send()
        code, headers, _ = response
        status = 'succeeded' if code < 400 else 'failed'
        if code == 429:
            retry = next((v for k, v in headers.items() if k.lower() == 'retry-after'), '60')
            pause = min(3600, max(60, int(retry))) if str(retry).isdigit() else 60
        elif code >= 500:
            pause = 30
        return response
    except Exception:
        pause = 30
        raise
    finally:
        with sqlite3.connect(path, timeout=5) as db:
            db.execute('UPDATE calls SET status=? WHERE id=?', (status, ident))
            if pause:
                db.execute('INSERT INTO cooldown VALUES(?,?) ON CONFLICT(provider) DO UPDATE SET until=max(until,excluded.until)',
                           (provider, time.time() + pause))
