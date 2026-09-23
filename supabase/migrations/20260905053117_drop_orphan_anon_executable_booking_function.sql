-- Drop an orphan function that anyone with the publishable key could reach.
--
-- Applied to production on 5 September 2026.
--
-- create_table_booking_transaction belongs to the Anchor management app and
-- matches no migration in this repository. It is SECURITY DEFINER with EXECUTE
-- granted to PUBLIC, so any holder of the anon key reached its body. It could
-- never do anything useful here because public.table_bookings does not exist in
-- this database, which is also why nothing can have been calling it.

DROP FUNCTION IF EXISTS public.create_table_booking_transaction(jsonb, jsonb, jsonb);
