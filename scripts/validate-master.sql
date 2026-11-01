-- Read-only validation queries after Master import.
select count(*) as series_count from public.master_series;
select count(*) as comic_count from public.master_comics;

select publisher,title,volume_stage,start_year,count(*)
from public.master_series
group by 1,2,3,4 having count(*) > 1;

select series_id,issue_number,count(*)
from public.master_comics
where issue_number is not null and btrim(issue_number) <> ''
group by 1,2 having count(*) > 1;

select s.publisher,s.title,s.volume_stage,s.start_year,count(c.id) as issues
from public.master_series s left join public.master_comics c on c.series_id=s.id
group by s.id having count(c.id)=0;

-- Regression samples requested by product owner.
select publisher,title,volume_stage,start_year
from public.master_series
where lower(publisher) like '%forum%' and lower(title) like '%spider%'
order by title,start_year,volume_stage;

select publisher,title,volume_stage,start_year
from public.master_series
where lower(publisher) like '%novaro%' and lower(title) like '%batman%'
order by title,start_year,volume_stage;
