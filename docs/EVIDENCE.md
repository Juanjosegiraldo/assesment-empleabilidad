# Evidence

Screenshots of a real run, in `docs/evidence/`. They are captured by a script rather than
by hand, so they can be regenerated after any change and always show the same scenes:

```bash
npm run api:dev
npm run web:dev
npm run evidence
```

The script signs in as three different people, asks the copilot the same question from two
of them, and sends a message from one browser to check it arrives in another.

## The screenshots

| File | What it shows |
| --- | --- |
| `01-login.png` | Sign in, in Spanish, with the language switcher |
| `02-chat-three-zones-desktop.png` | The three required zones at once: channels, conversation, and profile above the copilot |
| `03-search-highlight.png` | Searching `paginacion` finds `paginación`, term highlighted |
| `04-copilot-answer-with-citations.png` | A technical answer with clickable sources |
| `05-copilot-refuses-private-channel.png` | **The refusal.** `Contexto insuficiente`, `0 tokens` |
| `06-interface-in-english.png` | The same screen in English |
| `07-copilot-answers-same-question-for-member.png` | **The same question, answered**, cited to Dirección Financiera |
| `08-realtime-message-received.png` | Laura's browser, showing a message she did not send |
| `09-realtime-message-sent.png` | Juan José's browser, having sent it |
| `10-mobile-channels.png` | 390px: channels as their own tab |
| `11-mobile-conversation.png` | 390px: the thread |
| `12-mobile-copilot.png` | 390px: the copilot |
| `13-mobile-profile.png` | 390px: the profile |

Screenshots 05 and 07 are the pair that matters. Same question, same corpus, two people:
one is refused with **zero tokens spent**, the other gets the answer with a citation. The
difference is not a rule in the application. Retrieval runs as the asker, so for Juan José
those rows do not exist.

## Demo script, five minutes

Aimed at a commercial pitch, not a code walkthrough.

**0:00 — the problem.** "Riwi Co. needs internal messaging where nobody can read what is
not theirs. Not 'should not': cannot." Sign in as `juan.jose.giraldo@riwi.io`.

**0:40 — it is a real messaging app.** Send a message. It appears instantly as *Enviando…*,
then confirms. In a second window, signed in as `laura.betancur@riwi.io`, it arrives on its
own. No reload, no polling.

**1:30 — search.** Type `paginacion` without the accent. It finds `paginación`, highlighted.
Mention that this came from a bug the QA analyst reports inside the seeded corpus itself.

**2:10 — the copilot, working.** Ask *"¿por qué eligieron SSE en vez de websockets?"*. It
answers and cites. Click a source: the conversation scrolls to the exact message and
highlights it. Every claim is checkable.

**3:00 — the copilot, refusing.** Ask *"¿cuál fue el ajuste salarial del segundo
semestre?"*. It refuses. Point at the footer: **0 tokens**. The model was never called,
because there was nothing to answer from.

**3:40 — the same question, from someone who is allowed.** Sign in as
`daniela.pineda@riwi.io` in the other window. Same question. Answered, cited to Dirección
Financiera.

**4:15 — where the rule actually lives.** Open psql on screen, change
`app.current_user_id`, run `select count(*) from rw_messages` twice: 38, then 26. "This is
not the frontend, and not even the API. This is the database refusing. The API connects as
a role that cannot bypass it."

**4:45 — and it runs.** `docker compose up`, then the README. One command, one page.

## What to have ready to answer

- Which transitive dependency was removed to reach 3NF, and where it went
- Why `bigint identity` rather than `uuid`
- Why keyset instead of `OFFSET`, with the measured numbers
- What happens if someone calls `rw_send_message` directly without being a member
- Why the application role must not have `BYPASSRLS`
- Why `security_invoker = true` on the conversations view is load bearing
- How prompt injection from inside a chat message is handled
- What happens when a refresh token is stolen, and where that revocation commits
- Why a trigger for the search vector when a generated column would also work
- What was cut, and why (`DECISIONS.md`)
