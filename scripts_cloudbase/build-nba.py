# -*- coding: utf-8 -*-
"""抓取腾讯体育 NBA 真实数据（25-26 完整赛季 + 26-27 当前赛季），生成 data/nba.json。
用法：python build-nba.py
"""
import json, urllib.request, re, os, sys
from collections import defaultdict, OrderedDict

H = {'Origin': 'https://sports.qq.com', 'Referer': 'https://sports.qq.com/',
     'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}

def get(u, tries=3):
    last = None
    for _ in range(tries):
        try:
            r = urllib.request.Request(u, headers=H)
            return json.loads(urllib.request.urlopen(r, timeout=45).read().decode('utf-8'))
        except Exception as e:
            last = e
    raise last

ML = 'https://matchweb.sports.qq.com/matchUnion/list'

def sched(start, end, today=None):
    today = today or end
    d = get(f'{ML}?today={today}&startTime={start}&endTime={end}&columnId=100000&isInit=true')
    return d.get('data') or {}

# ---------- 队伍元信息（英文简称 + 主色），用于晋级图 ----------
TEAM_META = {
 '活塞': ('DET', '#c8102e'), '凯尔特人': ('BOS', '#007a33'), '尼克斯': ('NYK', '#f58426'),
 '骑士': ('CLE', '#860038'), '猛龙': ('TOR', '#ce1141'), '老鹰': ('ATL', '#e03a3e'),
 '76人': ('PHI', '#006bb6'), '魔术': ('ORL', '#0077c0'), '黄蜂': ('CHA', '#1d1160'),
 '热火': ('MIA', '#98002e'), '雄鹿': ('MIL', '#00471b'), '公牛': ('CHI', '#ce1141'),
 '篮网': ('BKN', '#000000'), '步行者': ('IND', '#002d62'), '奇才': ('WAS', '#002b5c'),
 '雷霆': ('OKC', '#007ac1'), '马刺': ('SAS', '#6f7683'), '掘金': ('DEN', '#0e2240'),
 '湖人': ('LAL', '#552583'), '火箭': ('HOU', '#ce1141'), '森林狼': ('MIN', '#33455e'),
 '太阳': ('PHX', '#e56020'), '开拓者': ('POR', '#e03a3e'), '快船': ('LAC', '#c8102e'),
 '勇士': ('GSW', '#1d428a'), '鹈鹕': ('NOP', '#0c2340'), '独行侠': ('DAL', '#00538c'),
 '灰熊': ('MEM', '#5d76a9'), '国王': ('SAC', '#5a2d81'), '爵士': ('UTA', '#002b5c'),
}

def meta(name):
    ab, c = TEAM_META.get(name, (name[:3].upper(), '#4b5563'))
    return ab, c

def team_obj(name, seed=None):
    ab, c = meta(name)
    o = {'name': name, 'abbr': ab, 'color': c}
    if seed is not None:
        o = {'seed': seed, 'name': name, 'abbr': ab, 'color': c}
    return o

# ---------- 1. 赛程：25-26 全季 + 26-27 当前 ----------
def status_of(g, a, b):
    """真实状态：matchType!=2 是经典赛/重播（非真实对阵，跳过）；
    matchPeriod 2=已结束 / 1=进行中 / 0=未开始。"""
    if str(g.get('matchType')) != '2':
        return 'SKIP'
    per = str(g.get('matchPeriod'))
    if per == '2':
        return '已结束' if a is not None else '未开始'
    if per == '1':
        return '进行中'
    return '未开始'

def build_schedule():
    out = []
    n = 0
    # 25-26 完整赛季
    sd = sched('2025-09-25', '2026-07-15', today='2026-06-30')
    for dt in sorted(sd.keys()):
        for g in sd[dt]:
            desc = g.get('matchDesc') or ''
            Ln, Rn = g.get('leftName'), g.get('rightName')
            if not Ln or not Rn:
                continue
            try:
                a, b = int(g.get('leftGoal')), int(g.get('rightGoal'))
            except (TypeError, ValueError):
                a = b = None
            st = status_of(g, a, b)
            if st == 'SKIP':
                continue
            n += 1
            item = {
                'id': 'nba-2526-%03d' % n,
                'date': dt,
                'time': (g.get('startTime') or '')[11:16] or '',
                'status': st,
                'homeTeam': Ln, 'awayTeam': Rn,
                'round': desc.replace('NBA', '') or '常规赛',
                'venue': '',
                'seasonId': '25-26',
            }
            if st in ('已结束', '进行中') and a is not None:
                item['homeScore'] = a; item['awayScore'] = b
            out.append(item)
    # 26-27 当前赛季（季前赛/常规赛）
    sd2 = sched('2026-09-25', '2026-11-30', today='2026-10-09')
    for dt in sorted(sd2.keys()):
        for g in sd2[dt]:
            desc = g.get('matchDesc') or ''
            Ln, Rn = g.get('leftName'), g.get('rightName')
            if not Ln or not Rn:
                continue
            try:
                a, b = int(g.get('leftGoal')), int(g.get('rightGoal'))
            except (TypeError, ValueError):
                a = b = None
            st = status_of(g, a, b)
            if st == 'SKIP':
                continue
            n += 1
            item = {
                'id': 'nba-2627-%03d' % n,
                'date': dt,
                'time': (g.get('startTime') or '')[11:16] or '',
                'status': st,
                'homeTeam': Ln, 'awayTeam': Rn,
                'round': desc.replace('NBA', '') or '常规赛',
                'venue': '',
                'seasonId': '26-27',
            }
            if st in ('已结束', '进行中') and a is not None:
                item['homeScore'] = a; item['awayScore'] = b
            out.append(item)
    return out

# ---------- 2. 排行：25-26 常规赛（由赛程推算） ----------
EAST = {'活塞','凯尔特人','尼克斯','骑士','猛龙','老鹰','76人','魔术','黄蜂','热火','雄鹿','公牛','篮网','步行者','奇才'}
WEST = {'雷霆','马刺','掘金','湖人','火箭','森林狼','太阳','开拓者','快船','勇士','鹈鹕','独行侠','灰熊','国王','爵士'}

def build_standings():
    W = defaultdict(int); L = defaultdict(int); PD = defaultdict(int)
    sd = sched('2025-09-25', '2026-04-15', today='2026-04-15')
    for dt, games in sd.items():
        for g in games:
            if (g.get('matchDesc') or '') != 'NBA常规赛':
                continue
            try:
                a, b = int(g.get('leftGoal')), int(g.get('rightGoal'))
            except (TypeError, ValueError):
                continue
            Ln, Rn = g.get('leftName'), g.get('rightName')
            if not Ln or not Rn:
                continue
            # 净胜分：该队赛季总得分 − 总失分（正负带符号）
            PD[Ln] += a - b
            PD[Rn] += b - a
            if a > b: W[Ln] += 1; L[Rn] += 1
            elif b > a: W[Rn] += 1; L[Ln] += 1
    res = {}
    for conf, grp in [('东部', EAST), ('西部', WEST)]:
        rows = []
        for t in grp:
            w, l = W.get(t, 0), L.get(t, 0)
            gp = w + l
            pd = PD.get(t, 0)
            rows.append({'team': t, 'wins': w, 'losses': l,
                         'winRate': ('%.0f%%' % (w / gp * 100)) if gp else '—',
                         'pointsDiff': ('%+d' % pd) if gp else ''})
        rows.sort(key=lambda r: (-r['wins'], r['losses']))
        for i, r in enumerate(rows, 1):
            r['rank'] = i
        res[conf] = rows
    return res

# ---------- 3. 季后赛 tab（25-26 全部系列赛） ----------
def build_playoffs():
    sd = sched('2025-09-25', '2026-07-15', today='2026-06-30')
    series = OrderedDict()
    for dt in sorted(sd.keys()):
        for g in sd[dt]:
            d = g.get('matchDesc') or ''
            m = re.match(r'NBA(季后赛(?:东部|西部)?(?:首轮|半决赛|决赛)|总决赛)G(\d+)$', d)
            if not m:
                continue
            rnd = m.group(1); gm = int(m.group(2))
            Ln, Rn = g.get('leftName'), g.get('rightName')
            key = (rnd, frozenset([Ln, Rn]))
            sv = series.setdefault(key, {'round': rnd, 'teams': (Ln, Rn), 'w': defaultdict(int), 'last': None})
            try:
                a, b = int(g.get('leftGoal')), int(g.get('rightGoal'))
            except (TypeError, ValueError):
                continue
            if a > b: sv['w'][Ln] += 1
            elif b > a: sv['w'][Rn] += 1
            sv['last'] = dt
    ROUND_CN = {'季后赛东部首轮':'东部首轮','季后赛东部半决赛':'东部半决赛','季后赛东部决赛':'东部决赛',
                '季后赛西部首轮':'西部首轮','季后赛西部半决赛':'西部半决赛','季后赛西部决赛':'西部决赛',
                '总决赛':'总决赛'}
    out = []
    order = list(ROUND_CN.keys())
    for rnd in order:
        for k, sv in series.items():
            if sv['round'] != rnd:
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
                'note': f"七战四胜制，{winner} 大比分 {w.get(winner,0)}-{w.get(loser,0)} 晋级" if winner
                        else '系列赛进行中',
            })
    return out

# ---------- 4. 晋级图（25-26 真实分区对阵） ----------
def build_bracket():
    # 依据真实首轮对阵与结果（来自赛程），种子按常规赛排名
    E = ['活塞','凯尔特人','骑士','尼克斯','76人','老鹰','黄蜂','猛龙']
    Wt = ['雷霆','马刺','掘金','火箭','湖人','森林狼','太阳','开拓者']
    eseed = {t: i + 1 for i, t in enumerate(E)}
    wseed = {t: i + 1 for i, t in enumerate(Wt)}
    # 真实首轮对阵（胜者, 负者, 胜场, 负场）
    e_r1 = [('活塞','魔术',4,3), ('骑士','猛龙',4,3), ('尼克斯','老鹰',4,2), ('凯尔特人','76人',3,4)]
    w_r1 = [('雷霆','开拓者',4,1), ('火箭','湖人',4,2), ('掘金','森林狼',2,4), ('马刺','太阳',4,1)]
    e_r2 = [('骑士','活塞',4,3), ('尼克斯','76人',4,0)]   # 半决赛
    w_r2 = [('马刺','森林狼',4,2), ('雷霆','湖人',4,0)]
    e_f  = ('尼克斯','骑士',4,0)
    w_f  = ('马刺','雷霆',4,3)
    fin  = ('尼克斯','马刺',4,1)

    def mt(winner, loser, ws, ls, m_id):
        # a = 高种子（或胜者常驻左侧）；这里让 a 恒为胜者一侧便于阅读？不 —— 保持原始左右
        return None

    # 手工按“左(a)/右(b)”顺序构造，保证 winner 标记正确
    def M(mid, ta, tb, sa, sb):
        return {'id': mid, 'a': team_obj(ta[0], ta[1]), 'b': team_obj(tb[0], tb[1]),
                'scoreA': sa, 'scoreB': sb,
                'winner': 'a' if sa > sb else ('b' if sb > sa else None), 'status': '已结束'}

    halves = [
        {'name': '东部', 'rounds': [
            {'name': '首轮', 'format': 'BO7', 'matches': [
                M('nba-e1', ('活塞', eseed['活塞']), ('魔术', None), 4, 3),
                M('nba-e2', ('骑士', eseed['骑士']), ('猛龙', eseed['猛龙']), 4, 3),
                M('nba-e3', ('尼克斯', eseed['尼克斯']), ('老鹰', eseed['老鹰']), 4, 2),
                M('nba-e4', ('凯尔特人', eseed['凯尔特人']), ('76人', eseed['76人']), 3, 4),
            ]},
            {'name': '半决赛', 'format': 'BO7', 'matches': [
                {'id': 'nba-e5', 'a': {'winnerOf': 'nba-e1'}, 'b': {'winnerOf': 'nba-e2'},
                 'scoreA': 3, 'scoreB': 4, 'winner': 'b', 'status': '已结束'},
                {'id': 'nba-e6', 'a': {'winnerOf': 'nba-e3'}, 'b': {'winnerOf': 'nba-e4'},
                 'scoreA': 4, 'scoreB': 0, 'winner': 'a', 'status': '已结束'},
            ]},
            {'name': '东部决赛', 'format': 'BO7', 'matches': [
                {'id': 'nba-e7', 'a': {'winnerOf': 'nba-e5'}, 'b': {'winnerOf': 'nba-e6'},
                 'scoreA': 0, 'scoreB': 4, 'winner': 'b', 'status': '已结束'},
            ]},
        ]},
        {'name': '西部', 'rounds': [
            {'name': '首轮', 'format': 'BO7', 'matches': [
                M('nba-w1', ('雷霆', wseed['雷霆']), ('开拓者', wseed['开拓者']), 4, 1),
                M('nba-w2', ('火箭', wseed['火箭']), ('湖人', wseed['湖人']), 4, 2),
                M('nba-w3', ('掘金', wseed['掘金']), ('森林狼', wseed['森林狼']), 2, 4),
                M('nba-w4', ('马刺', wseed['马刺']), ('太阳', wseed['太阳']), 4, 1),
            ]},
            {'name': '半决赛', 'format': 'BO7', 'matches': [
                {'id': 'nba-w5', 'a': {'winnerOf': 'nba-w1'}, 'b': {'winnerOf': 'nba-w3'},
                 'scoreA': 4, 'scoreB': 2, 'winner': 'a', 'status': '已结束'},
                {'id': 'nba-w6', 'a': {'winnerOf': 'nba-w2'}, 'b': {'winnerOf': 'nba-w4'},
                 'scoreA': 0, 'scoreB': 4, 'winner': 'b', 'status': '已结束'},
            ]},
            {'name': '西部决赛', 'format': 'BO7', 'matches': [
                {'id': 'nba-w7', 'a': {'winnerOf': 'nba-w5'}, 'b': {'winnerOf': 'nba-w6'},
                 'scoreA': 3, 'scoreB': 4, 'winner': 'b', 'status': '已结束'},
            ]},
        ]},
    ]
    return {
        'season': '25-26', 'seasons': ['25-26'],
        'note': '25-26 赛季真实季后赛对阵（数据源：腾讯体育）。结构约定见 league.js：halves[].rounds[].matches[]；'
                'a/b 可写具体队伍 {seed,name,abbr,color} 或引用 {"winnerOf":"上一场id"}；scoreA/scoreB 为系列赛大比分。',
        'halves': halves,
        'final': {'name': '总决赛', 'format': 'BO7', 'a': {'winnerOf': 'nba-e7'}, 'b': {'winnerOf': 'nba-w7'},
                  'scoreA': 4, 'scoreB': 1, 'winner': 'a', 'status': '已结束'},
    }

# ---------- 组装 ----------
def main():
    sched_all = build_schedule()
    n2526 = sum(1 for x in sched_all if x['seasonId'] == '25-26')
    n2627 = sum(1 for x in sched_all if x['seasonId'] == '26-27')
    st = build_standings()
    po = build_playoffs()
    bk = build_bracket()

    # 排行为对象：season -> { 东部:[], 西部:[] }
    standings = {
        '25-26': st,
        '26-27': {'东部': [], '西部': []},
    }
    # 季后赛：按赛季
    playoffs = {'25-26': po, '26-27': []}

    data = {
        'leagueId': 'nba',
        'leagueName': 'NBA',
        'sport': 'basketball',
        'emoji': '🏀',
        'desc': '美职篮 · 真实数据（腾讯体育）｜25-26 赛季完整 · 26-27 赛季进行中',
        'updated_at': '2026-10-09T11:50:00+08:00',
        'tabs': ['schedule', 'standings', 'playoffs', 'bracket', 'players'],
        'seasons': ['25-26', '26-27'],
        'defaultSeason': '25-26',
        'schedule': sched_all,
        'standings': standings,
        'playoffs': playoffs,
        'bracket': bk,
        'players': {'25-26': [], '26-27': []},
        'playerNote': '球员赛季数据待 26-27 赛季常规赛开打后提供',
    }
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'nba.json')
    out = os.path.normpath(out)
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print('written', out)
    print('schedule 25-26:', n2526, ' 26-27:', n2627)
    print('playoffs 25-26 series:', len(po))
    print('standings east/west:', len(st['东部']), len(st['西部']))

if __name__ == '__main__':
    main()
