#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
============================================================
scripts_cloudbase/fetch-leagues.py
每日体坛速览 · 联赛真实数据抓取（英超 / 欧冠 / CBA）

用途
    从**官方数据源**抓真数据，生成：
      1) db/league_data.sql       —— 可重复执行的入库脚本（先按联赛清空再插入）
      2) data/{epl,ucl,cba}.json  —— 前端离线降级用（形状同旧文件）

数据源（2026-10-08 实测打通）
    英超  footballapi.pulselive.com   comps=1   compSeasons=841 (2026/27)
    欧冠  footballapi.pulselive.com   comps=2   compSeasons=846 (2026/27)
    CBA   portal-server.cbaleague.com （官网 SPA 的 portal-server，从 index-*.js 挖出）
    调用必须带 Origin / Referer，否则被拒。

口径（2026-10-08 零拍板）
    · 英超 / 欧冠：26-27 赛季 —— 积分榜全量 + 射手榜前 10 + 近期 3 轮赛程
    · CBA：**只做赛程**（官网 /team/rank 不分赛季、只给未开赛的 26-27 空榜；
           球员榜只有 CBDL 发展联赛的，与 CBA 正赛无关）
    · 队名 / 球员名一律转中文（映射见 TEAM_CN / PLAYER_CN，未命中的原样保留并告警）
    · NBA 跳过：stats.nba.com 与 www.nba.com 均为 Akamai IP/地区级 WAF，
           连无头真实浏览器都返回 Access Denied（2026-10-08 实测）

用法
    python scripts_cloudbase/fetch-leagues.py            # 抓取 + 生成 SQL 与 JSON
    # 灌库：务必 argv 直传，别经 PowerShell 传 --sql（Day 21 踩过引号被吞的坑）
============================================================
"""
import collections
import datetime
import json
import os
import tempfile
import urllib.request

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120 Safari/537.36")

PL_BASE = "https://footballapi.pulselive.com/football/"
CBA_BASE = "https://portal-server.cbaleague.com"

SEASON = {"epl": 841, "ucl": 846}       # compSeasons ID（用 /compseasons/<id> 的 label 核对）
COMP = {"epl": 1, "ucl": 2}             # 赛事 ID
RECENT_ROUNDS = 3                       # 近期赛程取几轮
SCORER_TOP_N = 10
CBA_RECENT_ROUNDS = 3                   # CBA 取前几轮（赛季未开赛，取最近将进行的）

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ------------------------------------------------------------
# 队名中文映射（英文原名 → 中文）
# ------------------------------------------------------------
TEAM_CN = {
    # 英超 2026/27（20 队）
    "Manchester City": "曼城", "Arsenal": "阿森纳",
    "Brighton & Hove Albion": "布莱顿", "Brentford": "布伦特福德",
    "Leeds United": "利兹联", "Liverpool": "利物浦", "Everton": "埃弗顿",
    "Hull City": "赫尔城", "Newcastle United": "纽卡斯尔联", "Chelsea": "切尔西",
    "Ipswich Town": "伊普斯维奇", "Manchester United": "曼联",
    "Nottingham Forest": "诺丁汉森林", "Sunderland": "桑德兰",
    "Crystal Palace": "水晶宫", "Aston Villa": "阿斯顿维拉",
    "Bournemouth": "伯恩茅斯", "Coventry City": "考文垂", "Fulham": "富勒姆",
    "Tottenham Hotspur": "热刺",
    # 欧冠 2026/27（36 队）
    "Paris Saint Germain": "巴黎圣日耳曼", "FC Bayern München": "拜仁慕尼黑",
    "FC Barcelona": "巴塞罗那", "Como": "科莫",
    "Sporting Lisbon": "葡萄牙体育", "VfB Stuttgart": "斯图加特",
    "Lens": "朗斯", "Real Betis": "皇家贝蒂斯", "Borussia Dortmund": "多特蒙德",
    "Real Madrid": "皇家马德里", "AEK Athens": "AEK 雅典", "Roma": "罗马",
    "Shakhtar Donetsk": "顿涅茨克矿工", "Fenerbahçe": "费内巴切",
    "PSV Eindhoven": "埃因霍温", "Villarreal": "比利亚雷亚尔",
    "Club Brugge": "布鲁日", "Lille": "里尔", "Slavia Prague": "布拉格斯拉维亚",
    "Atlético Madrid": "马德里竞技", "Internazionale": "国际米兰",
    "LASK": "LASK 林茨", "Napoli": "那不勒斯", "Galatasaray": "加拉塔萨雷",
    "Viking FK": "维京", "FC Porto": "波尔图", "RB Leipzig": "RB 莱比锡",
    "Feyenoord": "费耶诺德", "Sabah": "萨巴巴赫",
    "Slovan Bratislava": "布拉迪斯拉发斯拉夫人", "Bodø/Glimt": "博多闪耀",
}

# ------------------------------------------------------------
# 球员中文名映射（未命中的原样保留，脚本会打印告警）
# ------------------------------------------------------------
PLAYER_CN = {
    # 英超
    "Erling Haaland": "哈兰德", "Alexander Isak": "伊萨克",
    "Bruno Fernandes": "布鲁诺·费尔南德斯", "Brian Brobbey": "布罗贝",
    "Dominic Calvert-Lewin": "卡尔弗特-勒温", "Mohamed Salah": "萨拉赫",
    "Bukayo Saka": "萨卡", "Cole Palmer": "帕尔默", "Ollie Watkins": "沃特金斯",
    "Igor Thiago": "伊戈尔·蒂亚戈", "Antoine Semenyo": "塞梅尼奥",
    "Morgan Gibbs-White": "吉布斯-怀特", "Bryan Mbeumo": "姆贝乌莫",
    "Chris Wood": "克里斯·伍德", "Jarrod Bowen": "鲍恩",
    "Nicolas Jackson": "尼古拉斯·杰克逊", "Kai Havertz": "哈弗茨",
    "Rasmus Højlund": "霍伊伦", "Yoane Wissa": "维萨",
    "Matheus Cunha": "马特乌斯·库尼亚", "Jean-Philippe Mateta": "马特塔",
    "Jhon Durán": "杜兰", "Enzo Fernández": "恩佐·费尔南德斯",
    "Son Heung-Min": "孙兴慜", "Diogo Jota": "若塔",
    "Luis Díaz": "路易斯·迪亚斯", "Cody Gakpo": "加克波",
    "Gabriel Martinelli": "马丁内利", "Leandro Trossard": "特罗萨德",
    "Phil Foden": "福登", "Omar Marmoush": "马尔穆什",
    "Savinho": "萨维尼奥", "Jeremy Doku": "多库",
    "Anthony Gordon": "安东尼·戈登", "Alexander Sørloth": "索尔洛特",
    "João Pedro": "若昂·佩德罗", "Morgan Rogers": "摩根·罗杰斯",
    "Rayan Cherki": "拉扬·谢尔基",
    # 欧冠
    "Ermedin Demirovic": "德米罗维奇", "Ferran Torres": "费兰·托雷斯",
    "Marc Bartra": "巴特拉", "Ousmane Dembélé": "登贝莱",
    "Raphinha": "拉菲尼亚", "Robert Lewandowski": "莱万多夫斯基",
    "Viktor Gyökeres": "约克雷斯", "Harry Kane": "凯恩",
    "Kylian Mbappé": "姆巴佩", "Vinícius Júnior": "维尼修斯",
    "Julián Álvarez": "胡利安·阿尔瓦雷斯", "Serhou Guirassy": "吉拉西",
    "Lautaro Martínez": "劳塔罗·马丁内斯", "Marcus Thuram": "图拉姆",
    "Rafael Leão": "莱奥", "Michael Olise": "奥利塞",
    "Karim Adeyemi": "阿德耶米", "Pascal Groß": "帕斯卡尔·格罗斯",
    "Danijel Sturm": "达尼耶尔·斯图尔姆",   # Slavia Prague 边锋（斯洛文尼亚国脚）
}

# 联赛元信息：id → (名称, 运动, emoji, 描述, tabs)
INTRO = {
    "epl": ("英超", "football", "⚽", "英格兰足球超级联赛 · 2026/27 赛季",
            ["schedule", "standings", "race", "scorers", "players"]),
    "ucl": ("欧冠", "football", "🏆", "欧洲冠军联赛 · 2026/27 赛季（联赛阶段）",
            ["schedule", "standings", "knockout", "bracket", "players"]),
    "cba": ("CBA", "basketball", "🏀", "中国男子篮球职业联赛 · 2026/27 赛季",
            ["schedule", "standings", "players"]),
}

# 数据库里 league 列用的中文名（matches 表）
LEAGUE_CN = {"epl": "英超", "ucl": "欧冠", "cba": "CBA"}

MISSING_TEAMS = set()
MISSING_PLAYERS = set()


# ---------- 网络 ----------

def http_json(url, headers=None, timeout=30, retries=4):
    """
    GET 一个 JSON 接口。

    本机链路不稳（代理 + 偶发 SSL EOF / 连接重置），内置退避重试 ——
    2026-10-08 首跑时欧冠射手榜就撞上 `SSL: UNEXPECTED_EOF_WHILE_READING`，
    重试即过；不重试会让整份数据缺一角。
    """
    import time
    h = {"User-Agent": UA, "Accept": "application/json"}
    if headers:
        h.update(headers)
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers=h)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                raw = r.read().decode("utf-8")
            return json.loads(raw) if raw.strip().startswith(("{", "[")) else {}
        except Exception as e:                       # noqa: BLE001
            last = e
            if i < retries - 1:
                time.sleep(1.5 * (i + 1))
    raise last


def pl(path):
    return http_json(PL_BASE + path, {
        "Origin": "https://www.premierleague.com",
        "Referer": "https://www.premierleague.com/",
    })


def cba(path):
    return http_json(CBA_BASE + path, {
        "Origin": "https://www.cbaleague.com",
        "Referer": "https://www.cbaleague.com/",
    })


# ---------- 工具 ----------

def cn_team(name):
    n = (name or "").strip()
    if n and n not in TEAM_CN:
        MISSING_TEAMS.add(n)
    return TEAM_CN.get(n, n)


def cn_player(name):
    n = (name or "").strip()
    if n and n not in PLAYER_CN:
        MISSING_PLAYERS.add(n)
    return PLAYER_CN.get(n, n)


def bj_time(millis):
    """pulselive 的 kickoff.millis 是 UTC 毫秒 → (北京日期, 北京时刻)。"""
    dt = datetime.datetime(1970, 1, 1) + datetime.timedelta(milliseconds=float(millis))
    dt += datetime.timedelta(hours=8)
    return dt.strftime("%Y-%m-%d"), dt.strftime("%H:%M")


def sqlq(v):
    """SQL 字面量转义：单引号翻倍（Day 21 踩过引号被吞的坑，双引号也留意）。"""
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def now_iso():
    return datetime.datetime.now().strftime("%Y-%m-%dT%H:%M:%S+08:00")


# ---------- 抓取 ----------

def fetch_standings(lg):
    """积分榜（足球列）。"""
    d = pl("standings?compSeasons=%d&comps=%d&altIds=true" % (SEASON[lg], COMP[lg]))
    out = []
    for e in (d.get("tables") or [{}])[0].get("entries") or []:
        o = e.get("overall") or {}
        out.append({
            "rank": int(e.get("position") or 0),
            "team": cn_team((e.get("team") or {}).get("name")),
            "played": o.get("played"), "wins": o.get("won"),
            "draws": o.get("drawn"), "losses": o.get("lost"),
            "goalsFor": o.get("goalsFor"), "goalsAgainst": o.get("goalsAgainst"),
            "points": o.get("points"),
        })
    return out


def fetch_scorers(lg, top_n):
    """射手榜前 N。"""
    d = pl("stats/ranked/players/goals?comps=%d&compSeasons=%d&page=0&pageSize=%d"
           % (COMP[lg], SEASON[lg], top_n))
    out = []
    for row in ((d.get("stats") or {}).get("content") or [])[:top_n]:
        ow = row.get("owner") or {}
        out.append({
            "rank": int(row.get("rank") or 0),
            "player": cn_player((ow.get("name") or {}).get("display")),
            "team": cn_team((ow.get("currentTeam") or {}).get("name")),
            "goals": int(row.get("value") or 0),
        })
    return out


def fetch_recent_fixtures(lg):
    """近期赛程：以最后一个已结束轮次为基准，取前 RECENT_ROUNDS 轮 + 其后 1 轮。"""
    d = pl("fixtures?comps=%d&compSeasons=%d&page=0&pageSize=200&sort=asc"
           % (COMP[lg], SEASON[lg]))
    rows = []
    for f in d.get("content") or []:
        teams = f.get("teams") or []
        if len(teams) < 2:
            continue
        date_s, time_s = bj_time((f.get("kickoff") or {}).get("millis"))
        st = f.get("status")
        status = "已结束" if st == "C" else ("进行中" if st in ("L", "P") else "未开始")
        rows.append({
            "gw": int((f.get("gameweek") or {}).get("gameweek") or 0),
            "date": date_s, "time": time_s, "status": status,
            "home": cn_team((teams[0].get("team") or {}).get("name")),
            "away": cn_team((teams[1].get("team") or {}).get("name")),
            "homeScore": teams[0].get("score"), "awayScore": teams[1].get("score"),
            "venue": (f.get("ground") or {}).get("name"),
        })
    done = [r for r in rows if r["status"] == "已结束"]
    if not done:
        return rows[:RECENT_ROUNDS * 11]
    last_gw = max(r["gw"] for r in done)
    lo = max(1, last_gw - (RECENT_ROUNDS - 1))
    return [r for r in rows if lo <= r["gw"] <= last_gw + 1]


def fetch_cba_schedule():
    """
    CBA 2026/27 赛程（官网 portal-server）。
    真实字段：dates / time / Round / ScheduleTypeID / HomeTeamName / VisitingTeamName ...
    ScheduleTypeID：1 = CBA 正赛（460 条），3 = 季前热身（新昌站，30 条）—— 只取正赛。
    赛季尚未开赛，故取最早的前 CBA_RECENT_ROUNDS 轮（即将开打）。
    """
    d = cba("/home/home_schedules")
    rows = d.get("data") or []
    out = []
    for r in rows:
        if r.get("ScheduleTypeID") != 1:
            continue
        date_s = (r.get("dates") or "").strip()
        if not date_s:
            continue
        hs, as_ = r.get("HomeTeamScore"), r.get("VisitingTeamScore")
        out.append({
            "id": r.get("ScheduleID"),
            "round": r.get("Round"),
            "date": date_s,
            "time": (r.get("time") or "").strip(),
            "home": r.get("HomeTeamName"),
            "away": r.get("VisitingTeamName"),
            "homeScore": hs, "awayScore": as_,
            "status": "已结束" if (hs is not None and as_ is not None) else "未开始",
        })
    out.sort(key=lambda x: (x["date"], x["time"]))
    rounds = sorted({r["round"] for r in out if r["round"]})
    keep = set(rounds[:CBA_RECENT_ROUNDS])
    return [r for r in out if r["round"] in keep]


# ---------- SQL 生成 ----------

def build_sql(epl, ucl, cba_rows, updated_at):
    L = []
    a = L.append
    a("-- ============================================================")
    a("-- league_data.sql — 联赛真实数据（由 scripts_cloudbase/fetch-leagues.py 生成）")
    a("-- 生成时间：%s" % updated_at)
    a("-- 数据源：英超/欧冠 = premierleague.com 官方数据接口（26-27 赛季）")
    a("--         CBA      = cbaleague.com 官网 portal-server（26-27 赛程）")
    a("-- 可重复执行：先按联赛清空 league_* 三表与 matches，再插入")
    a("-- Day 22 追加：本文件依赖 season 列，须先执行 db/migrate-day22-league-season.sql")
    a("-- ============================================================")
    a("")
    a("BEGIN;")
    a("")

    # 0) 约束对齐（幂等）—— 见 §射手榜并列说明
    a("-- ---------- 0. 约束对齐：league_players 名次允许并列（Day 21 零拍板）----------")
    a("-- 原约束 UNIQUE (league_id, board, rank) 会把真实射手榜的并列名次直接拒掉")
    a("-- （英超前 10 里 8 人并列第 3）。放宽为四列，仍防「同榜同名次挂同一球员两次」。")
    a("-- Day 22 追加 season：同一球员在两个赛季都排第 3 名时不再被判重")
    a("--   （season 列由 db/migrate-day22-league-season.sql 建立，须先跑该迁移）。")
    a("ALTER TABLE public.league_players DROP CONSTRAINT IF EXISTS league_players_rank_uniq;")
    a("ALTER TABLE public.league_players ADD CONSTRAINT league_players_rank_uniq")
    a("  UNIQUE (league_id, season, board, rank, player_name);")
    a("")

    # 1) 联赛维度表
    a("-- ---------- 1. 联赛维度表 ----------")
    for lg in ("epl", "ucl", "cba"):
        name, sport, emoji, desc, tabs = INTRO[lg]
        a("INSERT INTO public.leagues (id, name, sport, emoji, description, tabs, updated_at)")
        a("VALUES (%s, %s, %s, %s, %s, %s, %s)" % (
            sqlq(lg), sqlq(name), sqlq(sport), sqlq(emoji), sqlq(desc),
            sqlq(json.dumps(tabs, ensure_ascii=False)), sqlq(updated_at)))
        a("ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, sport = EXCLUDED.sport,")
        a("  emoji = EXCLUDED.emoji, description = EXCLUDED.description,")
        a("  tabs = EXCLUDED.tabs, updated_at = EXCLUDED.updated_at;")
    a("")

    # 2) 清旧数据
    a("-- ---------- 2. 清空旧的联赛数据 ----------")
    for t in ("league_schedule", "league_standings", "league_players"):
        a("DELETE FROM public.%s WHERE league_id IN ('epl', 'ucl', 'cba');" % t)
    a("DELETE FROM public.matches WHERE league IN ('英超', '欧冠', 'CBA');")
    a("")

    # 3) 积分榜
    a("-- ---------- 3. league_standings（英超 20 队 / 欧冠 36 队）----------")
    for lg, st in (("epl", epl["standings"]), ("ucl", ucl["standings"])):
        for i, r in enumerate(st, 1):
            a("INSERT INTO public.league_standings (id, league_id, rank, team_name, played,"
              " wins, draws, losses, goals_for, goals_against, points) VALUES (%s, %s, %s, %s,"
              " %s, %s, %s, %s, %s, %s, %s);" % (
                  sqlq("%s-standings-%02d" % (lg, i)), sqlq(lg), r["rank"],
                  sqlq(r["team"]), sqlq(r["played"]), sqlq(r["wins"]), sqlq(r["draws"]),
                  sqlq(r["losses"]), sqlq(r["goalsFor"]), sqlq(r["goalsAgainst"]),
                  sqlq(r["points"])))
    a("")

    # 4) 射手榜
    # ⚠️ 主键用「列表序号」拼，不能用 rank：射手榜大量并列（如英超 10 人里 8 人并列第 3），
    #    用 rank 拼 id 会撞主键（Day 21 实测 SQLSTATE 23505）。rank 列仍按真实并列值存。
    a("-- ---------- 4. league_players（射手榜 board=scorers）----------")
    for lg, sc in (("epl", epl["scorers"]), ("ucl", ucl["scorers"])):
        for i, r in enumerate(sc, 1):
            a("INSERT INTO public.league_players (id, league_id, board, rank, player_name,"
              " team_name, goals) VALUES (%s, %s, 'scorers', %s, %s, %s, %s);" % (
                  sqlq("%s-scorer-%02d" % (lg, i)), sqlq(lg), r["rank"],
                  sqlq(r["player"]), sqlq(r["team"]), sqlq(r["goals"])))
    a("")

    # 5) 联赛赛程
    a("-- ---------- 5. league_schedule ----------")
    seq = collections.defaultdict(int)
    for lg in ("epl", "ucl"):
        for r in (epl if lg == "epl" else ucl)["schedule"]:
            key = (lg, r["date"])
            seq[key] += 1
            rid = "%s-%s-%02d" % (lg, r["date"].replace("-", ""), seq[key])
            a("INSERT INTO public.league_schedule (id, league_id, match_date, match_time, status,"
              " home_team, away_team, home_score, away_score, round, venue) VALUES"
              " (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s);" % (
                  sqlq(rid), sqlq(lg), sqlq(r["date"]), sqlq(r["time"]), sqlq(r["status"]),
                  sqlq(r["home"]), sqlq(r["away"]), sqlq(r["homeScore"]), sqlq(r["awayScore"]),
                  sqlq("%s第 %d 轮" % (INTRO[lg][0], r["gw"])), sqlq(r["venue"])))
    for r in cba_rows:
        key = ("cba", r["date"])
        seq[key] += 1
        rid = "cba-%s-%02d" % (r["date"].replace("-", ""), seq[key])
        a("INSERT INTO public.league_schedule (id, league_id, match_date, match_time, status,"
          " home_team, away_team, home_score, away_score, round, venue) VALUES"
          " (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s);" % (
              sqlq(rid), sqlq("cba"), sqlq(r["date"]), sqlq(r["time"]), sqlq(r["status"]),
              sqlq(r["home"]), sqlq(r["away"]), sqlq(r["homeScore"]), sqlq(r["awayScore"]),
              sqlq("CBA 第 %s 轮" % r["round"] if r["round"] else None), sqlq(None)))
    a("")

    # 6) 综合赛程页 matches（跨联赛）
    a("-- ---------- 6. matches（赛程比分页，跨联赛）----------")
    mseq = collections.defaultdict(int)
    mrows = []
    for lg in ("epl", "ucl"):
        for r in (epl if lg == "epl" else ucl)["schedule"]:
            mrows.append((lg, r))
    for r in cba_rows:
        mrows.append(("cba", r))
    for lg, r in mrows:
        key = (lg, r["date"])
        mseq[key] += 1
        mid = "%s-%s-%02d" % (r["date"].replace("-", ""), lg, mseq[key])
        src = "premierleague.com 官方数据接口" if lg in ("epl", "ucl") else "cbaleague.com 官网"
        rnd = r.get("round")
        if rnd is None and r.get("gw"):
            rnd = "%s第 %d 轮" % (INTRO[lg][0], r["gw"])
        a("INSERT INTO public.matches (id, league, home_team, away_team, match_time, status,"
          " home_score, away_score, round, venue, data_source, updated_at) VALUES"
          " (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s);" % (
              sqlq(mid), sqlq(LEAGUE_CN[lg]), sqlq(r["home"]), sqlq(r["away"]),
              sqlq("%s %s" % (r["date"], r["time"] or "00:00")), sqlq(r["status"]),
              sqlq(r["homeScore"]), sqlq(r["awayScore"]), sqlq(rnd),
              sqlq(r.get("venue")), sqlq(src), sqlq(updated_at)))
    a("")
    # 9) 赛季回填（Day 22 追加）：上面插入未列 season，统一回填成 26-27（幂等）
    a("-- ---------- 9. 赛季回填（Day 22 追加）----------")
    a("-- 上面这批英超/欧冠/CBA 数据全部来自 26-27 赛季（fetch-leagues.py 只抓当前赛季），")
    a("-- INSERT 未列 season 列 → 走 DEFAULT ''，这里统一回填成 '26-27'。")
    a("-- 幂等：season 已填的行不受影响。")
    a("UPDATE public.league_schedule SET season = '26-27' WHERE season = '';")
    a("UPDATE public.league_standings SET season = '26-27' WHERE season = '';")
    a("UPDATE public.league_players  SET season = '26-27' WHERE season = '';")
    a("")
    a("COMMIT;")
    a("")
    a("-- 收尾自检")
    a("SELECT l.id, l.name, l.sport,")
    a("       (SELECT count(*) FROM public.league_schedule  s WHERE s.league_id = l.id) AS 赛程,")
    a("       (SELECT count(*) FROM public.league_standings t WHERE t.league_id = l.id) AS 积分榜,")
    a("       (SELECT count(*) FROM public.league_players   p WHERE p.league_id = l.id) AS 球员")
    a("FROM   public.leagues l WHERE l.id IN ('epl','ucl','cba') ORDER BY l.id;")
    a("SELECT league, count(*) AS 综合赛程 FROM public.matches"
      " WHERE league IN ('英超','欧冠','CBA') GROUP BY league ORDER BY league;")
    a("")
    return "\n".join(L)


def build_json(lg, data, updated_at):
    """生成前端降级用的 data/<lg>.json（形状同旧文件 + 接口契约 §2.5）。"""
    name, sport, emoji, desc, tabs = INTRO[lg]
    out = {
        "leagueId": lg, "leagueName": name, "sport": sport, "emoji": emoji,
        "desc": desc, "updatedAt": updated_at, "tabs": tabs,
    }
    if lg in ("epl", "ucl"):
        out["standings"] = [
            {"rank": r["rank"], "teamName": r["team"], "played": r["played"],
             "wins": r["wins"], "draws": r["draws"], "losses": r["losses"],
             "goalsFor": r["goalsFor"], "goalsAgainst": r["goalsAgainst"],
             "points": r["points"]}
            for r in data["standings"]]
        scorers = [{"rank": r["rank"], "playerName": r["player"],
                    "teamName": r["team"], "goals": r["goals"], "assists": None}
                   for r in data["scorers"]]
        out["scorers"] = scorers
        out["players"] = scorers          # 足球的球员 Tab 暂复用射手榜
        out["schedule"] = [
            {"id": "%s-%s-%02d" % (lg, r["date"].replace("-", ""), i + 1),
             "date": r["date"], "time": r["time"], "status": r["status"],
             "homeTeam": r["home"], "awayTeam": r["away"],
             "homeScore": r["homeScore"], "awayScore": r["awayScore"],
             "round": "%s第 %d 轮" % (name, r["gw"]), "venue": r["venue"]}
            for i, r in enumerate(data["schedule"])]
    else:
        out["schedule"] = [
            {"id": "cba-%s-%02d" % (r["date"].replace("-", ""), i + 1),
             "date": r["date"], "time": r["time"], "status": r["status"],
             "homeTeam": r["home"], "awayTeam": r["away"],
             "homeScore": r["homeScore"], "awayScore": r["awayScore"],
             "round": "CBA 第 %s 轮" % r["round"] if r["round"] else None}
            for i, r in enumerate(data["schedule"])]
        out["standings"] = []
        out["players"] = []
        out["dataNote"] = ("CBA 官网仅提供赛程：/team/rank 不分赛季、只返回未开赛的 26-27 空榜；"
                           "球员榜只有 CBDL 发展联赛的，与 CBA 正赛无关。")
    return out


def main():
    updated = now_iso()
    print("[1/4] 抓英超 26-27 ...")
    epl = {
        "standings": fetch_standings("epl"),
        "scorers": fetch_scorers("epl", SCORER_TOP_N),
        "schedule": fetch_recent_fixtures("epl"),
    }
    print("      积分榜 %d / 射手 %d / 赛程 %d" %
          (len(epl["standings"]), len(epl["scorers"]), len(epl["schedule"])))

    print("[2/4] 抓欧冠 26-27 ...")
    ucl = {
        "standings": fetch_standings("ucl"),
        "scorers": fetch_scorers("ucl", SCORER_TOP_N),
        "schedule": fetch_recent_fixtures("ucl"),
    }
    print("      积分榜 %d / 射手 %d / 赛程 %d" %
          (len(ucl["standings"]), len(ucl["scorers"]), len(ucl["schedule"])))

    print("[3/4] 抓 CBA 26-27 赛程 ...")
    cba_rows = fetch_cba_schedule()
    print("      赛程 %d 条" % len(cba_rows))

    print("[4/4] 生成 SQL 与 JSON ...")
    sql = build_sql(epl, ucl, cba_rows, updated)
    sql_path = os.path.join(ROOT, "db", "league_data.sql")
    with open(sql_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(sql)
    print("      %s  (%d 字节, %d 行)" % (sql_path, len(sql.encode("utf-8")), sql.count("\n")))

    for lg, data in (("epl", epl), ("ucl", ucl), ("cba", {"schedule": cba_rows})):
        p = os.path.join(ROOT, "data", "%s.json" % lg)
        if not os.path.isdir(os.path.dirname(p)):
            p = os.path.join(tempfile.gettempdir(), "%s.json" % lg)
        with open(p, "w", encoding="utf-8") as f:
            json.dump(build_json(lg, data, updated), f, ensure_ascii=False, indent=2)
        print("      %s" % p)

    if MISSING_TEAMS:
        print("!! 未映射队名：%s" % "、".join(sorted(MISSING_TEAMS)))
    if MISSING_PLAYERS:
        print("!! 未映射球员：%s" % "、".join(sorted(MISSING_PLAYERS)))
    print("完成。")


if __name__ == "__main__":
    main()
