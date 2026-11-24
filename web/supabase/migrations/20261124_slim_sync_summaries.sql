-- Shrinks stored games by removing per-move arrays from summary_json that nothing
-- reads from a stored game (they are inputs of the game accuracy, which stays, and
-- are rebuilt whenever a game is analysed again). New clients no longer upload them.
-- Measured on 25 random production games: summary 2170 -> 489 bytes (-78%).
-- NOT yet applied to production: needs Tim's go-ahead.
--
-- The update touches updated_at-less JSON only; the bump trigger gives rows a new
-- server_seq, so devices re-read the (tiny) headers once but download no game data,
-- because their updated_at is unchanged.
update public.sync_records
set data = data
  #- '{summary_json,white,accuracies}'
  #- '{summary_json,white,win_percents}'
  #- '{summary_json,black,accuracies}'
  #- '{summary_json,black,win_percents}'
where kind = 'game'
  and (data #> '{summary_json,white}' ? 'accuracies' or data #> '{summary_json,black}' ? 'accuracies');

-- Afterwards reclaim the space (Supabase counts the file size, not live rows):
-- vacuum full public.sync_records;
