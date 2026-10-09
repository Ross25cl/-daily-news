# -*- coding: utf-8 -*-
"""为「赛程比分页」与「资讯页」注入 NBA 真实数据（Day 22）。

- 赛程比分页：把 nba.json 里「昨天/今天/明天」三天的真实 NBA 季前赛
  写进 data/matches.json（保留原有其它联赛示例条目，只替换/NBA 段）。
- 资讯页：把腾讯体育首页真实头条 + 真实比赛结果写成 NBA 资讯，追加进
  data/news.json（保留原有示例条目）。

用法：python build-nba-news.py
"""
import json, os, urllib.request, re, datetime

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NBA = os.path.join(BASE, 'data', 'nba.json')
MATCHES = os.path.join(BASE, 'data', 'matches.json')
NEWS = os.path.join(BASE, 'data', 'news.json')

H = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                   '(KHTML, like Gecko) Chrome/126.0 Safari/537.36'}

TODAY = datetime.date(2026, 10, 9)

# 轮次文案 → matches.json 的 round 字段（保留「季前赛」）
def iso(datestr, hm='', tz='+08:00'):
    return datestr + 'T' + (hm or '12:00') + ':00' + tz


# ---------- 1. 赛程比分页：昨天/今天/明天 真实 NBA 比赛 ----------
def build_matches(nba):
    days = [(TODAY - datetime.timedelta(days=1)).isoformat(),
            TODAY.isoformat(),
            (TODAY + datetime.timedelta(days=1)).isoformat()]
    out = []
    n = 0
    for m in nba['schedule']:
        if m['date'] not in days:
            continue
        n += 1
        live = m['status'] in ('已结束', '进行中')
        item = {
            'id': '%s-nba-%02d' % (m['date'].replace('-', ''), n),
            'league': 'NBA',
            'homeTeam': m['homeTeam'],
            'awayTeam': m['awayTeam'],
            'matchTime': m['date'] + ' ' + (m.get('time') or '00:00'),
            'status': m['status'],
            'round': m.get('round') or '季前赛',
            'venue': m.get('venue') or '',
            'dataSource': '腾讯体育',
            'updatedAt': iso(m['date'], m.get('time'), '+08:00'),
        }
        if live:
            item['homeScore'] = m.get('homeScore')
            item['awayScore'] = m.get('awayScore')
        # 未开始的比赛把 updatedAt 统一成当前抓取时点，避免显示成开赛时间
        if m['status'] == '未开始':
            item['updatedAt'] = iso(TODAY.isoformat(), '11:50', '+08:00')
        out.append(item)
    return out


# ---------- 2. 资讯页：真实头条 + 真实赛果 ----------
def fetch_headline():
    """抓腾讯体育首页 type1502 的 topItems 第一条（真实头条）。"""
    try:
        html = urllib.request.urlopen(urllib.request.Request('https://sports.qq.com/', headers=H),
                                      timeout=25).read().decode('utf-8', 'ignore')
        key = '"type1502":{"topItems":['
        i = html.find(key)
        if i < 0:
            return None
        start = i + len(key) - 1
        depth, instr, esc, end = 0, False, False, -1
        for j in range(start, len(html)):
            c = html[j]
            if instr:
                if esc:
                    esc = False
                elif c == '\\':
                    esc = True
                elif c == '"':
                    instr = False
                continue
            if c == '"':
                instr = True
            elif c == '[':
                depth += 1
            elif c == ']':
                depth -= 1
                if depth == 0:
                    end = j
                    break
        arr = json.loads(html[start:end + 1])
        return arr[0] if arr else None
    except Exception as e:
        print('  ! 头条抓取失败:', e)
        return None


def build_news(nba, headline):
    items = []
    # ① 真实头条（詹姆斯加盟 76 人首秀）
    if headline:
        items.append({
            'id': '20261009-nba-hl01',
            'title': headline['title'],
            'summary': (headline.get('summary') or '')[:180],
            'section': '头条',
            'league': 'NBA',
            'sourceName': '腾讯体育',
            'sourceUrl': 'https://sports.qq.com/nba/',
            'digestDate': TODAY.isoformat(),
            'status': 'published',
            'createdAt': iso(TODAY.isoformat(), '10:00', '+08:00'),
        })
    # ② 当天真实赛果（10-09 已结束的 NBA 季前赛；进行中的不写赛果）
    for m in nba['schedule']:
        if m['date'] != TODAY.isoformat() or m['status'] != '已结束':
            continue
        hs, as_ = m.get('homeScore'), m.get('awayScore')
        if hs is None or as_ is None:
            continue
        win = m['homeTeam'] if hs > as_ else m['awayTeam']
        lose = m['awayTeam'] if hs > as_ else m['homeTeam']
        wsc, lsc = (hs, as_) if hs > as_ else (as_, hs)
        items.append({
            'id': '20261009-nba-g' + m['id'].split('-')[-1],
            'title': '%s %d-%d 击败 %s（季前赛）' % (win, wsc, lsc, lose),
            'summary': '北京时间%s，NBA季前赛 %s 对阵 %s，%s 以 %d-%d 取胜。'
                       % (m['date'], m['homeTeam'], m['awayTeam'], win, wsc, lsc),
            'section': '赛果',
            'league': 'NBA',
            'sourceName': '腾讯体育',
            'sourceUrl': 'https://sports.qq.com/kbsweb/index.htm',
            'digestDate': TODAY.isoformat(),
            'status': 'published',
            'createdAt': iso(TODAY.isoformat(), m.get('time') or '11:30', '+08:00'),
        })
    return items


def main():
    nba = json.load(open(NBA, encoding='utf-8'))
    nba_matches = build_matches(nba)
    print('matches(NBA 三天):', len(nba_matches))
    for x in nba_matches:
        print('  ', x['matchTime'], x['homeTeam'], x.get('homeScore', ''), x['status'])

    headline = fetch_headline()
    print('headline:', (headline or {}).get('title'))
    nba_news = build_news(nba, headline)
    print('news(NBA):', len(nba_news))

    # --- 写 matches.json：保留非 NBA 段，NBA 段整体替换 ---
    old = json.load(open(MATCHES, encoding='utf-8'))
    kept = [x for x in old if x.get('league') != 'NBA']
    merged = nba_matches + kept
    json.dump(merged, open(MATCHES, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print('wrote', MATCHES, '->', len(merged), '条（NBA', len(nba_matches), '+ 其它', len(kept), '）')

    # --- 写 news.json：去掉旧的 NBA 条目，追加真实 NBA 条目 ---
    oldn = json.load(open(NEWS, encoding='utf-8'))
    keptn = [x for x in oldn if x.get('league') != 'NBA']
    mergedn = nba_news + keptn
    json.dump(mergedn, open(NEWS, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print('wrote', NEWS, '->', len(mergedn), '条（NBA', len(nba_news), '+ 其它', len(keptn), '）')


if __name__ == '__main__':
    main()
