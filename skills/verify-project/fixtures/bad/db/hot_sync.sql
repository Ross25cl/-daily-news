-- 坏样本：导入脚本里也做了清表，不该由导入脚本干这事
TRUNCATE TABLE public.hot_items;

INSERT INTO public.hot_items (rank, platform, title) VALUES
  (1, 'hupu', '样本热搜一');
