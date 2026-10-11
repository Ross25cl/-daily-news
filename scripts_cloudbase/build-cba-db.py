#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build-cba-db.py — 把 CBA 真实数据（data/cba.json + data/matches.json）转成入库 SQL。

照搬 scripts_cloudbase/build-nba-db.py 的结构（Day 22 定的模式）。

产出：
  db/league_data_cba.sql   入库脚本（仓库留档，人工可审阅、换环境可重放）

覆盖的表：
  leagues           1 行    维度表（描述与 Tab 对齐真实数据）
  league_schedule   972 行  两个赛季赛程（25-26 = 462、26-27 = 510，带 season）
  league_standings  20 行   25-26 常规赛 20 队（zone 留空——CBA 无东西部分区）
  league_brackets   2 行    25-26 晋级图(kind=bracket) + 25-26 季后赛对阵(kind=playoffs)
  matches           若干    赛程比分页的 CBA 段（data/matches.json 的 CBA 条目）

不覆盖：
  league_players    两个赛季球员榜在 cba.json 里都是空数组 → 无数据可灌（DELETE 旧行后跳过）

前置：须先执行 db/migrate-day22-league-season.sql（season / zone 列）。
执行顺序（重要）：db/schema.sql → db/league_data.sql → db/league_data_nba.sql → db/league_data_cba.sql。
  league_data.sql 里原有一段 cbaleague.com 的 CBA 26-27 赛程；本文件按 league_id='cba'
  整段清空后重灌，故必须排在 league_data.sql 之后，否则会被它覆盖回旧数据。
  （league_data.sql 由 fetch-leagues.py 生成，是否从中摘掉 CBA 段待零拍板，见交接说明。）

  league_data_cba.sql 约 350KB，超过 tcb db execute 单次 argv 上限（~32KB），
  执行时需按语句边界切段（与 league_data_nba.sql 同款做法）。

用法：python scripts_cloudbase/build-cba-db.py
"""
import json
import os

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(BASE, '..'))
CBA = os.path.join(ROOT, 'data', 'cba.json')
MATCHES = os.path.join(ROOT, 'data', 'matches.json')
OUT_SQL = os.path.join(ROOT, 'db', 'league_data_cba.sql')

LG = 'cba'
MATCH_LEAGUE = 'CBA'


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
    rows = []
    for season, zones in data.get('standings', {}).items():
        if isinstance(zones, list):          # CBA：单分区（无东西部）→ 扁平数组
            zones = {'': zones}
        for zone, teams in zones.items():
            for t in teams:
                w = t.get('wins', 0)
                l = t.get('losses', 0)
                rows.append({
                    'id': '%s-standings-%s-%02d' % (LG, season.replace('-', ''), t['rank']),
                    'league_id': LG,
                    'season': season,
                    'zone': zone or None,        # CBA 无分区 → NULL
                    'rank': t['rank'],
                    'team_name': t['team'],
                    'played': t.get('played', w + l),
                    'wins': w,
                    'draws': t.get('draws'),
                    'losses': l,
                    'goals_for': t.get('goalsFor'),
                    'goals_against': t.get('goalsAgainst'),
                    'points': t.get('points'),
                    'points_diff': t.get('pointsDiff'),
                    'win_rate': t.get('winRate'),
                })
    return rows


def build_brackets(data):
    rows = []
    br = data.get('bracket')
    if br and (br.get('halves') or br.get('final')):
        season = br.get('season') or (br.get('seasons') or [''])[0]
        rows.append({
            'id': '%s-%s-bracket' % (LG, season),
            'league_id': LG,
            'season': season,
            'kind': 'bracket',
            'payload_json': br,
            'updated_at': data.get('updatedAt'),
        })
    for season, series in data.get('playoffs', {}).items():
        if not series:
            continue
        rows.append({
            'id': '%s-%s-playoffs' % (LG, season),
            'league_id': LG,
            'season': season,
            'kind': 'playoffs',
            'payload_json': series,
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
    data = json.load(open(CBA, encoding='utf-8'))
    all_matches = json.load(open(MATCHES, encoding='utf-8'))

    leagues = [build_league(data)]
    sched = build_schedule(data)
    stand = build_standings(data)
    brack = build_brackets(data)
    mtch = build_matches(all_matches)

    # ---- 自检：把「会不会被约束拒掉」的项先拦下 ----
    errs = []
    sids = [r['id'] for r in sched]
    if len(sids) != len(set(sids)):
        errs.append('league_schedule 有重复 id')
    if len(stand) and not all(r['zone'] is None for r in stand):
        errs.append('CBA 排行应为无分区（zone 留空），却出现了分区值')
    if len(stand) != 20:
        errs.append('CBA 25-26 排行不是 20 队：%d' % len(stand))
    ranks = sorted(r['rank'] for r in stand)
    if ranks != list(range(1, 21)):
        errs.append('CBA 排行名次不是 1..20：%s' % ranks)
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
    a('-- league_data_cba.sql — CBA 真实数据入库（由 scripts_cloudbase/build-cba-db.py 生成）')
    a('-- 数据源：腾讯体育（data/cba.json）· 赛程比分页 CBA 段（data/matches.json）')
    a('-- 前置：db/migrate-day22-league-season.sql（season / zone 列）')
    a('-- 执行顺序：schema.sql → league_data.sql → league_data_nba.sql → 本文件')
    a('--   （league_data.sql 里有一段 cbaleague 的 CBA 26-27，须被本文件覆盖）')
    a('-- 可重复执行：先清空 league_id=cba / league=CBA 的行，再插入')
    a('-- 规模：league_schedule %d · league_standings %d · league_brackets %d · matches %d'
      % (len(sched), len(stand), len(brack), len(mtch)))
    a('-- ============================================================')
    a('')
    a('BEGIN;')
    a('')
    a('-- ---------- 1. 联赛维度表（与真实数据的 desc / tabs 对齐）----------')
    a('-- 用 upsert：维度表已有 cba 这一行，重跑不该报主键冲突')
    a('INSERT INTO public.leagues (%s) VALUES (%s)' % (
        ', '.join(COLS['leagues']),
        ', '.join(sql_value('leagues', c, leagues[0]) for c in COLS['leagues'])))
    a('ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, sport = EXCLUDED.sport,')
    a('  emoji = EXCLUDED.emoji, description = EXCLUDED.description,')
    a('  tabs = EXCLUDED.tabs, updated_at = EXCLUDED.updated_at;')
    a('')
    a('-- ---------- 2. 清空 CBA 旧数据（含 league_data.sql 灌的 cbaleague 赛程）----------')
    for t in ('league_schedule', 'league_standings', 'league_players', 'league_brackets'):
        a("DELETE FROM public.%s WHERE league_id = 'cba';" % t)
    a("DELETE FROM public.matches WHERE league = 'CBA';")
    a('')
    a('-- ---------- 3. league_schedule（两个赛季 %d 场）----------' % len(sched))
    for r in sched:
        a(emit_insert('league_schedule', r))
    a('')
    a('-- ---------- 4. league_standings（25-26 常规赛 20 队，无分区）----------')
    for r in stand:
        a(emit_insert('league_standings', r))
    a('')
    a('-- ---------- 5. league_brackets（晋级图 + 季后赛对阵）----------')
    for r in brack:
        a(emit_insert('league_brackets', r))
    a('')
    a('-- ---------- 6. matches（赛程比分页 CBA 段 %d 条）----------' % len(mtch))
    for r in mtch:
        a(emit_insert('matches', r))
    a('')
    a('COMMIT;')
    a('')
    a('-- 收尾自检')
    a("SELECT 'league_schedule' t, count(*) FROM public.league_schedule WHERE league_id='cba'")
    a("UNION ALL SELECT 'league_standings', count(*) FROM public.league_standings WHERE league_id='cba'")
    a("UNION ALL SELECT 'league_brackets',  count(*) FROM public.league_brackets  WHERE league_id='cba'")
    a("UNION ALL SELECT 'matches(CBA)',     count(*) FROM public.matches        WHERE league='CBA';")
    a("SELECT season, count(*) FROM public.league_schedule WHERE league_id='cba' GROUP BY season ORDER BY season;")
    a("SELECT season, count(*) FROM public.league_standings WHERE league_id='cba' GROUP BY season ORDER BY season;")
    a('')

    open(OUT_SQL, 'w', encoding='utf-8').write('\n'.join(L))

    print('written', OUT_SQL)
    print('  leagues           %4d' % len(leagues))
    print('  league_schedule   %4d  (25-26 %d / 26-27 %d)' % (
        len(sched),
        sum(1 for r in sched if r['season'] == '25-26'),
        sum(1 for r in sched if r['season'] == '26-27')))
    print('  league_standings  %4d  (25-26)' % len(stand))
    print('  league_brackets   %4d' % len(brack))
    print('  matches           %4d' % len(mtch))


if __name__ == '__main__':
    main()
