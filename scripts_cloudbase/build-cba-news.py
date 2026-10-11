# -*- coding: utf-8 -*-
"""为「赛程比分页」与「资讯页」注入 CBA 真实数据。

照搬 scripts_cloudbase/build-nba-news.py 的结构（Day 22 定的模式）。

- 赛程比分页：把 cba.json 里「昨天/今天/明天」三天的真实 CBA 季前赛
  写进 data/matches.json（保留原有其它联赛条目，只替换 CBA 段）。
- 资讯页：把当天真实 CBA 赛果写成 CBA 资讯，追加进 data/news.json（保留原有条目）。

关于「头条」：腾讯体育首页 type1502 头条模块只有 1 条、且是 NBA 内容
（实测 2026-10-11 = 火箭 vs 独行侠中国赛），没有 CBA 头条可抓；
为避免把 NBA 标题挂到 CBA 名下，CBA 段只注入真实赛果，不硬凑头条。

用法：python scripts_cloudbase/build-cba-news.py
"""
import json, os, datetime

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CBA = os.path.join(BASE, 'data', 'cba.json')
MATCHES = os.path.join(BASE, 'data', 'matches.json')
NEWS = os.path.join(BASE, 'data', 'news.json')

TODAY = datetime.date(2026, 10, 11)   # 与 cba.json 快照对齐（当天有真实 CBA 季前赛）


def iso(datestr, hm='', tz='+08:00'):
    return datestr + 'T' + (hm or '12:00') + ':00' + tz


# ---------- 1. 赛程比分页：昨天/今天/明天 真实 CBA 比赛 ----------
def build_matches(cba):
    days = [(TODAY - datetime.timedelta(days=1)).isoformat(),
            TODAY.isoformat(),
            (TODAY + datetime.timedelta(days=1)).isoformat()]
    out = []
    n = 0
    for m in cba['schedule']:
        if m['date'] not in days:
            continue
        n += 1
        live = m['status'] in ('已结束', '进行中')
        item = {
            'id': '%s-cba-%02d' % (m['date'].replace('-', ''), n),
            'league': 'CBA',
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


# ---------- 2. 资讯页：当天真实赛果 ----------
def build_news(cba):
    items = []
    for m in cba['schedule']:
        if m['date'] != TODAY.isoformat() or m['status'] != '已结束':
            continue
        hs, as_ = m.get('homeScore'), m.get('awayScore')
        if hs is None or as_ is None:
            continue
        win = m['homeTeam'] if hs > as_ else m['awayTeam']
        lose = m['awayTeam'] if hs > as_ else m['homeTeam']
        wsc, lsc = (hs, as_) if hs > as_ else (as_, hs)
        rnd = m.get('round') or '季前赛'
        items.append({
            'id': '%s-cba-g%s' % (TODAY.strftime('%Y%m%d'), m['id'].split('-')[-1]),
            'title': '%s %d-%d 击败 %s（%s）' % (win, wsc, lsc, lose, rnd),
            'summary': '北京时间%s，CBA%s %s 对阵 %s，%s 以 %d-%d 取胜。'
                       % (m['date'], rnd, m['homeTeam'], m['awayTeam'], win, wsc, lsc),
            'section': '赛果',
            'league': 'CBA',
            'sourceName': '腾讯体育',
            'sourceUrl': 'https://sports.qq.com/kbsweb/index.htm',
            'digestDate': TODAY.isoformat(),
            'status': 'published',
            'createdAt': iso(TODAY.isoformat(), m.get('time') or '11:30', '+08:00'),
        })
    return items


def main():
    cba = json.load(open(CBA, encoding='utf-8'))
    cba_matches = build_matches(cba)
    print('matches(CBA 三天):', len(cba_matches))
    for x in cba_matches:
        print('  ', x['matchTime'], x['homeTeam'], x.get('homeScore', ''), x['status'], '|', x['round'])

    cba_news = build_news(cba)
    print('news(CBA 当天赛果):', len(cba_news))
    for x in cba_news:
        print('  ', x['title'])

    # --- 写 matches.json：保留非 CBA 段，CBA 段整体替换 ---
    old = json.load(open(MATCHES, encoding='utf-8'))
    kept = [x for x in old if x.get('league') != 'CBA']
    merged = cba_matches + kept
    json.dump(merged, open(MATCHES, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print('wrote', MATCHES, '->', len(merged), '条（CBA', len(cba_matches), '+ 其它', len(kept), '）')

    # --- 写 news.json：去掉旧的 CBA 条目，追加真实 CBA 条目 ---
    oldn = json.load(open(NEWS, encoding='utf-8'))
    keptn = [x for x in oldn if x.get('league') != 'CBA']
    mergedn = cba_news + keptn
    json.dump(mergedn, open(NEWS, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print('wrote', NEWS, '->', len(mergedn), '条（CBA', len(cba_news), '+ 其它', len(keptn), '）')


if __name__ == '__main__':
    main()
