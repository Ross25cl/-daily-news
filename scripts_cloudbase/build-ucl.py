# -*- coding: utf-8 -*-
"""抓取欧冠真实数据（25-26 完整赛季 + 26-27 进行中），生成 data/ucl.json。

口径（2026-10-12 零拍板）：
  · 赛程     —— 腾讯体育，columnId=10046，两个赛季。**只收正赛**（联赛阶段 + 淘汰赛），
                剔除资格赛/附加赛（列名形如「欧冠资格赛第一轮首回合」）。
                足球 matchType 恒为 '1'，状态看 matchPeriod（'2'=已结束 / '0'=未开始）
  · 积分榜   —— 央视体育，leagueId=3239，两个赛季（36 队联赛阶段榜）。接口无 rank → 按序补
  · 淘汰赛   —— 从腾讯赛程解析：1/8 附加赛 → 1/8 决赛 → 1/4 决赛 → 半决赛 → 决赛，
                两回合按「同轮次 + 同两队」配对合并为「对阵」（含总比分与晋级方）
  · 晋级图   —— 由上面真实对阵还原（halves/rounds/matches + final；含联赛阶段摘要）
  · 射手榜   —— 央视 /player/scorers（**仅当前 26-27**）；25-26 数据源不提供 → 留空
  · 球员数据 —— 两赛季都拿不到 → 空数组 + playerNote
  · 场馆     —— 腾讯/央视都不提供 → ESPN 公开 API「主队 -> 主场」，中文化后按主队标满
  · 队徽     —— 晋级图各队挂**央视** logoUrl（腾讯图床 sports3.gtimg.com 有 Referer
                防盗链，浏览器直连 403 → 队徽全不显示；央视 cbs-img 无防盗链可直连）

用法：python scripts_cloudbase/build-ucl.py
"""
import json, os, re, urllib.request
from collections import defaultdict

try:
    from sports_extra import cn_venues, fetch_cctv_logos, UCL_EN2CN, final_venue_of
except ImportError:
    import sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from sports_extra import cn_venues, fetch_cctv_logos, UCL_EN2CN, final_venue_of

# ---- 腾讯（赛程）----
TH = {'Origin': 'https://sports.qq.com', 'Referer': 'https://sports.qq.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
ML = 'https://matchweb.sports.qq.com/matchUnion/list'
CID = 10046                        # 欧冠

# ---- 央视（积分榜 / 射手榜）----
CH = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Referer': 'https://cbs.sports.cctv.com/', 'Origin': 'https://cbs.sports.cctv.com',
      'Accept': 'application/json'}
CB = 'https://cbs-u.sports.cctv.com'
CLID = 3239                        # 欧冠

SEASON_2526 = ('2025-07-01', '2026-07-01', '2026-06-30')
SEASON_2627 = ('2026-07-01', '2027-07-01', '2026-10-12')

# 正赛轮次前缀（剔除资格赛/附加赛）；注意排序：长前缀在前，避免「欧冠1/8决赛」误吃「附加赛」
MAIN_PREFIXES = ('欧冠联赛阶段', '欧冠1/8决赛附加赛', '欧冠1/8决赛',
                 '欧冠1/4决赛', '欧冠半决赛', '欧冠决赛')

KNOCK_ROUNDS = ['1/8 决赛附加赛', '1/8 决赛', '1/4 决赛', '半决赛', '决赛']


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


def is_main(desc):
    return bool(desc) and any(desc.startswith(p) for p in MAIN_PREFIXES)


def round_label(desc):
    """'欧冠联赛阶段第3轮' → '联赛阶段第 3 轮'；'欧冠1/8决赛首回合' → '1/8 决赛 首回合'"""
    s = re.sub(r'^欧冠', '', desc or '')
    s = re.sub(r'^联赛阶段第(\d+)轮$', r'联赛阶段第 \1 轮', s)
    s = re.sub(r'^(1/8决赛附加赛|1/8决赛|1/4决赛|半决赛|决赛)(首|次)?回合?$',
               lambda m: m.group(1).replace('决赛', ' 决赛').replace('半决赛', '半决赛')
               + ((' ' + m.group(2) + '回合') if m.group(2) else ''), s)
    return s


def status_of(g):
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
    for season, win, prefix in (('25-26', SEASON_2526, 'ucl-2526'),
                                ('26-27', SEASON_2627, 'ucl-2627')):
        n = 0
        sd = sched(win)
        for dt in sorted(sd.keys()):
            for g in sd[dt]:
                desc = str(g.get('matchDesc') or '')
                if not is_main(desc):          # 剔除资格赛/附加赛
                    continue
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
                    'round': round_label(desc),
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


# ---------- 积分榜（央视）----------
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


# ---------- 射手榜（央视，仅当前赛季）----------
def fetch_scorers():
    u = '%s/statistics/football/player/scorers?leagueId=%d&client=pc' % (CB, CLID)
    d = get(u, CH)
    rs = d.get('results') or []
    return [{'rank': i, 'playerName': p.get('playerName'), 'teamName': p.get('teamName'),
             'goals': p.get('goals'), 'assists': p.get('assists')}
            for i, p in enumerate(rs, 1)]


# ---------- 淘汰赛解析（从赛程）----------
def parse_ties():
    """返回 25-26 淘汰赛对阵的结构化列表。

    每项含：
      round      轮次名（'1/8 决赛附加赛' 等）
      teams      [甲, 乙]（出现顺序）
      agg        {队名: 两回合总进球}
      pens       {队名: 点球数}（无则空）
      winner     晋级方（含点球判定；未决出为 None）
      legs       两回合明细（含单场 note）
      last       最后一回合日期
    配对规则：同轮次 + 同两队（顺序可颠倒）→ 合并。
    """
    pairs = {}
    sd = sched(SEASON_2526)
    for dt in sorted(sd.keys()):
        for g in sd[dt]:
            desc = str(g.get('matchDesc') or '')
            if not is_main(desc) or desc.startswith('欧冠联赛阶段'):
                continue
            m = re.match(r'^欧冠(.+?)(首回合|次回合)?$', desc)
            if not m:
                continue
            side = {'1/8决赛附加赛': '1/8 决赛附加赛', '1/8决赛': '1/8 决赛',
                    '1/4决赛': '1/4 决赛', '半决赛': '半决赛', '决赛': '决赛'}.get(m.group(1))
            if side is None:
                continue
            Ln, Rn = g.get('leftName'), g.get('rightName')
            if not Ln or not Rn:
                continue
            p = pairs.setdefault((side, frozenset([Ln, Rn])),
                                 {'round': side, 'teams': [Ln, Rn], 'legs': [],
                                  'agg': defaultdict(int), 'pens': {}, 'last': None})
            try:
                a, b = int(g.get('leftGoal')), int(g.get('rightGoal'))
            except (TypeError, ValueError):
                a = b = None
            if a is not None:
                p['agg'][Ln] += a
                p['agg'][Rn] += b
            if str(g.get('isShootOut')) == '1':
                p['pens'][Ln] = int(g.get('homeShootOutGoal') or 0)
                p['pens'][Rn] = int(g.get('awayShootOutGoal') or 0)
            p['legs'].append({'date': dt, 'leg': m.group(2) or '', 'home': Ln, 'away': Rn,
                              'homeScore': a, 'awayScore': b})
            p['last'] = max(p['last'] or dt, dt)

    def winner(p):
        ta, tb = p['teams']
        if p['pens']:
            return ta if p['pens'].get(ta, 0) > p['pens'].get(tb, 0) else tb
        aga, agb = p['agg'][ta], p['agg'][tb]
        if aga != agb:
            return ta if aga > agb else tb
        return None

    out = []
    for side in KNOCK_ROUNDS:
        group = [v for k, v in pairs.items() if k[0] == side]
        group.sort(key=lambda p: p['last'] or '')
        for p in group:
            ta, tb = p['teams']
            w = winner(p)
            p['winner'] = w
            out.append(p)
    return out


def tie_note(p):
    ta, tb = p['teams']
    if not p['winner']:
        return '对阵进行中'
    pen = ''
    if p['pens']:
        pen = '（点球 %d-%d）' % (p['pens'].get(ta, 0), p['pens'].get(tb, 0))
    return '两回合总比分 %d-%d%s，%s 晋级' % (p['agg'][ta], p['agg'][tb], pen, p['winner'])


def build_knockout():
    """knockout tab：对阵卡（按赛季）。仅 25-26 有完整淘汰赛。"""
    ties = []
    for p in parse_ties():
        ta, tb = p['teams']
        single = p['round'] == '决赛'
        ties.append({
            'round': p['round'] + (' 单场' if single else ' 两回合'),
            'homeTeam': ta, 'awayTeam': tb,
            'homeScore': p['agg'][ta] if p['agg'] else None,
            'awayScore': p['agg'][tb] if p['agg'] else None,
            'status': '已结束' if p['winner'] else '进行中',
            'date': p['last'] or '',
            'note': tie_note(p),
        })
    return {'25-26': ties, '26-27': []}


# ---------- 晋级图 ----------
TEAM_ABBR = {
    '巴黎圣日耳曼': 'PSG', '阿森纳': 'ARS', '拜仁慕尼黑': 'BAY', '马德里竞技': 'ATM',
    '皇家马德里': 'RMA', '巴塞罗那': 'BAR', '利物浦': 'LIV', '曼城': 'MCI',
    '国际米兰': 'INT', '切尔西': 'CHE', '托特纳姆热刺': 'TOT', '纽卡斯尔联': 'NEW',
    '勒沃库森': 'B04', '本菲卡': 'SLB', '葡萄牙体育': 'SCP', '博德闪耀': 'BOD',
    '亚特兰大': 'ATA', '多特蒙德': 'BVB', '尤文图斯': 'JUV', '加拉塔萨雷': 'GAL',
    '摩纳哥': 'MON', '布鲁日': 'BRU', '卡拉巴克': 'QAR', '奥林匹亚科斯': 'OLY',
}
TEAM_COLOR = {
    '巴黎圣日耳曼': '#004170', '阿森纳': '#ef0107', '拜仁慕尼黑': '#dc052d',
    '马德里竞技': '#cb3524', '皇家马德里': '#b8860b', '巴塞罗那': '#a50044',
    '利物浦': '#c8102e', '曼城': '#6cabdd', '国际米兰': '#0068a8', '切尔西': '#034694',
    '托特纳姆热刺': '#132257', '纽卡斯尔联': '#414a52', '勒沃库森': '#e32221',
    '本菲卡': '#e00027', '葡萄牙体育': '#008057', '博德闪耀': '#ffe600',
    '亚特兰大': '#1d4ed8', '多特蒙德': '#c7a600', '尤文图斯': '#5b5b5b',
    '加拉塔萨雷': '#a90432', '摩纳哥': '#e63312', '布鲁日': '#0a4d8c',
    '卡拉巴克': '#0e7c3a', '奥林匹亚科斯': '#d81e05',
}
# 腾讯队名 → 央视队名（用于把腾讯的直通队映射到央视积分榜拿 seed；两站译名有出入）
TV2CB = {
    '托特纳姆热刺': '托特纳姆', '博德闪耀': '博多格林特', '奥林匹亚科斯': '奧林匹亚克斯',
}


def seed_map(st2526):
    """央视榜 → {腾讯队名: rank}。先把央视队名转成腾讯口径（只在有映射时）。"""
    cb2tv = {v: k for k, v in TV2CB.items()}
    m = {}
    for r in st2526:
        name = cb2tv.get(r['teamName'], r['teamName'])
        m[name] = r['rank']
    return m


# 队徽（**央视口径**队名 -> logoUrl），main() 里填充；bracket 队伍走央视源
# （腾讯图床有 Referer 防盗链，浏览器里加载不出来；央视源无防盗链）
TEAM_LOGOS = {}


def team_obj(name, seed=None):
    o = {'name': name,
         'abbr': TEAM_ABBR.get(name, name[:3].upper()),
         'color': TEAM_COLOR.get(name, '#4b5563')}
    # 队名是腾讯口径，队徽表是央视口径 → 用 TV2CB 换算后再查
    logo = TEAM_LOGOS.get(name) or TEAM_LOGOS.get(TV2CB.get(name, name))
    if logo:
        o['logo'] = logo
    if seed is not None:
        o = {'seed': seed, **o}
    return o


def build_bracket(st2526, final_venue=''):
    """由真实淘汰赛对阵还原欧冠 25-26 晋级图。

    新赛制：36 队联赛阶段 → 前 8 名直通 16 强；9-24 名打 1/8 附加赛争另外 8 席；
            1/8 决赛（16 强）→ 1/4 决赛（8 强）→ 半决赛（4 强）→ 决赛（单场）。
    halves 按决赛两端的来源半区切分（每条半决赛 = 2 场 1/4 决赛的胜者）。
    决赛为中立场，场馆由调用方传入（ESPN）。
    """
    all_ties = parse_ties()

    def by_round(side):
        return [p for p in all_ties if p['round'] == side]

    seed_of = seed_map(st2526)

    def match(side, p, mid, fmt):
        ta, tb = p['teams']
        w = p['winner']
        sa, sb = p['agg'][ta], p['agg'][tb]
        winner_side = None if w is None else ('a' if w == ta else 'b')
        return {
            'id': mid,
            'a': team_obj(ta, seed_of.get(ta)), 'b': team_obj(tb, seed_of.get(tb)),
            'scoreA': sa, 'scoreB': sb,
            'winner': winner_side,
            'status': '已结束' if w else '进行中',
            'format': fmt,
        }

    # ---- 1/8 附加赛（8 场）----
    q, q_by_winner = [], {}
    for i, p in enumerate(by_round('1/8 决赛附加赛'), 1):
        m = match('1/8 决赛附加赛', p, 'ucl-q%d' % i, '两回合')
        q.append(m)
        q_by_winner[p['winner']] = m
    # ---- 1/8 决赛（8 场）：一端是联赛阶段前 8（直通），另一端是附加赛胜者 ----
    # 注意：腾讯与央视的队名有出入（托特纳姆热刺/托特纳姆、博德闪耀/博多格林特 等），
    #       故「直通端」不用央视榜的队名去比，而是「不在附加赛胜者集合里的那一端」。
    r, r_by_winner = [], {}
    for i, p in enumerate(by_round('1/8 决赛'), 1):
        ta, tb = p['teams']
        feeders = [t for t in (ta, tb) if t in q_by_winner]
        direct = [t for t in (ta, tb) if t not in q_by_winner]
        if len(direct) != 1 or len(feeders) != 1:
            raise SystemExit('1/8 决赛不是「1 直通 + 1 附加赛胜者」：%s vs %s' % (ta, tb))
        d_team, f_team = direct[0], feeders[0]
        w = p['winner']
        m = {
            'id': 'ucl-r%d' % i,
            'a': team_obj(d_team, seed_of.get(d_team)),
            'b': {'winnerOf': q_by_winner[f_team]['id']},
            'scoreA': p['agg'][d_team], 'scoreB': p['agg'][f_team],
            'winner': ('a' if w == d_team else 'b') if w else None,
            'status': '已结束' if w else '进行中', 'format': '两回合',
        }
        r.append(m)
        r_by_winner[w] = m
    # ---- 1/4 决赛（4 场）----
    s, s_by_winner = [], {}
    for i, p in enumerate(by_round('1/4 决赛'), 1):
        ta, tb = p['teams']
        if ta not in r_by_winner or tb not in r_by_winner:
            raise SystemExit('1/4 决赛某队不是 1/8 决赛胜者：%s vs %s' % (ta, tb))
        w = p['winner']
        m = {'id': 'ucl-s%d' % i,
             'a': {'winnerOf': r_by_winner[ta]['id']},
             'b': {'winnerOf': r_by_winner[tb]['id']},
             'scoreA': p['agg'][ta], 'scoreB': p['agg'][tb],
             'winner': ('a' if w == ta else 'b') if w else None,
             'status': '已结束' if w else '进行中', 'format': '两回合'}
        s.append(m)
        s_by_winner[w] = m
    # ---- 半决赛（2 场）----
    f, f_by_winner = [], {}
    for i, p in enumerate(by_round('半决赛'), 1):
        ta, tb = p['teams']
        if ta not in s_by_winner or tb not in s_by_winner:
            raise SystemExit('半决赛某队不是 1/4 决赛胜者：%s vs %s' % (ta, tb))
        w = p['winner']
        m = {'id': 'ucl-f%d' % i,
             'a': {'winnerOf': s_by_winner[ta]['id']},
             'b': {'winnerOf': s_by_winner[tb]['id']},
             'scoreA': p['agg'][ta], 'scoreB': p['agg'][tb],
             'winner': ('a' if w == ta else 'b') if w else None,
             'status': '已结束' if w else '进行中', 'format': '两回合'}
        f.append(m)
        f_by_winner[w] = m
    # ---- 决赛（单场，含点球）----
    fp = by_round('决赛')[0]
    fta, ftb = fp['teams']
    if fta not in f_by_winner or ftb not in f_by_winner:
        raise SystemExit('决赛某队不是半决赛胜者：%s vs %s' % (fta, ftb))
    pen = ''
    if fp['pens']:
        pen = '（点球 %d-%d）' % (fp['pens'].get(fta, 0), fp['pens'].get(ftb, 0))
    final = {
        'name': '决赛', 'format': '单场决胜', 'venue': final_venue or '',
        'a': {'winnerOf': f_by_winner[fta]['id']},
        'b': {'winnerOf': f_by_winner[ftb]['id']},
        'scoreA': fp['agg'][fta], 'scoreB': fp['agg'][ftb],
        'winner': ('a' if fp['winner'] == fta else 'b') if fp['winner'] else None,
        'status': '已结束' if fp['winner'] else '进行中',
        'note': pen,
    }

    # ---- 分上下半区：每条半决赛 = 2 场 1/4 决赛胜者 → 归同一半区 ----
    def half_of(fm):
        ids = [fm['a']['winnerOf'], fm['b']['winnerOf']]
        s_ms = [next(x for x in s if x['id'] == i) for i in ids]      # 2 场 1/4 决赛
        r_ms = [next(x for x in r if x['id'] == sf['a']['winnerOf']) for sf in s_ms]  # 其来源 1/8 决赛
        q_ms = [next(x for x in q if x['id'] == rm['b']['winnerOf']) for rm in r_ms]  # 其来源附加赛
        return {'rounds': [
            {'name': '1/8 附加赛', 'format': '两回合', 'matches': q_ms},
            {'name': '1/8 决赛', 'format': '两回合', 'matches': r_ms},
            {'name': '1/4 决赛', 'format': '两回合', 'matches': s_ms},
            {'name': '半决赛', 'format': '两回合', 'matches': [fm]},
        ]}

    halves = [{'name': '上半区', **half_of(f[0])}, {'name': '下半区', **half_of(f[1])}]

    # ---- 联赛阶段摘要 ----
    # direct：1/8 决赛里「非附加赛胜者」的那 8 支直通队（按联赛阶段排名排）
    direct_teams = sorted({m['a']['name'] for m in r}, key=lambda n: seed_of.get(n, 99))
    if len(direct_teams) != 8:
        raise SystemExit('直通 16 强的队不是 8 支：%s' % direct_teams)
    playoff_teams = [t for p in by_round('1/8 决赛附加赛') for t in p['teams']]
    playoff_winners = [p['winner'] for p in by_round('1/8 决赛附加赛') if p['winner']]

    champ = fta if final['winner'] == 'a' else ftb
    print('  晋级图冠军：%s（决赛 %d-%d %s）' % (champ, final['scoreA'], final['scoreB'], pen))

    return {
        'season': '25-26', 'seasons': ['25-26'],
        'note': '25-26 赛季真实淘汰赛对阵（数据源：腾讯体育）。新赛制：36 队联赛阶段 → '
                '前 8 名直通 16 强，9-24 名经 1/8 附加赛争另外 8 席；1/8 决赛起为两回合，'
                '决赛单场。halves[].rounds[].matches[] 结构。',
        'leagueStage': {
            'title': '联赛阶段（8 轮）已结束',
            'direct': direct_teams,
            'playoffTeams': playoff_teams,
            'playoffWinners': playoff_winners,
            'note': '前 8 名直通 16 强；9-24 名（共 16 队）经 1/8 附加赛决出另外 8 席',
        },
        'halves': halves, 'final': final,
    }


def main():
    # 场馆与队徽：先取赛程日期，再按日期扫 ESPN / 腾讯
    dates = set()
    for win in (SEASON_2526, SEASON_2627):
        dates.update(sched(win).keys())
    dates = sorted(dates)

    venue_of = cn_venues('uefa.champions', dates, UCL_EN2CN)
    # 队徽走央视源（无防盗链）；央视接口只有 2026-2027 可用，36 队/35 带 logo
    TEAM_LOGOS.update(fetch_cctv_logos(CLID))

    sched_all = build_schedule(venue_of)
    n2526 = sum(1 for x in sched_all if x['seasonId'] == '25-26')
    n2627 = sum(1 for x in sched_all if x['seasonId'] == '26-27')
    st2526 = fetch_standings('2025-2026')
    st2627 = fetch_standings('2026-2027')
    scorers = fetch_scorers()
    ko = build_knockout()
    # 25-26 决赛单场、中立场（2026-05-30 于布达佩斯）
    final_venue = final_venue_of(['2026-05-30'])
    bk = build_bracket(st2526, final_venue)

    # ---- 自检 ----
    errs = []
    if len(st2526) != 36:
        errs.append('欧冠 25-26 积分榜不是 36 队：%d' % len(st2526))
    if len(st2627) != 36:
        errs.append('欧冠 26-27 积分榜不是 36 队：%d' % len(st2627))
    if len(ko['25-26']) != 23:
        errs.append('欧冠 25-26 淘汰赛对阵不是 23 组：%d' % len(ko['25-26']))
    if not scorers:
        errs.append('欧冠射手榜为空')
    if {r['played'] for r in st2526} != {8}:
        errs.append('欧冠 25-26 联赛阶段各队场次不是 8：%s'
                    % sorted({r['played'] for r in st2526}))
    nv = sum(1 for x in sched_all if not x.get('venue'))
    if nv:
        errs.append('欧冠赛程有 %d 场缺场馆' % nv)
    miss = []

    def chk(node):
        if isinstance(node, dict):
            if 'name' in node and 'abbr' in node and not node.get('logo'):
                miss.append(node['name'])
            for v in node.values():
                chk(v)
        elif isinstance(node, list):
            for v in node:
                chk(v)
    chk(bk)
    if miss:
        errs.append('欧冠晋级图有 %d 队缺队徽：%s' % (len(miss), sorted(set(miss))))
    if errs:
        raise SystemExit('自检未过：\n  - ' + '\n  - '.join(errs))

    import datetime
    data = {
        'leagueId': 'ucl',
        'leagueName': '欧冠',
        'sport': 'football',
        'emoji': '⚽',
        'desc': '欧洲冠军联赛 · 真实数据（赛程/淘汰赛：腾讯体育｜积分榜/射手榜/队徽：央视体育）'
                '｜25-26 完整赛季 · 26-27 联赛阶段进行中｜仅正赛，不含资格赛',
        'updatedAt': datetime.datetime.now().strftime('%Y-%m-%dT%H:%M:%S+08:00'),
        'tabs': ['schedule', 'standings', 'knockout', 'bracket', 'scorers', 'players'],
        'seasons': ['25-26', '26-27'],
        'defaultSeason': '25-26',
        'schedule': sched_all,
        'standings': {'25-26': st2526, '26-27': st2627},
        'knockout': ko,
        'bracket': bk,
        'scorers': scorers,
        'scorersSeason': '26-27',
        'scorersNote': '射手榜为 26-27 赛季实时数据（数据源：央视体育）；'
                       '25-26 赛季历史射手榜数据源不提供，故未收录',
        'players': {'25-26': [], '26-27': []},
        'playerNote': '欧冠球员赛季数据待数据源提供后上线',
    }

    out = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                        '..', 'data', 'ucl.json'))
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print('written', out)
    print('schedule  25-26: %d  26-27: %d（仅正赛）' % (n2526, n2627))
    print('standings 25-26: %d 队，第 1 名 %s（%d 分）' % (
        len(st2526), st2526[0]['teamName'], st2526[0]['points']))
    print('standings 26-27: %d 队，第 1 名 %s（%d 分）' % (
        len(st2627), st2627[0]['teamName'], st2627[0]['points']))
    print('knockout  25-26: %d 组对阵' % len(ko['25-26']))
    print('scorers   26-27: %d 人，首位 %s（%d 球）' % (
        len(scorers), scorers[0]['playerName'], scorers[0]['goals']))
    f = bk['final']
    print('bracket   决赛 %d-%d（a/b 为半决赛胜者引用），冠军端 = %s' % (
        f['scoreA'], f['scoreB'], f['winner']))


if __name__ == '__main__':
    main()

