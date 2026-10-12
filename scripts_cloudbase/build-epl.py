# -*- coding: utf-8 -*-
"""抓取英超真实数据（25-26 完整赛季 + 26-27 进行中），生成 data/epl.json。

口径（2026-10-12 零拍板）：
  · 赛程     —— 腾讯体育 matchweb.sports.qq.com，columnId=10082（英超），两个赛季
                足球的 matchType 恒为 '1'（与篮球语义不同），状态改看 matchPeriod：
                '2'=已结束 / '1'=进行中 / '0'=未开始
  · 积分榜   —— 央视体育 cbs-u.sports.cctv.com，leagueId=3238，两个赛季都能取全
                （腾讯 /team/rank 只给当前赛季，故改用央视；这是零同意的方案）
                接口无 rank 字段 → 按数组顺序补 rank
  · 射手榜   —— 央视 /player/scorers（**只有当前 26-27 赛季**）；25-26 拿不到（腾讯、
                央视都忽略 season 参数）→ 按零的决定，25-26 留空、26-27 填真数据
  · 球员数据 —— 两赛季都拿不到 → 空数组 + playerNote
  · 争冠形势 —— 由 26-27 真实积分榜分档生成（保留旧功能，数据换真的）
  · 场馆     —— 腾讯/央视都不提供 → 用 ESPN 公开 API 的「主队 -> 主场」，中文化后按主队标满
                （见 sports_extra.py；ESPN 英文队名 -> 中文用 EPL_EN2CN 表）
  · 队徽     —— 争冠形势各队挂央视 logoUrl（与积分榜同源，译名口径一致）；赛程卡不展示队徽

用法：python scripts_cloudbase/build-epl.py
"""
import json, os, re, urllib.request
from collections import defaultdict, Counter

try:
    from sports_extra import cn_venues, fetch_cctv_logos, EPL_EN2CN, fetch_qq_badges
except ImportError:  # 直接以脚本运行时的相对导入兜底
    import sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from sports_extra import cn_venues, fetch_cctv_logos, EPL_EN2CN, fetch_qq_badges

# ---- 腾讯（赛程）----
TH = {'Origin': 'https://sports.qq.com', 'Referer': 'https://sports.qq.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
ML = 'https://matchweb.sports.qq.com/matchUnion/list'
CID = 10082                        # 英超

# ---- 央视（积分榜 / 射手榜）----
CH = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Referer': 'https://cbs.sports.cctv.com/', 'Origin': 'https://cbs.sports.cctv.com',
      'Accept': 'application/json'}
CB = 'https://cbs-u.sports.cctv.com'
CLID = 3238                        # 英超

SEASON_2526 = ('2025-07-01', '2026-07-01', '2026-06-30')
SEASON_2627 = ('2026-07-01', '2027-07-01', '2026-10-12')


def get(u, h, tries=3):
    last = None
    for _ in range(tries):
        try:
            r = urllib.request.Request(u, headers=h)
            return json.loads(urllib.request.urlopen(r, timeout=45).read().decode('utf-8', 'ignore'))
        except Exception as e:
            last = e
    raise last


_SCHED_CACHE = {}


def sched(win):
    if win not in _SCHED_CACHE:
        start, end, today = win
        d = get('%s?today=%s&startTime=%s&endTime=%s&columnId=%d&isInit=true'
                % (ML, today, start, end, CID), TH)
        _SCHED_CACHE[win] = d.get('data') or {}
    return _SCHED_CACHE[win]


# ---------- 1. 赛程 ----------
def round_label(desc):
    """'英超第7轮' → '第 7 轮'（英超只有联赛轮次，无杯赛）"""
    s = re.sub(r'^英超', '', desc or '')
    s = re.sub(r'第(\d+)轮', r'第 \1 轮', s)
    return s or '联赛'


def status_of(g):
    """足球：matchType 恒为 '1'（不像篮球有经典赛），状态只看 matchPeriod。"""
    per = str(g.get('matchPeriod'))
    if per == '2':
        try:
            int(g.get('leftGoal')), int(g.get('rightGoal'))
            return '已结束'
        except (TypeError, ValueError):
            return '未开始'
    if per == '1':
        return '进行中'
    return '未开始'


def build_schedule(venue_of=None):
    out = []
    venue_of = venue_of or {}
    for season, win, prefix in (('25-26', SEASON_2526, 'epl-2526'),
                                ('26-27', SEASON_2627, 'epl-2627')):
        n = 0
        sd = sched(win)
        for dt in sorted(sd.keys()):
            for g in sd[dt]:
                Ln, Rn = g.get('leftName'), g.get('rightName')
                if not Ln or not Rn:
                    continue
                st = status_of(g)
                n += 1
                item = {
                    'id': '%s-%03d' % (prefix, n),
                    'date': dt,
                    'time': (g.get('startTime') or '')[11:16] or '',
                    'status': st,
                    'homeTeam': Ln, 'awayTeam': Rn,
                    'round': round_label(g.get('matchDesc')) or '联赛',
                    'venue': venue_of.get(Ln, ''),
                    'seasonId': season,
                }
                if st in ('已结束', '进行中'):
                    try:
                        item['homeScore'] = int(g.get('leftGoal'))
                        item['awayScore'] = int(g.get('rightGoal'))
                    except (TypeError, ValueError):
                        item['status'] = '未开始'
                out.append(item)
    return out


# ---------- 2. 积分榜（央视）----------
def fetch_standings(season):
    u = ('%s/statistics/football/team/rankings?leagueId=%d&client=pc&season=%s'
         % (CB, CLID, season))
    d = get(u, CH)
    rs = (d.get('results') or [{}])[0].get('rankings', [{}])[0].get('ranking', [])
    rows = []
    for i, t in enumerate(rs, 1):
        rows.append({
            'rank': i,
            'teamName': t.get('teamName'),
            'played': t.get('games'),
            'wins': t.get('wins'),
            'draws': t.get('draws'),
            'losses': t.get('losses'),
            'goalsFor': t.get('goalsFor'),
            'goalsAgainst': t.get('goalsAgainst'),
            'points': t.get('points'),
        })
    return rows


# ---------- 3. 射手榜（央视，仅当前赛季）----------
def fetch_scorers():
    u = '%s/statistics/football/player/scorers?leagueId=%d&client=pc' % (CB, CLID)
    d = get(u, CH)
    rs = d.get('results') or []
    rows = []
    for i, p in enumerate(rs, 1):
        rows.append({
            'rank': i,
            'playerName': p.get('playerName'),
            'teamName': p.get('teamName'),
            'goals': p.get('goals'),
            'assists': p.get('assists'),
        })
    return rows


# ---------- 4. 争冠形势（由 26-27 真实积分榜分档）----------
PARTS = ['阿森纳', '利物浦', '曼城', '切尔西', '曼联', '热刺', '纽卡斯尔', '阿斯顿维拉',
         '布莱顿', '水晶宫', '诺丁汉森林', '西汉姆联', '埃弗顿', '富勒姆', '伯恩茅斯',
         '桑德兰', '莱斯特城', '布伦特福德', '伯恩利', '狼队']
# 英超队色（沿用旧数据里已定的那套，保持视觉一致；缺的用中性灰）
TEAM_COLOR = {
    '阿森纳': '#ef0107', '利物浦': '#c8102e', '曼城': '#6cabdd', '切尔西': '#034694',
    '曼联': '#da291c', '热刺': '#132257', '纽卡斯尔': '#414a52', '阿斯顿维拉': '#670e36',
    '布莱顿': '#0057b8', '水晶宫': '#1b458f', '诺丁汉森林': '#dd0000', '西汉姆联': '#7a263a',
    '埃弗顿': '#003399', '富勒姆': '#262626', '伯恩茅斯': '#da291c', '桑德兰': '#eb172b',
    '莱斯特城': '#003090', '布伦特福德': '#e30613', '伯恩利': '#6c1d45', '狼队': '#b3850d',
}
# 英超队简称（旧数据里已定的那套）
TEAM_ABBR = {
    '阿森纳': 'ARS', '利物浦': 'LIV', '曼城': 'MCI', '切尔西': 'CHE', '曼联': 'MUN',
    '热刺': 'TOT', '纽卡斯尔': 'NEW', '阿斯顿维拉': 'AVL', '布莱顿': 'BHA', '水晶宫': 'CRY',
    '诺丁汉森林': 'NFO', '西汉姆联': 'WHU', '埃弗顿': 'EVE', '富勒姆': 'FUL', '伯恩茅斯': 'BOU',
    '桑德兰': 'SUN', '莱斯特城': 'LEI', '布伦特福德': 'BRE', '伯恩利': 'BUR', '狼队': 'WOL',
}


def build_race(st2627, logos=None):
    """按 26-27 真实积分榜分 5 档。榜单不足则各档为空，不硬凑。"""
    if not st2627:
        return None
    logos = logos or {}
    by_rank = {r['rank']: r for r in st2627}
    top_pts = st2627[0]['points']

    def team(r):
        gap = r['points'] - top_pts
        t = {
            'rank': r['rank'], 'name': r['teamName'],
            'abbr': TEAM_ABBR.get(r['teamName'], r['teamName'][:3].upper()),
            'color': TEAM_COLOR.get(r['teamName'], '#4b5563'),
            'played': r['played'], 'points': r['points'],
            'form': [], 'trend': 'flat',
            'gap': ('榜首' if gap == 0 else ('落后榜首 %d 分' % -gap) if gap < 0 else '领先'),
        }
        if logos.get(r['teamName']):
            t['logo'] = logos[r['teamName']]
        return t

    def pick(rng):
        return [team(by_rank[i]) for i in rng if i in by_rank]

    return {
        'season': '26-27', 'seasons': ['26-27'],
        'note': '英超为联赛制、无季后赛——晋级图不适用，本标签为「争冠形势」：'
                '分区与球队数量由数据驱动，按 26-27 当前真实积分榜分档（数据源：央视体育）',
        'asOf': '截至第 %d 轮' % max(r['played'] for r in st2627),
        'zones': [
            {'id': 'title', 'name': '争冠集团', 'color': '#d4a017',
             'desc': '冠军大概率在本区产生', 'teams': pick(range(1, 4))},
            {'id': 'ucl', 'name': '欧冠区', 'color': '#3b82f6',
             'desc': '前 4 名直通欧冠正赛', 'teams': pick(range(4, 5))},
            {'id': 'uel', 'name': '欧战区（5-7 名）', 'color': '#0e9488',
             'desc': '欧联杯与欧协联资格争夺', 'teams': pick(range(5, 8))},
            {'id': 'mid', 'name': '中游（8-14 名）', 'color': '#9ca3af',
             'desc': '积分胶着，一波连胜就能改写座次', 'teams': pick(range(8, 15))},
            {'id': 'drop', 'name': '保级边缘（15-17 名）', 'color': '#d97706',
             'desc': '距降级区一步之遥', 'teams': pick(range(15, 18))},
            {'id': 'releg', 'name': '降级区（18-20 名）', 'color': '#dc2626',
             'desc': '赛季结束后降入英冠', 'teams': pick(range(18, 21))},
        ],
    }


# ---------- 组装 ----------
def main():
    # 场馆与队徽：先取赛程日期，再按日期扫 ESPN / 腾讯 / 央视
    dates = set()
    for win in (SEASON_2526, SEASON_2627):
        dates.update(sched(win).keys())
    dates = sorted(dates)

    venue_of = cn_venues('eng.1', dates, EPL_EN2CN)
    logos = fetch_cctv_logos(CLID)

    sched_all = build_schedule(venue_of)
    n2526 = sum(1 for x in sched_all if x['seasonId'] == '25-26')
    n2627 = sum(1 for x in sched_all if x['seasonId'] == '26-27')
    st2526 = fetch_standings('2025-2026')
    st2627 = fetch_standings('2026-2027')
    scorers = fetch_scorers()
    race = build_race(st2627, logos)

    # ---- 自检 ----
    errs = []
    if n2526 != 380:
        errs.append('英超 25-26 赛程不是 380 场：%d' % n2526)
    if len(st2526) != 20:
        errs.append('英超 25-26 积分榜不是 20 队：%d' % len(st2526))
    if len(st2627) != 20:
        errs.append('英超 26-27 积分榜不是 20 队：%d' % len(st2627))
    # 25-26 是完整赛季 → 各队场次必须一致（38）；26-27 进行中 → 只校验积分公式
    played_2526 = {r['played'] for r in st2526}
    if played_2526 != {38}:
        errs.append('英超 25-26 各队场次不是 38：%s' % sorted(played_2526))
    for nm, st in (('25-26', st2526), ('26-27', st2627)):
        for r in st:
            if r['wins'] + r['draws'] + r['losses'] != r['played']:
                errs.append('英超 %s %s 胜平负之和 != 场次' % (nm, r['teamName']))
            if r['wins'] * 3 + r['draws'] != r['points']:
                errs.append('英超 %s %s 积分 != 胜*3+平' % (nm, r['teamName']))
    if not scorers:
        errs.append('英超射手榜为空')
    nv = sum(1 for x in sched_all if not x.get('venue'))
    if nv:
        errs.append('英超赛程有 %d 场缺场馆' % nv)
    nlogo = sum(1 for z in (race or {}).get('zones', []) for t in z['teams'] if not t.get('logo'))
    if nlogo:
        errs.append('英超争冠形势有 %d 队缺队徽' % nlogo)
    if errs:
        raise SystemExit('自检未过：\n  - ' + '\n  - '.join(errs))

    import datetime
    data = {
        'leagueId': 'epl',
        'leagueName': '英超',
        'sport': 'football',
        'emoji': '⚽',
        'desc': '英格兰足球超级联赛 · 真实数据（赛程：腾讯体育｜积分榜/射手榜：央视体育）'
                '｜25-26 完整赛季 · 26-27 进行中',
        'updatedAt': datetime.datetime.now().strftime('%Y-%m-%dT%H:%M:%S+08:00'),
        'tabs': ['schedule', 'standings', 'race', 'scorers', 'players'],
        'seasons': ['25-26', '26-27'],
        'defaultSeason': '25-26',
        'schedule': sched_all,
        'standings': {'25-26': st2526, '26-27': st2627},
        'scorers': scorers,
        'scorersSeason': '26-27',
        'scorersNote': '射手榜为 26-27 赛季实时数据（数据源：央视体育）；'
                       '25-26 赛季历史射手榜数据源不提供，故未收录',
        'race': race,
        'players': {'25-26': [], '26-27': []},
        'playerNote': '英超球员赛季数据（出场/进球/助攻/评分）待数据源提供后上线',
    }

    out = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                        '..', 'data', 'epl.json'))
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print('written', out)
    print('schedule  25-26: %d  26-27: %d' % (n2526, n2627))
    print('standings 25-26: %d 队，冠军 %s（%d 分 / %d 场）' % (
        len(st2526), st2526[0]['teamName'], st2526[0]['points'], st2526[0]['played']))
    print('standings 26-27: %d 队，榜首 %s（%d 分 / %d 场）' % (
        len(st2627), st2627[0]['teamName'], st2627[0]['points'], st2627[0]['played']))
    print('scorers   26-27: %d 人，首位 %s（%d 球）' % (
        len(scorers), scorers[0]['playerName'], scorers[0]['goals']))
    print('race      zones: %s' % [(z['name'], len(z['teams'])) for z in race['zones']])


if __name__ == '__main__':
    main()
