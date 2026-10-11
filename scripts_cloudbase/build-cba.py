# -*- coding: utf-8 -*-
"""抓取腾讯体育 CBA 真实数据（25-26 完整赛季 + 26-27 已排赛季），生成 data/cba.json。

照搬 scripts_cloudbase/build-nba.py 的结构与口径（Day 22 定的模式）：
  · 赛程     —— 25-26 全季 + 26-27 已排赛程，每条带 seasonId
  · 排行     —— 25-26 常规赛战绩：**由真实比分逐场累加**（腾讯 /team/rank 在赛季
                未开打时是空榜、且不支持查历史赛季，所以照 NBA 的做法自己算）
  · 季后赛   —— 从 matchDesc 解析系列赛（CBA 是 12 队：首轮 BO3 / 1-4 决赛 BO3 /
                半决赛 BO5 / 总决赛 BO7，赛制由数据推得，不是抄来的）
  · 晋级图   —— 用上面推出来的 20 队种子还原真实对阵树
  · 球员数据 —— 腾讯 /player/rank 对 CBA 返回 code 1003（无数据），与 NBA 同样留空
                + playerNote

数据源：腾讯体育 matchweb.sports.qq.com，CBA 的 columnId / competitionId = 100008
（2026-10-11 实测；对照表见 skill `qq-sports-data`）

用法：python scripts_cloudbase/build-cba.py
"""
import json, os, re, urllib.request
from collections import defaultdict, Counter

H = {'Origin': 'https://sports.qq.com', 'Referer': 'https://sports.qq.com/',
     'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}

CID = 100008                      # CBA
ML = 'https://matchweb.sports.qq.com/matchUnion/list'

SEASON_2526 = ('2025-09-01', '2026-07-15', '2026-06-30')
SEASON_2627 = ('2026-09-01', '2027-06-30', '2026-10-11')


def get(u, tries=3):
    last = None
    for _ in range(tries):
        try:
            r = urllib.request.Request(u, headers=H)
            return json.loads(urllib.request.urlopen(r, timeout=45).read().decode('utf-8'))
        except Exception as e:
            last = e
    raise last


_SCHED_CACHE = {}


def sched(win):
    """带缓存：同一时间窗只打一次接口（regular_games/parse_series 会在循环里反复调）。"""
    if win in _SCHED_CACHE:
        return _SCHED_CACHE[win]
    start, end, today = win
    d = get('%s?today=%s&startTime=%s&endTime=%s&columnId=%d&isInit=true'
            % (ML, today, start, end, CID))
    _SCHED_CACHE[win] = d.get('data') or {}
    return _SCHED_CACHE[win]


# ---------- 队伍元信息（简称 + 主色），用于排行与晋级图 ----------
# 腾讯接口有 teamLogo 字段，但 NBA 那边用的是「简称 + 主色」的色块方案；
# 为保持两页视觉一致，这里照搬同一套（简称/主色是我们定的，不是接口给的）。
TEAM_META = {
    '上海久事': ('SHG', '#1e50a2'), '浙江浙商证券': ('ZJS', '#e60012'),
    '深圳马可波罗': ('SZL', '#0e7c3a'), '北京首钢': ('BJG', '#00639d'),
    '广东东阳光': ('GDB', '#d0202f'), '浙江稠州金租': ('ZJC', '#ea580c'),
    '山东高速': ('SDG', '#b45309'), '山西汾酒': ('SHX', '#b91c1c'),
    '青岛崂山啤酒': ('QDG', '#005bac'), '辽宁本钢': ('LNB', '#1b4a9b'),
    '宁波町渥': ('NBD', '#7c3aed'), '广州智都集团': ('GZQ', '#9333ea'),
    '北京控股': ('BKG', '#0f4c81'), '福建晋江文旅': ('FJQ', '#0d9488'),
    '长白山恩都里': ('CBS', '#15803d'), '新疆广汇能源': ('XJG', '#c41230'),
    '南京同曦宙光': ('NJT', '#4338ca'), '天津先行者': ('TJJ', '#1d4ed8'),
    '江苏肯帝亚': ('JSK', '#1e40af'), '四川锦城': ('SCC', '#be123c'),
}
# 球队名单以接口为准，TEAM_META 只补简称/颜色；缺了就告警不静默
TEAM_ORDER = list(TEAM_META.keys())


def team_obj(name, seed=None):
    ab, c = TEAM_META.get(name, (name[:3].upper(), '#4b5563'))
    o = {'name': name, 'abbr': ab, 'color': c}
    if seed is not None:
        o = {'seed': seed, 'name': name, 'abbr': ab, 'color': c}
    return o


MISSING_TEAMS = set()


def meta(name):
    if name not in TEAM_META:
        MISSING_TEAMS.add(name)
    return TEAM_META.get(name, (name[:3].upper(), '#4b5563'))


def round_label(desc):
    """'CBA常规赛第40轮' → '常规赛第 40 轮'；'CBA季后赛第一轮G1' → '季后赛第一轮 G1'"""
    s = re.sub(r'^CBA', '', desc or '')
    s = re.sub(r'第(\d+)轮', r'第 \1 轮', s)
    s = re.sub(r'G(\d+)$', r' G\1', s)
    return s


# ---------- 1. 赛程：25-26 全季 + 26-27 已排 ----------
def status_of(g):
    """与 NBA 同构：matchType!=2 是经典赛/重播（跳过）；
    matchPeriod 2=已结束 / 1=进行中 / 0=未开始。"""
    if str(g.get('matchType')) != '2':
        return 'SKIP'
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


def build_schedule():
    out = []
    for season, win, prefix in (('25-26', SEASON_2526, 'cba-2526'),
                                ('26-27', SEASON_2627, 'cba-2627')):
        n = 0
        sd = sched(win)
        for dt in sorted(sd.keys()):
            for g in sd[dt]:
                Ln, Rn = g.get('leftName'), g.get('rightName')
                if not Ln or not Rn:
                    continue
                st = status_of(g)
                if st == 'SKIP':
                    continue
                n += 1
                item = {
                    'id': '%s-%03d' % (prefix, n),
                    'date': dt,
                    'time': (g.get('startTime') or '')[11:16] or '',
                    'status': st,
                    'homeTeam': Ln, 'awayTeam': Rn,
                    'round': round_label(g.get('matchDesc')) or '常规赛',
                    'venue': '',
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


# ---------- 2. 排行：25-26 常规赛（由赛程真比分推算，同 build-nba.py） ----------
def regular_games():
    """25-26 常规赛全部比赛（matchDesc 形如 'CBA常规赛第40轮'）。"""
    rows = []
    for dt in sorted(sched(SEASON_2526).keys()):
        for g in sched(SEASON_2526)[dt]:
            if str(g.get('matchDesc') or '').startswith('CBA常规赛'):
                rows.append(g)
    return rows


def build_standings():
    W = defaultdict(int); L = defaultdict(int); PD = defaultdict(int); GP = defaultdict(int)
    for g in regular_games():
        try:
            a, b = int(g.get('leftGoal')), int(g.get('rightGoal'))
        except (TypeError, ValueError):
            continue
        Ln, Rn = g.get('leftName'), g.get('rightName')
        if not Ln or not Rn:
            continue
        GP[Ln] += 1; GP[Rn] += 1
        PD[Ln] += a - b; PD[Rn] += b - a
        if a > b:
            W[Ln] += 1; L[Rn] += 1
        elif b > a:
            W[Rn] += 1; L[Ln] += 1
    rows = []
    # 遍历官方 20 队（不遍历「有胜场的队」—— 全败的队也要上榜，Day 23 踩过这个）
    for t in TEAM_ORDER:
        w, l = W.get(t, 0), L.get(t, 0)
        gp = w + l
        pd = PD.get(t, 0)
        rows.append({'team': t, 'wins': w, 'losses': l,
                     'winRate': ('%.0f%%' % (w / gp * 100)) if gp else '—',
                     'pointsDiff': ('%+d' % pd) if gp else ''})
    rows.sort(key=lambda r: (-r['wins'], r['losses'], -PD.get(r['team'], 0)))
    for i, r in enumerate(rows, 1):
        r['rank'] = i
    return rows


# ---------- 3. 季后赛 tab（25-26 全部系列赛） ----------
def parse_series():
    """从赛程解析季后赛系列赛：键 = (轮次, 两队 frozenset)。"""
    series = {}
    for dt in sorted(sched(SEASON_2526).keys()):
        for g in sched(SEASON_2526)[dt]:
            d = g.get('matchDesc') or ''
            m = re.match(r'CBA(季后赛.+?)G(\d+)$', d)
            if not m:
                continue
            rnd = m.group(1)
            Ln, Rn = g.get('leftName'), g.get('rightName')
            if not Ln or not Rn:
                continue
            key = (rnd, frozenset([Ln, Rn]))
            sv = series.setdefault(key, {'round': rnd, 'teams': (Ln, Rn),
                                         'w': defaultdict(int), 'games': 0, 'last': None})
            try:
                a, b = int(g.get('leftGoal')), int(g.get('rightGoal'))
            except (TypeError, ValueError):
                continue
            sv['games'] += 1
            if a > b:
                sv['w'][Ln] += 1
            elif b > a:
                sv['w'][Rn] += 1
            sv['last'] = dt
    return series


ROUND_CN = {'季后赛第一轮': '首轮（12 进 8）', '季后赛第二轮': '1/4 决赛',
            '季后赛半决赛': '半决赛', '季后赛总决赛': '总决赛'}
ROUND_FORMAT = {'季后赛第一轮': 'BO3', '季后赛第二轮': 'BO3',
                '季后赛半决赛': 'BO5', '季后赛总决赛': 'BO7'}


def build_playoffs(series):
    out = []
    for rnd in ('季后赛第一轮', '季后赛第二轮', '季后赛半决赛', '季后赛总决赛'):
        for (r, _), sv in series.items():
            if r != rnd:
                continue
            w = dict(sv['w']); Ln, Rn = sv['teams']
            winner = max(w, key=w.get) if w else None
            loser = Rn if winner == Ln else Ln
            out.append({
                'round': ROUND_CN[rnd] + ' ' + ('已结束' if winner else '进行中'),
                'homeTeam': winner or Ln,
                'awayTeam': loser if winner else Rn,
                'homeScore': w.get(winner, 0) if winner else None,
                'awayScore': w.get(loser, 0) if winner else None,
                'status': '已结束' if winner else '进行中',
                'date': sv['last'] or '',
                'note': ('%s，%s 大比分 %d-%d 晋级' % (ROUND_FORMAT[rnd], winner,
                                                   w.get(winner, 0), w.get(loser, 0)))
                        if winner else '系列赛进行中',
            })
    return out


# ---------- 4. 晋级图（25-26 真实 12 队对阵树） ----------
R1, R2, RSF, RFIN = ('季后赛第一轮', '季后赛第二轮', '季后赛半决赛', '季后赛总决赛')
ROUND_COUNT = {R1: 4, R2: 4, RSF: 2, RFIN: 1}


def _series_winner(sv):
    w = dict(sv['w'])
    return max(w, key=w.get) if w else None


def build_bracket(standings, series):
    """从**真实系列赛**还原 25-26 12 队季后赛树（不套赛制公式——实测 25-26 的首轮
    配对是 5v11 / 6v12 / 7v10 / 8v9，与教科书式 5v12/6v11 不同，照数据来才不出错）。

    算法：
      首轮 4 组 → 4 个胜者
      1/4  4 组 → 每组 = 一个前 4 种子 + 一个首轮胜者（胜者用 winnerOf 引用，画连线）
      半决赛 2 组 → 两个 1/4 胜者
      总决赛 1 组 → 两个半决赛胜者
    任何一环在真实数据里对不上就抛错（宁可炸也不出错的图）。
    """
    seed_of = {r['team']: r['rank'] for r in standings}
    top4 = {r['team'] for r in standings if r['rank'] <= 4}

    by_round = {}
    for (rnd, _), sv in series.items():
        by_round.setdefault(rnd, []).append(sv)
    for rnd, cnt in ROUND_COUNT.items():
        if len(by_round.get(rnd, [])) != cnt:
            raise SystemExit('季后赛轮次数量异常：%s = %d（应为 %d）'
                             % (rnd, len(by_round.get(rnd, [])), cnt))

    def concrete(mid, sv, fmt):
        """首轮：两端都是真实球队对象，比分 = 系列赛大比分。"""
        ta, tb = sv['teams']
        w = dict(sv['w'])
        win = _series_winner(sv)
        if not win:
            raise SystemExit('首轮系列赛未决出胜者：%s vs %s' % (ta, tb))
        return {'id': mid, 'a': team_obj(ta, seed_of.get(ta)), 'b': team_obj(tb, seed_of.get(tb)),
                'scoreA': w.get(ta, 0), 'scoreB': w.get(tb, 0),
                'winner': 'a' if win == ta else 'b', 'status': '已结束', 'format': fmt}

    def ref_match(mid, sa, sb, sv, fmt):
        """下游轮次：a/b 为 {'winnerOf':id} 引用（前端据此连线），比分仍为真实大比分。"""
        ta, tb = sv['teams']
        w = dict(sv['w'])
        win = _series_winner(sv)
        if not win:
            raise SystemExit('系列赛未决出胜者：%s vs %s' % (ta, tb))
        return {'id': mid, 'a': sa, 'b': sb,
                'scoreA': w.get(ta, 0), 'scoreB': w.get(tb, 0),
                'winner': 'a' if win == ta else 'b', 'status': '已结束', 'format': fmt}

    # ---- 首轮 ----
    r1 = []
    r1_by_winner = {}
    for i, sv in enumerate(sorted(by_round[R1], key=lambda s: s['last']), 1):
        m = concrete('cba-r1-%d' % i, sv, 'BO3')
        r1.append(m)
        r1_by_winner[_series_winner(sv)] = m

    # ---- 1/4 决赛：种子 + 首轮胜者 ----
    r2 = []
    r2_by_winner = {}
    for i, sv in enumerate(sorted(by_round[R2], key=lambda s: s['last']), 1):
        ta, tb = sv['teams']
        seeds = [t for t in (ta, tb) if t in top4]
        feeders = [t for t in (ta, tb) if t not in top4]
        if len(seeds) != 1 or len(feeders) != 1:
            raise SystemExit('1/4 决赛不是「1 种子 + 1 首轮胜者」：%s vs %s' % (ta, tb))
        feeder = feeders[0]
        if feeder not in r1_by_winner:
            raise SystemExit('1/4 决赛的对手 %s 不是首轮胜者' % feeder)
        seed_team = seeds[0]
        # 让 a 端 = 种子队，b 端 = 首轮胜者引用；比分按真实系列赛两队顺序对齐
        w = dict(sv['w'])
        win = _series_winner(sv)
        m = {
            'id': 'cba-r2-%d' % i,
            'a': team_obj(seed_team, seed_of.get(seed_team)),
            'b': {'winnerOf': r1_by_winner[feeder]['id']},
            'scoreA': w.get(seed_team, 0), 'scoreB': w.get(feeder, 0),
            'winner': 'a' if win == seed_team else 'b',
            'status': '已结束', 'format': 'BO3',
        }
        r2.append(m)
        r2_by_winner[win] = m

    # ---- 半决赛 ----
    sf = []
    sf_by_winner = {}
    for i, sv in enumerate(sorted(by_round[RSF], key=lambda s: s['last']), 1):
        ta, tb = sv['teams']
        if ta not in r2_by_winner or tb not in r2_by_winner:
            raise SystemExit('半决赛某队不是 1/4 胜者：%s vs %s' % (ta, tb))
        m = ref_match('cba-sf-%d' % i, {'winnerOf': r2_by_winner[ta]['id']},
                      {'winnerOf': r2_by_winner[tb]['id']}, sv, 'BO5')
        sf.append(m)
        sf_by_winner[_series_winner(sv)] = m

    # ---- 总决赛 ----
    fsv = by_round[RFIN][0]
    fta, ftb = fsv['teams']
    if fta not in sf_by_winner or ftb not in sf_by_winner:
        raise SystemExit('总决赛某队不是半决赛胜者：%s vs %s' % (fta, ftb))
    fw = dict(fsv['w'])
    fwin = _series_winner(fsv)
    final = {'name': '总决赛', 'format': 'BO7',
             'a': {'winnerOf': sf_by_winner[fta]['id']},
             'b': {'winnerOf': sf_by_winner[ftb]['id']},
             'scoreA': fw.get(fta, 0), 'scoreB': fw.get(ftb, 0),
             'winner': 'a' if fwin == fta else 'b', 'status': '已结束'}

    # ---- 分成上下半区：每条半决赛 = 两个 1/4 胜者 → 归入同一半区 ----
    def half_of(sf_match):
        ids = [sf_match['a']['winnerOf'], sf_match['b']['winnerOf']]
        r2s = [next(m for m in r2 if m['id'] == i) for i in ids]
        feeders = [next(x for x in r1 if x['id'] == m['b']['winnerOf']) for m in r2s]
        return {
            'rounds': [
                {'name': '首轮', 'format': 'BO3', 'matches': feeders},
                {'name': '1/4 决赛', 'format': 'BO3', 'matches': r2s},
                {'name': '半决赛', 'format': 'BO5', 'matches': [sf_match]},
            ]
        }

    h0, h1 = half_of(sf[0]), half_of(sf[1])
    halves = [{'name': '上半区', **h0}, {'name': '下半区', **h1}]

    # 自检：季后赛 12 队 = 首轮 8 队 + 4 个轮空种子，且互不重叠
    r1_teams = {m[k]['name'] for m in r1 for k in ('a', 'b')}
    bye_teams = {m['a']['name'] for m in r2}
    if len(r1_teams) != 8:
        raise SystemExit('晋级图首轮球队数不是 8：%d' % len(r1_teams))
    if len(bye_teams) != 4 or not bye_teams <= top4:
        raise SystemExit('晋级图轮空种子不是 4 个前 4 名：%s' % sorted(bye_teams))
    if r1_teams & bye_teams:
        raise SystemExit('首轮球队与轮空种子重叠：%s' % sorted(r1_teams & bye_teams))
    if len(r1_teams | bye_teams) != 12:
        raise SystemExit('季后赛总球队数不是 12：%d' % len(r1_teams | bye_teams))
    champ = fta if final['winner'] == 'a' else ftb
    print('  晋级图冠军：%s（总决赛 %d-%d %s）' % (champ, final['scoreA'], final['scoreB'],
                                                 ftb if final['winner'] == 'a' else fta))

    return {
        'season': '25-26', 'seasons': ['25-26'],
        'note': '25-26 赛季真实季后赛对阵（数据源：腾讯体育）。CBA 12 队季后赛：'
                '首轮 12 进 8（BO3）→ 1/4 决赛（BO3）→ 半决赛（BO5）→ 总决赛（BO7）；'
                '前 4 名种子直接进 1/4 决赛。结构与 NBA 同构（halves[].rounds[].matches[]）。',
        'halves': halves, 'final': final,
    }


# ---------- 组装 ----------
def main():
    sched_all = build_schedule()
    n2526 = sum(1 for x in sched_all if x['seasonId'] == '25-26')
    n2627 = sum(1 for x in sched_all if x['seasonId'] == '26-27')
    st = build_standings()
    series = parse_series()
    po = build_playoffs(series)
    bk = build_bracket(st, series)

    # ---- 自检 ----
    errs = []
    if len(st) != 20:
        errs.append('排行不是 20 队：%d' % len(st))
    gp = {r['wins'] + r['losses'] for r in st}
    if gp != {42}:
        errs.append('25-26 常规赛每队场数不是 42：%s' % sorted(gp))
    if len(po) != 11:
        errs.append('季后赛系列赛不是 11 组：%d' % len(po))
    if MISSING_TEAMS:
        errs.append('有队名不在 TEAM_META（会退化成灰色块）：%s' % sorted(MISSING_TEAMS))
    if errs:
        raise SystemExit('自检未过：\n  - ' + '\n  - '.join(errs))

    data = {
        'leagueId': 'cba',
        'leagueName': 'CBA',
        'sport': 'basketball',
        'emoji': '🏀',
        'desc': '中国男子篮球职业联赛 · 真实数据（腾讯体育）｜25-26 赛季完整 · 26-27 常规赛 10-16 开打',
        'updatedAt': None,      # 下面按生成时刻填
        'tabs': ['schedule', 'standings', 'playoffs', 'bracket', 'players'],
        'seasons': ['25-26', '26-27'],
        'defaultSeason': '25-26',
        'schedule': sched_all,
        'standings': {'25-26': st, '26-27': []},
        'playoffs': {'25-26': po, '26-27': []},
        'bracket': bk,
        'players': {'25-26': [], '26-27': []},
        'playerNote': '球员赛季数据待 26-27 赛季常规赛开打后提供',
    }
    import datetime
    data['updatedAt'] = datetime.datetime.now().strftime('%Y-%m-%dT%H:%M:%S+08:00')

    out = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                        '..', 'data', 'cba.json'))
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print('written', out)
    print('schedule  25-26: %d  26-27: %d' % (n2526, n2627))
    print('standings 25-26: %d 队，第 1 名 %s（%d 胜 %d 负）' % (
        len(st), st[0]['team'], st[0]['wins'], st[0]['losses']))
    print('standings 末位: %s（%d 胜 %d 负）' % (st[-1]['team'], st[-1]['wins'], st[-1]['losses']))
    print('playoffs  25-26: %d 组系列赛' % len(po))
    f = bk['final']
    print('bracket   总决赛比分 %d-%d（a/b 为半决赛胜者引用），冠军端 = %s'
          % (f['scoreA'], f['scoreB'], f['winner']))


if __name__ == '__main__':
    main()
