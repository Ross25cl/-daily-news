#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build-epl-db.py — 把英超真实数据（data/epl.json + data/matches.json）转成入库 SQL。

照搬 scripts_cloudbase/build-nba-db.py 的结构（Day 22 定的模式）。

产出：
  db/league_data_epl.sql   入库脚本（仓库留档，人工可审阅、换环境可重放）

覆盖的表：
  leagues           1 行    维度表（描述与 Tab 对齐真实数据）
  league_schedule   760 行  两个赛季赛程（25-26 = 380、26-27 = 380，带 season）
  league_standings  40 行   两个赛季各 20 队（zone 留空——英超无分区）
  league_players    100 行  26-27 射手榜（board=scorers）；25-26 数据源不提供 → 无
  league_brackets   1 行    26-27 争冠形势(kind=race)；英超无晋级图
  matches           若干    赛程比分页的英超段（data/matches.json 的英超条目）

前置：须先执行 db/schema.sql（含 season/zone 列）与 db/league_data.sql。
执行顺序（重要）：db/schema.sql → db/league_data.sql → db/league_data_nba.sql
  → db/league_data_cba.sql → db/league_data_epl.sql → db/league_data_ucl.sql。
  league_data.sql 里原有一段英超旧数据（epl），本文件按 league_id='epl' 整段清空后重灌，
  故必须排在 league_data.sql 之后，否则会被它覆盖回旧数据。

用法：python scripts_cloudbase/build-epl-db.py
"""
import json
import os

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(BASE, '..'))
EPL = os.path.join(ROOT, 'data', 'epl.json')
MATCHES = os.path.join(ROOT, 'data', 'matches.json')
OUT_SQL = os.path.join(ROOT, 'db', 'league_data_epl.sql')

LG = 'epl'
MATCH_LEAGUE = '英超'


def sqlq(v):
    """SQL 字面量转义（与 fetch-leagues.py / build-nba-db.py 同款）：单引号翻倍。"""
    if v is None:
        return 'NULL'
    if isinstance(v, bool):
        return 'TRUE' if v else 'FALSE'
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


# ---------- 各表行构造（键 = 数据库列名 snake_case）----------

def build_league(data):
    return {
        'id': LG,
        'name': data['leagueName'],
        'sport': data['sport'],
        'emoji': data.get('emoji'),
        'description': data.get('desc'),
        'tabs': data.get('tabs') or [],
        'updated_at': data.get('updatedAt'),
    }


def build_schedule(data):
    rows = []
    for m in data['schedule']:
        rows.append({
            'id': m['id'],
            'league_id': LG,
            'season': m.get('seasonId') or '',
            'match_date': m['date'],
            'match_time': m.get('time'),
            'status': m['status'],
            'home_team': m['homeTeam'],
            'away_team': m['awayTeam'],
            'home_score': m.get('homeScore'),
            'away_score': m.get('awayScore'),
            'round': m.get('round'),
            'venue': m.get('venue') or None,
        })
    return rows


def build_standings(data):
    """足球积分榜：zone 留空（英超/欧冠都是单一总榜，无东/西部分区）。"""
    rows = []
    for season, teams in data.get('standings', {}).items():
        if isinstance(teams, dict):          # 兼容「赛季 → {zone: [...]}」
            flat = []
            for v in teams.values():
                flat.extend(v)
            teams = flat
        for t in teams:
            rows.append({
                'id': '%s-standings-%s-%02d' % (LG, season.replace('-', ''), t['rank']),
                'league_id': LG,
                'season': season,
                'zone': None,                 # 足球无分区 → NULL
                'rank': t['rank'],
                'team_name': t['teamName'],
                'played': t.get('played'),
                'wins': t.get('wins'),
                'draws': t.get('draws'),
                'losses': t.get('losses'),
                'goals_for': t.get('goalsFor'),
                'goals_against': t.get('goalsAgainst'),
                'points': t.get('points'),
                'points_diff': None,
                'win_rate': None,
            })
    return rows


def build_players(data):
    """26-27 射手榜 → league_players（board=scorers）；25-26 无数据源 → 不入库。"""
    rows = []
    season = data.get('scorersSeason') or ''
    for p in data.get('scorers') or []:
        rows.append({
            'id': '%s-scorers-%s-%03d' % (LG, season.replace('-', ''), p['rank']),
            'league_id': LG,
            'season': season,
            'board': 'scorers',
            'rank': p['rank'],
            'player_name': p['playerName'],
            'team_name': p['teamName'],
            'points': None, 'rebounds': None,
            'assists': p.get('assists'),
            'apps': None,
            'goals': p.get('goals'),
            'rating': None,
        })
    return rows


def build_brackets(data):
    """英超无晋级图，只有 race（争冠形势）→ kind=race。"""
    rows = []
    race = data.get('race')
    if race and race.get('zones'):
        season = race.get('season') or (race.get('seasons') or [''])[0]
        rows.append({
            'id': '%s-%s-race' % (LG, season),
            'league_id': LG,
            'season': season,
            'kind': 'race',
            'payload_json': race,
            'updated_at': data.get('updatedAt'),
        })
    return rows


def build_matches(all_matches):
    rows = []
    for m in all_matches:
        if m.get('league') != MATCH_LEAGUE:
            continue
        rows.append({
            'id': m['id'],
            'league': MATCH_LEAGUE,
            'home_team': m['homeTeam'],
            'away_team': m['awayTeam'],
            'match_time': m['matchTime'],
            'status': m['status'],
            'home_score': m.get('homeScore'),
            'away_score': m.get('awayScore'),
            'round': m.get('round'),
            'venue': m.get('venue') or None,
            'data_source': m['dataSource'],
            'updated_at': m.get('updatedAt'),
        })
    return rows


# ---------- SQL 生成 ----------

COLS = {
    'leagues': ['id', 'name', 'sport', 'emoji', 'description', 'tabs', 'updated_at'],
    'league_schedule': ['id', 'league_id', 'season', 'match_date', 'match_time', 'status',
                        'home_team', 'away_team', 'home_score', 'away_score', 'round', 'venue'],
    'league_standings': ['id', 'league_id', 'season', 'zone', 'rank', 'team_name', 'played',
                         'wins', 'draws', 'losses', 'goals_for', 'goals_against', 'points',
                         'points_diff', 'win_rate'],
    'league_players': ['id', 'league_id', 'season', 'board', 'rank', 'player_name', 'team_name',
                       'points', 'rebounds', 'assists', 'apps', 'goals', 'rating'],
    'league_brackets': ['id', 'league_id', 'season', 'kind', 'payload_json', 'updated_at'],
    'matches': ['id', 'league', 'home_team', 'away_team', 'match_time', 'status', 'home_score',
                'away_score', 'round', 'venue', 'data_source', 'updated_at'],
}


def sql_value(table, col, row):
    v = row.get(col)
    if table == 'leagues' and col == 'tabs':
        return sqlq(json.dumps(v or [], ensure_ascii=False))
    if table == 'league_brackets' and col == 'payload_json':
        return sqlq(json.dumps(v, ensure_ascii=False))
    return sqlq(v)


def emit_insert(table, row):
    cols = COLS[table]
    return 'INSERT INTO public.%s (%s) VALUES (%s);' % (
        table, ', '.join(cols), ', '.join(sql_value(table, c, row) for c in cols))


def main():
    data = json.load(open(EPL, encoding='utf-8'))
    all_matches = json.load(open(MATCHES, encoding='utf-8'))

    leagues = [build_league(data)]
    sched = build_schedule(data)
    stand = build_standings(data)
    players = build_players(data)
    brack = build_brackets(data)
    mtch = build_matches(all_matches)

    # ---- 自检：把「会不会被约束拒掉」的项先拦下 ----
    errs = []
    sids = [r['id'] for r in sched]
    if len(sids) != len(set(sids)):
        errs.append('league_schedule 有重复 id')
    pids = [r['id'] for r in players]
    if len(pids) != len(set(pids)):
        errs.append('league_players 有重复 id')
    if any(r['zone'] is not None for r in stand):
        errs.append('英超积分榜应为无分区（zone 留空），却出现了分区值')
    for sn, n in (('25-26', 20), ('26-27', 20)):
        got = sum(1 for r in stand if r['season'] == sn)
        if got != n:
            errs.append('英超 %s 积分榜不是 %d 队：%d' % (sn, n, got))
    ranks = sorted(r['rank'] for r in stand if r['season'] == '25-26')
    if ranks != list(range(1, 21)):
        errs.append('英超 25-26 排名不是 1..20：%s' % ranks)
    status_ok = {'未开始', '进行中', '已结束', '延期', '取消'}
    bad = [r['id'] for r in sched if r['status'] not in status_ok]
    if bad:
        errs.append('league_schedule 非法状态: %s' % bad[:3])
    need = [r['id'] for r in sched if r['status'] == '已结束'
            and (r['home_score'] is None or r['away_score'] is None)]
    if need:
        errs.append('league_schedule 中「已结束」却缺比分: %s' % need[:3])
    needm = [r['id'] for r in mtch if r['status'] == '已结束'
             and (r['home_score'] is None or r['away_score'] is None)]
    if needm:
        errs.append('matches 中「已结束」却缺比分（会撞 CHECK）: %s' % needm[:3])
    if errs:
        raise SystemExit('自检未过：\n  - ' + '\n  - '.join(errs))

    # ---- 1. SQL 留档 ----
    L = []
    a = L.append
    a('-- ============================================================')
    a('-- league_data_epl.sql — 英超真实数据入库（由 scripts_cloudbase/build-epl-db.py 生成）')
    a('-- 数据源：赛程=腾讯体育（data/epl.json）｜积分榜/射手榜=央视体育；赛程比分页=腾讯体育')
    a('-- 前置：db/schema.sql（season / zone 列）')
    a('-- 执行顺序：schema.sql → league_data.sql → league_data_nba.sql → league_data_cba.sql')
    a('--   → 本文件 → league_data_ucl.sql')
    a('--   （league_data.sql 里有一段 epl 的旧数据，须被本文件覆盖）')
    a('-- 可重复执行：先清空 league_id=epl / league=英超 的行，再插入')
    a('-- 规模：league_schedule %d · league_standings %d · league_players %d'
      ' · league_brackets %d · matches %d'
      % (len(sched), len(stand), len(players), len(brack), len(mtch)))
    a('-- ============================================================')
    a('')
    a('BEGIN;')
    a('')
    a('-- ---------- 1. 联赛维度表（与真实数据的 desc / tabs 对齐）----------')
    a('INSERT INTO public.leagues (%s) VALUES (%s)' % (
        ', '.join(COLS['leagues']),
        ', '.join(sql_value('leagues', c, leagues[0]) for c in COLS['leagues'])))
    a('ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, sport = EXCLUDED.sport,')
    a('  emoji = EXCLUDED.emoji, description = EXCLUDED.description,')
    a('  tabs = EXCLUDED.tabs, updated_at = EXCLUDED.updated_at;')
    a('')
    a('-- ---------- 2. 清空英超旧数据（含 league_data.sql 灌的 epl 段）----------')
    for t in ('league_schedule', 'league_standings', 'league_players', 'league_brackets'):
        a("DELETE FROM public.%s WHERE league_id = 'epl';" % t)
    a("DELETE FROM public.matches WHERE league = '英超';")
    a('')
    a('-- ---------- 3. league_schedule（两个赛季 %d 场）----------' % len(sched))
    for r in sched:
        a(emit_insert('league_schedule', r))
    a('')
    a('-- ---------- 4. league_standings（两个赛季各 20 队，无分区）----------')
    for r in stand:
        a(emit_insert('league_standings', r))
    a('')
    a('-- ---------- 5. league_players（26-27 射手榜 %d 人，board=scorers）----------' % len(players))
    for r in players:
        a(emit_insert('league_players', r))
    a('')
    a('-- ---------- 6. league_brackets（26-27 争冠形势 kind=race）----------')
    for r in brack:
        a(emit_insert('league_brackets', r))
    a('')
    a('-- ---------- 7. matches（赛程比分页英超段 %d 条）----------' % len(mtch))
    for r in mtch:
        a(emit_insert('matches', r))
    a('')
    a('COMMIT;')
    a('')
    a('-- 收尾自检')
    a("SELECT 'league_schedule' t, count(*) FROM public.league_schedule WHERE league_id='epl'")
    a("UNION ALL SELECT 'league_standings', count(*) FROM public.league_standings WHERE league_id='epl'")
    a("UNION ALL SELECT 'league_players',   count(*) FROM public.league_players   WHERE league_id='epl'")
    a("UNION ALL SELECT 'league_brackets',  count(*) FROM public.league_brackets  WHERE league_id='epl'")
    a("UNION ALL SELECT 'matches(英超)',    count(*) FROM public.matches        WHERE league='英超';")
    a("SELECT season, count(*) FROM public.league_schedule WHERE league_id='epl' GROUP BY season ORDER BY season;")
    a("SELECT season, count(*) FROM public.league_standings WHERE league_id='epl' GROUP BY season ORDER BY season;")
    a('')

    open(OUT_SQL, 'w', encoding='utf-8').write('\n'.join(L))

    print('written', OUT_SQL)
    print('  leagues           %4d' % len(leagues))
    print('  league_schedule   %4d  (25-26 %d / 26-27 %d)' % (
        len(sched),
        sum(1 for r in sched if r['season'] == '25-26'),
        sum(1 for r in sched if r['season'] == '26-27')))
    print('  league_standings  %4d  (25-26 %d / 26-27 %d)' % (
        len(stand),
        sum(1 for r in stand if r['season'] == '25-26'),
        sum(1 for r in stand if r['season'] == '26-27')))
    print('  league_players    %4d  (board=scorers, season=26-27)' % len(players))
    print('  league_brackets   %4d  (kind=race)' % len(brack))
    print('  matches           %4d' % len(mtch))


if __name__ == '__main__':
    main()
