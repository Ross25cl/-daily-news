-- 坏样本：开头就是 TRUNCATE，重跑会冲掉真实数据，README 却没有任何警示
TRUNCATE TABLE public.news_items, public.hot_items;

INSERT INTO public.news_items (id, title, source_url) VALUES
  ('20261001-n01', '样本标题一', 'https://example.com/1'),
  ('20261001-n02', '样本标题二', 'https://example.com/2');
