"""Read-only, bounded discovery. Uses the feed transport's public-HTTPS protections."""
import csv
import io
import zipfile
import vh2_feeds
from vh2_live_data import sports_data


def choices(raw, kind):
    if kind == 'gtfs':
        if not isinstance(raw, bytes) or len(raw) > 20000000:
            raise ValueError('GTFS archive exceeds 20 MB.')
        try:
            archive = zipfile.ZipFile(io.BytesIO(raw))
        except zipfile.BadZipFile:
            raise ValueError('Choose a GTFS ZIP containing stops.txt.') from None
        with archive:
            files = archive.infolist()
            if len(files) > 100 or sum(f.file_size for f in files) > 100000000:
                raise ValueError('GTFS expanded archive exceeds limits.')
            if len({f.filename for f in files}) != len(files):
                raise ValueError('GTFS contains duplicate files.')
            if 'stops.txt' not in archive.namelist():
                raise ValueError('This archive has no stops.txt file.')
            found = {}
            with archive.open('stops.txt') as stream:
                for index, row in enumerate(csv.DictReader(io.TextIOWrapper(stream, encoding='utf-8-sig'))):
                    if index >= 500000:
                        raise ValueError('GTFS stop table exceeds row limit.')
                    # Stations and entrances are not boarding stops used by stop_times.
                    if (row.get('location_type') or '').strip() not in ('', '0'):
                        continue
                    ident, name = row.get('stop_id') or '', row.get('stop_name') or ''
                    if not ident or len(ident) > 100 or not name.strip():
                        continue
                    if ident in found:
                        raise ValueError('GTFS contains duplicate stop IDs.')
                    found[ident] = name.strip()[:200]
                    if len(found) > 50000:
                        raise ValueError('More than 50,000 stops. Use a regional timetable or manual IDs.')
    elif kind == 'openliga':
        data = sports_data(raw)
        if not isinstance(data, list) or len(data) > 500:
            raise ValueError('Choose an OpenLigaDB match list (up to 500 matches).')
        names = {}
        for match in data:
            if not isinstance(match, dict):
                continue
            results = match.get('matchResults') or []
            if not isinstance(results, list):
                raise ValueError('Match results must be a list.')
            for result in results:
                if not isinstance(result, dict):
                    continue
                ident = result.get('resultTypeID')
                if type(ident) is not int or not 1 <= ident <= 1000:
                    continue
                name = result.get('resultName')
                if isinstance(name, str) and name.strip():
                    names.setdefault(str(ident), set()).add(name.strip()[:200])
        found = {ident: ' / '.join(sorted(labels)) for ident, labels in names.items()}
    else:
        raise ValueError('Discovery supports GTFS timetables and OpenLigaDB matches.')
    return {'choices': [{'id': ident, 'label': name} for ident, name in sorted(found.items(), key=lambda pair: (pair[1].casefold(), pair[0]))]}


def discover(body):
    kind = body.get('kind')
    if kind == 'news':
        return discover_news(body)
    if kind not in ('gtfs', 'openliga'):
        raise ValueError('Unsupported discovery source.')
    raw = vh2_feeds.fetch(body.get('url'), limit=20000000 if kind == 'gtfs' else 1000000)
    return choices(raw, kind)


def discover_news(body):
    """Find relevant news search feeds without an LLM or Maps request."""
    from urllib.parse import urlencode
    import re
    location = body.get('location', '')
    topics = body.get('topics', [])
    language, country = body.get('language', 'en'), body.get('country', 'US')
    if not isinstance(location, str) or len(location) > 160:
        raise ValueError('Use a location of at most 160 characters.')
    if not isinstance(topics, list) or len(topics) > 6 or any(not isinstance(t, str) or len(t) > 80 for t in topics):
        raise ValueError('Use up to six interests, each at most 80 characters.')
    if not isinstance(language, str) or not re.fullmatch('[a-z]{2}', language) or not isinstance(country, str) or not re.fullmatch('[A-Z]{2}', country):
        raise ValueError('Use a two-letter language and uppercase country code.')
    location = location.strip()
    queries = ([location] if location else []) + [' '.join(filter(None, (location, t.strip()))) for t in topics if t.strip()]
    queries = list(dict.fromkeys(queries))[:3]
    if not queries:
        raise ValueError('Enter a location or at least one interest.')
    results = []
    for query in queries:
        url = 'https://news.google.com/rss/search?' + urlencode({'q': query, 'hl': language, 'gl': country, 'ceid': country + ':' + language})
        candidate = {'label': query, 'url': url, 'tags': [t.strip()[:40] for t in topics if t.strip()][:6],
                     'origin': 'Google News search feed; articles from multiple publishers, not a verified event calendar.'}
        try:
            candidate.update(preview({'url': url}))
        except Exception as error:
            candidate.update(valid=False, error=str(error)[:300])
        results.append(candidate)
    return {'sources': results, 'requests': len(queries), 'llmCalls': 0, 'mapsCalls': 0}


def preview(body):
    """Read-only RSS validation; article publication is never an event time."""
    import time
    url=body.get('url')
    raw=vh2_feeds.fetch(url,limit=1000000)
    source={'id':'preview','url':url,'freshHours':168,'tags':[]}
    rows=vh2_feeds.parse(raw,source,int(time.time()*1000))
    return {'valid':True,'recentItems':len(rows),'titles':[r.get('title','') for r in rows[:3]],'warning':source.get('warning','')}
