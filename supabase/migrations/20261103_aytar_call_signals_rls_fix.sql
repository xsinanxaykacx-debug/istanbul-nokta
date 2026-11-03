-- AYTAR WebRTC signaling RLS correction.
-- The recipient UUID is validated by the auth.users foreign key; only the
-- authenticated sender must be an active member.
drop policy if exists "active members send call signals to active members" on public.aytar_call_signals;
create policy "active members send call signals to active members"
on public.aytar_call_signals for insert to authenticated
with check (
  sender_id = (select auth.uid())
  and recipient_id <> (select auth.uid())
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.status = 'active'
  )
);
grant insert, select, delete on public.aytar_call_signals to authenticated;
