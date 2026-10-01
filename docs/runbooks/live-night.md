# Runbook: running a live night

**Owner:** Pete. **Last reviewed:** 1 October 2026.

One page. Keep it on your phone. Everything here is something that has actually
gone wrong, or that the code says can go wrong.

## Before the night

- [ ] Session created in `/admin`, games added, **and marked as Ready**. A
      session left as Draft does not appear on `/host` or on the TV at all, and
      nothing prompts you. This is the single most likely reason a night starts
      badly.
- [ ] Every stage of every game has a prize. The host screen warns, but it is
      easier to fix now.
- [ ] The snowball game is linked to the pot, and the pot figure is what you
      intend to announce.
- [ ] The TV is on `/display` and showing the session.
- [ ] The host device is signed in, and its screen timeout is off or the wake
      lock is active (the app asks for it; a tap grants it).

## The app needs the internet

There is no offline mode, and this is a deliberate decision taken on 25 August
2026 rather than an oversight. The database decides which ball comes out, which
is what stops two devices drawing the same number, and moving that decision into
a phone with no signal would trade a reliability problem for a correctness one.

What was fixed instead: the screens no longer die when the connection wobbles.
They keep the last good state, show "Reconnecting", and recover by themselves.
Nothing reloads while the device is offline.

**If the internet goes down for more than a minute or two, fall back to paper.**
See "The wifi has gone" below.

## During the night

### The host screen says "Reconnecting"

Do nothing for thirty seconds. It recovers on its own the great majority of the
time. Keep calling if the button still works: every call goes through the
database, so if it worked, it worked.

### You tapped Call and nothing happened

Tap it again. Since 25 August 2026 this is safe: the second tap carries the same
key as the first, so if the first one did come out you get the same board back
rather than a second ball. The error message says so at the time.

The same is true of **Check claim**, **Check win**, **Confirm winner**,
**Continue playing** and **Skip stage**. It is **not** true of **Undo last
call**: undoing twice takes two balls off. If an undo fails, reload and look at
the board before trying again. (The one undo inside a claim check is the
exception: it is tied to that claim and can only ever take one ball off.)

### You called a ball too early, or the room did not hear it

**Undo last call**. It goes back in the bag and the next call draws it again.

If a winner has already been recorded on that ball, the undo is refused. Void
that winner first, with a reason, then undo. The refusal message has a button
that takes you straight there.

### Somebody shouts bingo

**Check claim**, then tap their numbers **in the order the caller reads them
out**. The TV and the phones show each number as you tap it, ticked if it has
been called and crossed if it has not, so the room can follow the check. The
screen also lists what you have tapped underneath the grid, in that same order,
and calls out in red anything that has not actually been called. Check that list
against their book, then press **Check win**. The server gives the verdict, and
the TV shows it.

- **Valid:** the Winner dialog opens. The win only goes up on the TV once you
  confirm it, not before.
- **Not a winner** (a number that has not been called): **Carry on calling**.
- If a tap does not reach the TV, the screen says **"TV not updated, retrying"**
  and keeps trying by itself. Carry on: Check win sends the full list anyway.

### The claim does not include the last number called

The app asks: "This claim does not include the last number called. Did they call
before it was announced?" It does not guess from timings, because the TV can
lag behind the room. This is your call.

- **Yes:** the app takes that last ball back off the board and checks the same
  numbers again. It can only do this once per claim, so a second tap never takes
  a second ball off.
- **No:** the claim is rejected as **too late**, and the TV says so.

### The claim is good but you are not ready to move on

Record the winner, then **Close and stay paused**. The main screen then shows
that the stage has been won, with **Continue to** the next stage (or **Finish
this game** on the last stage) and **Check another claimant**.

**Resume calling is not offered once a stage has a winner, and the app refuses
it.** Carrying on calling for a prize that has already gone is how a stage gets
paid twice. Move on with Continue instead.

### Two people win at once

After recording the first winner, press **Check another claimant** and check the
second person's ticket as a new claim. Each claimant is a separate check and a
separate winner, so a retry can never record the same person twice. The app
splits the stage prize evenly between them and shows each person's share. A
snowball jackpot is shared only between the winners who were eligible for it.

### The host phone reloaded, or another device took over, mid-claim

Nothing is lost. The claim is held by the server, so the screen reopens it with
the numbers already tapped and carries on from there. If the winner had already
been confirmed, it is not recorded twice.

### The snowball pot is not showing

If the panel says "Snowball pot could not be loaded", **do not record a Full
House on that game** until the figure appears. The app will refuse anyway. It
retries by itself; bringing the screen back to the front makes it retry sooner.

### The game ended but the pot did not move

A banner appears offering **Settle the pot**, before the screen moves on to the
next game. Press it. It is safe to press more than once: if the pot did move
after all, it says so and changes nothing. You can carry on without it, but then
tell an admin: the admin's host console lists every finished snowball game whose
pot has not settled, with a **Settle** button.

### A game needs to end with nobody winning

**End game** on the host screen. On the snowball game this is important: it is
what makes the pot roll over. Walking away instead leaves the pot frozen and next
week's TV advertises this week's figure.

### The wifi has gone

1. Keep calling from the paper book. Write every ball down. The app has stopped
   being the record; your paper is.
2. Tell the room the screens are frozen, not the game.
3. When the connection comes back, the app is still on the ball it last recorded.
   You cannot type the missed balls in, and you should not try to catch it up by
   calling them quickly: the display would show numbers the room already has.
4. Finish the game on paper, then use **End game** so the session and the pot
   settle properly. Record the winners in the app afterwards if you can, or note
   them on paper and add them via `/admin` the next day.

### Ending the night

Finishing the last game ends the night by itself: the last game's "End game and
finish session" does both. If you stop early with games left unplayed, press
**End the night** on the host console (open the session). It lists the games that
will stay unplayed, and a snowball pot on an unplayed game does not move. It is
refused while a game is still in progress: end that game first.

The TV and the phones then show the end-of-night screen. If the night was ended
by mistake, an admin sets the session back to Running.

### "A new version is ready"

The host screen shows this banner after an update. Press **Reload** when you are
between calls. It waits until any claim check is finished before it appears. The
TV and the phones pick up updates by themselves, never in the middle of a claim
or a win.

### Somebody else's device has control

Take control from the game screen. It works once the other device has been quiet
for thirty seconds. If their tab is still open and awake, close it on their
device.

### The TV is stuck on an old game, or blank

Reload it. It follows the session automatically once it is back.

## After the night

- [ ] The night is ended (by finishing the last game, or **End the night**), so
      the session shows Completed.
- [ ] The snowball pot shows the figure you expect for next time. Check it on
      `/admin/snowball`; the history table underneath explains every movement.
- [ ] Prizes handed over are ticked off in Winners & prizes.
- [ ] The payout total on `/admin/history` matches the till.

## What to do about a mistake the next day

Everything below is on `/admin` and every one of them is recorded.

| Mistake | Fix |
|---|---|
| A win recorded against the wrong person, stage or game | Open the session, **Void** the winner with a reason. It stays visible, struck through, with your reason |
| A voided jackpot means the pot is now wrong | Correct it on `/admin/snowball`. Voiding does not move the pot back by itself |
| The pot is wrong for any other reason | Same place. The correction is written to the pot history with your name against it |
| A whole night was run against the wrong session | **Reset to Ready** on the session. It records everything it deletes. It refuses if that session's snowball game already settled the pot, which is deliberate |

## Who to tell

Nobody is on call. If something breaks that is not covered here, write down what
you saw and what you were doing, and it can be looked at afterwards. Since
25 August 2026 failures are logged, so "it broke at about half nine" is enough to
find it.
