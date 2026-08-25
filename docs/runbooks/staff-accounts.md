# Runbook: staff accounts

**Owner:** Pete. **Last reviewed:** 25 August 2026.

Decision taken 25 August 2026: accounts are managed by hand in the Supabase
dashboard rather than through a screen in the app. There is one admin and a
handful of hosts, so a screen would be more code to maintain than it saves. If
the pub ever has enough staff turnover that this becomes a chore, that is the
signal to build one.

## What changed, and why this runbook exists at all

Until 25 August 2026 anyone on the internet could create an account and it was
granted the **host** role automatically, which is enough to run a live game.
Sign-up is now switched off at the project, and even if it were switched back on
a new account lands as **pending** and can reach nothing.

That is the right shape, but it means there is now no self-service route in.
Somebody has to know how to let a new member of staff in, or the tempting
shortcut is to turn public sign-up back on. That shortcut reopens the hole this
closed. Use the steps below instead.

## The three roles

| Role | Can do | Typical holder |
|---|---|---|
| `pending` | Nothing. Signs in, sees an explanation, and that is all | A brand new account |
| `host` | Run a game night: call numbers, check claims, record winners, mark prizes handed over | Bar staff running bingo |
| `admin` | All of the above, plus set up sessions and games, manage the snowball pot, void winners, reset sessions | Pete |

A `host` deliberately cannot void a winner or move the pot. Those are money
decisions and they stay with an admin.

## Adding a new member of staff

1. Supabase dashboard, **Authentication**, **Users**, **Add user**, **Create new
   user**. Enter their email and a temporary password. Tick **Auto Confirm
   User**, otherwise they cannot sign in until they click an email.
2. The database creates their profile automatically, as `pending`. They can sign
   in at this point and will see "This account is not active yet".
3. Give them the role. Supabase dashboard, **SQL Editor**:

   ```sql
   update public.profiles
      set role = 'host'          -- or 'admin'
    where email = 'them@example.com';
   ```

4. Confirm it took, and that you changed exactly one person:

   ```sql
   select email, role from public.profiles order by role, email;
   ```

5. Tell them to sign in and change their password.

**Do not** turn "Allow new users to sign up" back on to make this easier. That
setting is what stops a stranger creating an account at all.

## Removing access when someone leaves

Two steps, and the second is the one people forget.

1. Take the role away, which removes every permission immediately:

   ```sql
   update public.profiles set role = 'pending' where email = 'them@example.com';
   ```

2. **Sign out their existing session.** Step 1 stops them doing anything, but
   their browser may still hold a valid token for up to an hour. Supabase
   dashboard, **Authentication**, **Users**, find them, and use the row menu to
   sign the user out of all sessions. To remove the account entirely, delete the
   user there; their profile row goes with it, and their recorded winners are
   unaffected because winners are anonymous.

**Timing:** the same night, if they left on bad terms. Otherwise the next time
you think of it. A `pending` account cannot do anything even if they keep the
tab open.

## Forgotten password

There is no password reset flow in the app. This is a known gap, recorded in the
backlog, and until it is built:

Supabase dashboard, **Authentication**, **Users**, find them, row menu, **Send
password recovery**. They get an email with a link. Alternatively set a temporary
password in the same menu and tell them what it is over the phone, not by
message.

## When somebody says they cannot get in

Work down this list. It is in order of likelihood.

1. **They see "This account is not active yet"** on `/pending`. Their role is
   `pending`. Do step 3 above.
2. **They are bounced back to the login page.** Their session expired. Sign in
   again. If it happens repeatedly within an hour, say so: that is a real bug
   and was one of the things fixed on 25 August 2026.
3. **They land on `/host` but every button refuses.** Their role is `host` but
   somebody else's device holds the controller lock for that game. They can take
   control from the game screen once the other device has been idle 30 seconds.
4. **They see the admin screens but not what they expect.** Check their role is
   actually `admin` with the query in step 4 above.

## The bootstrap endpoint

`/api/setup` can promote a user to admin using `SETUP_SECRET`. It exists to
create the very first admin on a fresh deployment.

**Once that admin exists, unset `SETUP_SECRET` in Vercel.** With no secret set
the route returns 404. Leaving it armed means the whole security model reduces to
one environment variable, and there is no reason to keep that risk after the one
time it is needed.

## Checking who has access, any time

```sql
select p.email, p.role, p.created_at, u.last_sign_in_at
  from public.profiles p
  join auth.users u on u.id = p.id
 order by p.role, p.email;
```

Worth running every few months. An account nobody recognises is worth asking
about.
