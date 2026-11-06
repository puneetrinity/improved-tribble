-- Budget refusals before any provider dispatch do not spend a processing try.
-- Paid, uncertain, and genuine extraction/model failures retain their cap.
-- No charge, reservation, request identity, or historical job is removed.
DO $$ DECLARE signature text;s text;old text;replacement text;BEGIN
 FOREACH signature IN ARRAY ARRAY['public.flow_candidate_source_enqueue(bigint,jsonb)','public.flow_candidate_source_retry_status(bigint,uuid)'] LOOP
  SELECT pg_get_functiondef(signature::regprocedure) INTO s;
  old:='WHERE j0.user_id=p_user AND s0.content_hash=s.content_hash';
  replacement:=old||E'\n AND NOT (coalesce(j0.reason=''budget_unavailable'',false) AND j0.state IN (''held'',''unavailable'')\n  AND NOT EXISTS(SELECT 1 FROM public.candidate_source_paid_operations paid WHERE paid.command_id=j0.command_id AND paid.state IN (''dispatched'',''settled'',''held'')))';
  IF array_length(string_to_array(s,old),1)<>2 THEN RAISE EXCEPTION 'unpaid_retry_count_anchor_drift';END IF;
  s:=replace(s,old,replacement);
  IF signature='public.flow_candidate_source_retry_status(bigint,uuid)' THEN
   old:='allowed:=n<3 AND j.state IN (''held'',''unavailable'') AND j.reason IN (''empty'',''provider_refused'',''outcome_unknown'')';
   replacement:='allowed:=n<3 AND j.state IN (''held'',''unavailable'') AND j.reason IN (''empty'',''provider_refused'',''outcome_unknown'',''budget_unavailable'')';
   IF array_length(string_to_array(s,old),1)<>2 THEN RAISE EXCEPTION 'unpaid_retry_status_anchor_drift';END IF;
   s:=replace(s,old,replacement);
  END IF;
  EXECUTE s;
 END LOOP;
END $$;
