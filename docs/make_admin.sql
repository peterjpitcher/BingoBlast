-- Run this to update your user to 'admin'
-- Replace 'your-email@example.com' with your actual email
UPDATE public.profiles
SET role = 'admin'
WHERE email = 'your-email@example.com';
