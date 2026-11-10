# Runbook: staff accounts

**Owner:** Pete. **Last reviewed:** 7 November 2026.

From the kit sign-in (spec C-5, PR `feat/kit-auth`), staff accounts are managed
in the app at **/admin/staff**, not in the Supabase dashboard. Until then
(25 August to November 2026) accounts were made by hand in the dashboard and
promoted by SQL; that route is now closed on purpose.

## Why it works this way

Until 25 August 2026 anyone on the internet could create an account and it was
granted the **host** role automatically. Now:

- There is no sign-up anywhere in the app, and sign-up is off at the project.
- The database's Before User Created hook refuses any new account that is not
  accepting an invite. **Creating a user in the Supabase dashboard fails** with
  that hook on: that is intended, not a fault.
- A leaver's access ends the moment they are deactivated, even if their browser
  still holds a valid token: every staff table checks the account is active.

## The three roles

| Role | Can do | Typical holder |
|---|---|---|
| `pending` | Nothing. Signs in, sees an explanation, and that is all | A brand new account |
| `host` | Run a game night: call numbers, check claims, record winners, mark prizes handed over | Bar staff running bingo |
| `admin` | All of the above, plus set up sessions and games, manage the snowball pot, void winners, reset sessions | Pete |

A `host` deliberately cannot void a winner or move the pot. Those are money
decisions and they stay with an admin.

## Adding a new member of staff

1. Sign in as an admin and open **/admin/staff**.
2. Under **Invite**, enter their email and choose **host** (or **admin**).
3. Copy the link it shows and send it to them yourself (text or WhatsApp). The
   app does not email invites. The link works once, for 7 days; if it lapses,
   cancel it and issue another.
4. They open the link, set a password of at least 12 characters, and land on
   their home screen with the role you chose.

**Do not** turn "Allow new users to sign up" back on, or switch the Before User
Created hook off, to make this easier. Those are what stop a stranger creating
an account.

## Changing someone's role

**/admin/staff**, **Make admin** or **Make host** on their row. Role changes from
the SQL editor still work (the service role is allowed) but leave no audit
record, so use the screen.

## Removing access when someone leaves

**/admin/staff**, **Deactivate** on their row. That, in one step:

- sets their role to pending and marks them deactivated, so every staff table
  refuses them straight away, even with a token that has not expired;
- bans the sign-in, so their saved sessions stop working on every device.

If it reports that a step did not go through, press **Deactivate** again: it is
safe to repeat. Nothing is deleted: their audit history stays, and recorded
winners were always anonymous. **Give host access** or **Give admin access** on
the same row brings back a rehire. **Sign out everywhere** on its own is for a
lost phone, not a leaver.

**Timing:** the same night if they left on bad terms. Otherwise the next time
you think of it.

## Forgotten password

They use **Forgot password** on the sign-in page. The email links to
`/auth/confirm`, which lasts 60 minutes and works once. A signed-in member of
staff changes their password at **/account**.

## When somebody says they cannot get in

Work down this list. It is in order of likelihood.

1. **They see "not active yet" on `/pending`.** Their role is pending or they
   were deactivated. Check their row at /admin/staff.
2. **Their invite link says it is invalid.** It was used, cancelled or expired.
   Issue a new one.
3. **"Sign-in is unavailable".** Supabase, Turnstile or a sign-in setting in
   Vercel is down or missing. Check `/admin/errors` and the Vercel environment
   variables. This is the app failing closed, as designed.
4. **They land on `/host` but every button refuses.** Somebody else's device
   holds the controller lock for that game. They can take control from the game
   screen once the other device has been idle 30 seconds.

## The bootstrap endpoint

`/api/setup` can promote a user to admin using `SETUP_SECRET`. It exists to
create the very first admin on a fresh deployment.

**Once that admin exists, unset `SETUP_SECRET` in Vercel.** With no secret set
the route returns 404. Leaving it armed means the whole security model reduces to
one environment variable, and there is no reason to keep that risk after the one
time it is needed.

## Checking who has access, any time

**/admin/staff** lists every account with its role and whether it is active.
The same from the SQL editor:

```sql
select p.email, p.role, p.deactivated_at, u.last_sign_in_at
  from public.profiles p
  join auth.users u on u.id = p.id
 order by p.role, p.email;
```

Worth running every few months. An account nobody recognises is worth asking
about.
