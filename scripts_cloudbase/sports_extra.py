# -*- coding: utf-8 -*-
"""球队「场馆」与「队徽」补充（供 build-epl.py / build-ucl.py 共用）。

为什么要单独一个模块：
  · 腾讯体育（赛程）与央视体育（积分榜/射手榜）都**不提供场馆**，只能另找源；
    ESPN 公开 API 提供「主队 -> 主场」的真实场馆，按主队映射即可覆盖全部场次。
  · 队徽两边都给（腾讯 leftBadge/rightBadge；央视 logoUrl），但**译名口径不同**，
    所以按「该处数据来自哪个源」选对应的一套，不能混用。
  · 场馆原名是英文 —— 本模块带一份中文译名表，输出中文场馆名。

用法：
    from sports_extra import attach_schedule_venue, attach_team_logo, fetch_logos, ...
"""
import json, urllib.request

# ---------- 源配置 ----------
ESPN = 'https://site.api.espn.com/apis/site/v2/sports/soccer/{key}/scoreboard?dates={d}&limit=200'
TH = {'Origin': 'https://sports.qq.com', 'Referer': 'https://sports.qq.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
CH = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Referer': 'https://cbs.sports.cctv.com/', 'Origin': 'https://cbs.sports.cctv.com',
      'Accept': 'application/json'}
ML = 'https://matchweb.sports.qq.com/matchUnion/list'
CB = 'https://cbs-u.sports.cctv.com'


def _get(u, h, t=45, tries=3):
    last = None
    for _ in range(tries):
        try:
            return json.loads(urllib.request.urlopen(urllib.request.Request(u, headers=h), timeout=t)
                              .read().decode('utf-8', 'ignore'))
        except Exception as e:
            last = e
    raise last


# ---------- 场馆 ----------
def fetch_venues(espn_key, dates):
    """按比赛日扫 ESPN，累积「英文主队 -> 场馆」。同一个主队多个主场时，后出现的覆盖前值
    （巴萨 25-26 中途搬回诺坎普 → 取诺坎普；两处都属真实历史，此档误差可接受）。"""
    h2v = {}
    for dd in dates:
        ds = dd.replace('-', '')
        try:
            j = _get(ESPN.format(key=espn_key, d=ds), {'User-Agent': TH['User-Agent']})
        except Exception:
            continue
        for e in (j.get('events') or []):
            comp = (e.get('competitions') or [{}])[0]
            home = None
            for t in (comp.get('competitors') or []):
                if t.get('homeAway') == 'home':
                    home = ((t.get('team') or {}).get('displayName'))
            v = (comp.get('venue') or {}).get('fullName')
            if home and v:
                h2v[home] = v
    return h2v


# ---------- 队徽 ----------
def fetch_cctv_logos(league_id):
    """央视积分榜 → 中文队名 -> logoUrl（两赛季合并）。键为**央视口径**队名。"""
    m = {}
    for season in ['2025-2026', '2026-2027']:
        try:
            d = _get('%s/statistics/football/team/rankings?leagueId=%d&client=pc&season=%s'
                     % (CB, league_id, season), CH)
            rs = (d.get('results') or [{}])[0].get('rankings', [{}])[0].get('ranking', [])
            for t in rs:
                if t.get('teamName') and t.get('logoUrl'):
                    m.setdefault(t['teamName'], t['logoUrl'])
        except Exception:
            pass
    return m


def fetch_qq_badges(column_id, dates):
    """腾讯赛程 → 中文队名 -> badge。键为**腾讯口径**队名。"""
    m = {}
    for dd in dates:
        try:
            d = _get('%s?today=%s&startTime=%s&endTime=%s&columnId=%d&isInit=true'
                     % (ML, dd, dd, dd, column_id), TH)
        except Exception:
            continue
        for dt, gs in (d.get('data') or {}).items():
            for g in gs:
                for nm, bd in ((g.get('leftName'), g.get('leftBadge')),
                               (g.get('rightName'), g.get('rightBadge'))):
                    if nm and bd:
                        m.setdefault(nm, bd)
    return m


# ---------- 英文队名 -> 中文队名（ESPN 口径 -> 腾讯赛程口径，本项目数据用的就是这套） ----------
EPL_EN2CN = {'Arsenal': '阿森纳', 'Manchester City': '曼城', 'Manchester United': '曼联', 'Aston Villa': '阿斯顿维拉', 'Liverpool': '利物浦', 'AFC Bournemouth': '伯恩茅斯', 'Sunderland': '桑德兰', 'Brighton & Hove Albion': '布莱顿', 'Brentford': '布伦特福德', 'Chelsea': '切尔西', 'Fulham': '富勒姆', 'Newcastle United': '纽卡斯尔联', 'Everton': '埃弗顿', 'Leeds United': '利兹联', 'Crystal Palace': '水晶宫', 'Nottingham Forest': '诺丁汉森林', 'Tottenham Hotspur': '托特纳姆热刺', 'West Ham United': '西汉姆联', 'Burnley': '伯恩利', 'Wolverhampton Wanderers': '狼队', 'Hull City': '赫尔城', 'Ipswich Town': '伊普斯维奇', 'Coventry City': '考文垂'}

UCL_EN2CN = {'AEK Athens': '雅典AEK', 'AS Monaco': '摩纳哥', 'AS Roma': '罗马', 'Ajax Amsterdam': '阿贾克斯', 'Arsenal': '阿森纳', 'Aston Villa': '阿斯顿维拉', 'Atalanta': '亚特兰大', 'Athletic Club': '毕尔巴鄂', 'Atlético Madrid': '马德里竞技', 'Barcelona': '巴塞罗那', 'Bayer Leverkusen': '勒沃库森', 'Bayern Munich': '拜仁慕尼黑', 'Benfica': '本菲卡', 'Bodo/Glimt': '博德闪耀', 'Borussia Dortmund': '多特蒙德', 'Chelsea': '切尔西', 'Club Brugge': '布鲁日', 'Como': '科莫', 'Eintracht Frankfurt': '法兰克福', 'F.C. København': '哥本哈根', 'FC Porto': '波尔图', 'FK Qarabag': '卡拉巴克', 'Fenerbahce': '费内巴切', 'Feyenoord Rotterdam': '费耶诺德', 'Galatasaray': '加拉塔萨雷', 'Internazionale': '国际米兰', 'Juventus': '尤文图斯', 'Kairat Almaty': '凯拉特', 'LASK Linz': '林茨', 'Lens': '朗斯', 'Lille': '里尔', 'Liverpool': '利物浦', 'Manchester City': '曼城', 'Manchester United': '曼联', 'Marseille': '马赛', 'Napoli': '那不勒斯', 'Newcastle United': '纽卡斯尔联', 'Olympiacos': '奥林匹亚科斯', 'PSV Eindhoven': '埃因霍温', 'Pafos': '帕福斯FC', 'Paris Saint-Germain': '巴黎圣日耳曼', 'RB Leipzig': 'RB莱比锡', 'Real Betis': '贝蒂斯', 'Real Madrid': '皇家马德里', 'Sabah FK': '萨巴赫', 'Shakhtar Donetsk': '顿涅茨克矿工', 'Slavia Prague': '布拉格斯拉维亚', 'Slovan Bratislava': '布拉迪斯拉发', 'Sporting CP': '葡萄牙体育', 'Tottenham Hotspur': '托特纳姆热刺', 'Union St.-Gilloise': '圣吉罗斯', 'VfB Stuttgart': '斯图加特', 'Viking FK': '维京', 'Villarreal': '比利亚雷亚尔'}


# ---------- 场馆英文 -> 中文（通用译法） ----------
VENUE_CN = {
    'Anfield': '安菲尔德',
    'Emirates Stadium': '酋长球场',
    'Etihad Stadium': '伊蒂哈德球场',
    'Old Trafford': '老特拉福德',
    'Villa Park': '维拉公园',
    'Stamford Bridge': '斯坦福桥',
    'Tottenham Hotspur Stadium': '托特纳姆热刺球场',
    "St. James' Park": '圣詹姆斯公园',
    'London Stadium': '伦敦体育场',
    'Vitality Stadium': '活力球场',
    'American Express Stadium': '美国运通球场',
    'Craven Cottage': '克拉文农场',
    'Selhurst Park': '塞尔赫斯特公园',
    'The City Ground': '城市球场',
    'Goodison Park': '古迪逊公园',
    'Hill Dickinson Stadium': '希尔·迪金森球场',
    'Molineux Stadium': '莫利纽克斯球场',
    'The MKM Stadium': 'MKM 球场',
    'Portman Road': '波特曼路',
    'Coventry Building Society Arena': '考文垂建筑协会球场',
    'Elland Road': '埃兰路',
    'Stadium of Light': '光明球场',
    'Gtech Community Stadium': 'Gtech 社区球场',
    'Turf Moor': '草坪球场',
    'Allianz Arena': '安联球场（慕尼黑）',
    'Allianz Stadium': '安联球场（都灵）',
    'Signal Iduna Park': '信号伊杜纳公园',
    'BayArena': '拜耳球场',
    'Deutsche Bank Park': '德意志银行公园',
    'Red Bull Arena': '红牛球场',
    'MHPArena': 'MHPArena 球场',
    'San Siro': '圣西罗',
    'Giuseppe Sinigaglia': '西尼加利亚球场',
    'Stadio Diego Armando Maradona': '马拉多纳球场',
    'Olimpico': '奥林匹克球场',
    'New Balance Arena': '新百伦球场',
    'Santiago Bernabéu': '伯纳乌',
    'Spotify Camp Nou': '诺坎普',
    'Riyadh Air Metropolitano': '利雅得航空大都会球场',
    'San Mamés': '圣马梅斯',
    'Estadio de la Cerámica': '陶瓷球场',
    'Estadio La Cartuja': '拉卡图哈球场',
    'Parc des Princes': '王子公园球场',
    'Stade Vélodrome': '韦洛德罗姆球场',
    'Stade Louis II': '路易二世球场',
    'Decathlon Arena - Stade Pierre-Mauroy': '皮埃尔·莫鲁瓦球场',
    'Stade Bollaert-Delelis': '博拉尔特-德勒利斯球场',
    'Estádio da Luz': '光明球场（里斯本）',
    'Estádio José Alvalade': '阿尔瓦拉德球场',
    'Estádio do Dragão': '龙球场',
    'Johan Cruijff Arena': '克鲁伊夫球场',
    'Philips Stadion': '飞利浦球场',
    'De Kuip': '德凯普球场',
    'Jan Breydel Stadium': '扬·布雷德尔球场',
    'Lotto Park': '乐透公园',
    'Georgios Karaiskakis Stadium': '卡拉伊斯卡基斯球场',
    'OPAP Arena': 'OPAP 球场',
    'Aspmyra Stadion': '阿斯普米拉球场',
    'Fortuna Arena': '福图纳球场',
    'Národny Futbalovy Stadión': '国家足球场',
    'Parken Stadium': '帕肯球场',
    'Tofiq Bahramov Republican Stadium': '托菲克·巴赫拉莫夫球场',
    'Baku Olympic Stadium': '巴库奥林匹克球场',
    'Astana Arena': '阿斯塔纳竞技场',
    'RAMS Park': '拉姆斯公园',
    'Şükrü Saracoğlu Stadium': '许克吕·萨拉哲奥卢球场',
    'Puskás Aréna': '普斯卡什球场',
    'Alphamega Stadium': '阿尔法梅加球场',
    'Raiffeisen Arena (Linz)': '莱夫艾森球场（林茨）',
    'Viking Stadion': '维京球场',
}


def cn_venues(espn_key, dates, en2cn):
    """一步到位：抓 ESPN 场馆 -> 中文化 -> 返回「中文主队 -> 中文场馆」。"""
    h2v = fetch_venues(espn_key, dates)
    out = {}
    for en, cn in en2cn.items():
        raw = h2v.get(en)
        if raw:
            out[cn] = VENUE_CN.get(raw, raw)
    return out


def final_venue_of(dates, espn_key='uefa.champions'):
    """决赛是中立场：按给定的决赛日期抓 ESPN，取该场场馆（中文）。找不到返回 ''。

    必须传「决赛日」而不是整个赛季日期，否则会取到普通轮次的场馆。
    """
    for dd in dates:
        ds = dd.replace('-', '')
        try:
            j = _get(ESPN.format(key=espn_key, d=ds), {'User-Agent': TH['User-Agent']})
        except Exception:
            continue
        for e in (j.get('events') or []):
            comp = (e.get('competitions') or [{}])[0]
            v = (comp.get('venue') or {}).get('fullName')
            if v:
                return VENUE_CN.get(v, v)
    return ''
