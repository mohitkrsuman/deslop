# Phase 13 — Bring your own key

**Goal.** An organization can pay for its own explanations, with Claude or
OpenAI, without anything else about the product changing.

## Build

- **One key per organization**, for one provider: Claude or OpenAI. Setting,
  replacing and removing it is an admin action. Members can see which provider
  is in use and nothing more.
- **The key is checked when it is saved**, with the smallest call that proves
  it works. A key that fails is refused at the form with the provider's reason,
  not discovered later on someone's Explain click.
- **Once saved, the key never comes back.** Settings show the provider and the
  last four characters. Replacing it means typing a new one.
- **One pinned model per provider.** Choosing a provider chooses the model.
  There is no model field.
- Explanations, folder explanations and role classification in the pipeline all
  run on the organization's key when one is set, and on the app's key when not.
- **Which key answered is visible.** The explanation pane already names the
  model; it also says whether the organization's key or the app's was used.
- **The evals take a provider.** Each of the three runs against a chosen
  provider, and its numbers are reported as that provider's, never pooled with
  the other's.

## Constraints

- **Encrypted at rest**, with a secret only the server holds. The key is
  decrypted for the call and nowhere else — not into logs, not into traces, not
  into an error message, not into the browser.
- Who may read the stored key is a policy, like every other row. Nothing
  outside the organization's own server calls can reach it.
- **A failing organization key never falls back to the app's key.** Bad key,
  exhausted quota, revoked access — the call fails and says why. Falling back
  silently bills the wrong party and hides a broken setup.
- The single place that constructs the AI client stays the single place. It
  constructs a client per provider and per key; nothing else does. Both
  providers' calls are traced, and a cache hit is still a recorded run with no
  model call in it.
- The provider is part of the cache key alongside the model. Switching provider
  never serves the other provider's answer.
- Every rule the prompts carry today holds under both providers: the three
  permitted pieces of formatting, every path handed in, classification limited
  to non-structural roles. Structured output has to validate under both
  providers' schema rules, not only Anthropic's.
- The model that judges specificity in the evals does not change with the
  provider being measured. A judge that moves with the subject measures nothing.

## Acceptance check

1. As an admin, paste an invalid Claude key. It is refused at the form with a
   reason, and nothing is saved.
2. Paste a valid one. Settings show Claude and the last four characters. Reload
   the page and view the source: the key is not in it.
3. As a member of the same organization, open settings. The provider is shown;
   there is no way to change it.
4. Explain a file. The pane names the Claude model and says the organization's
   key was used. The trace for that run has no key anywhere in it.
5. Switch to an OpenAI key and explain the same file. A fresh answer, not the
   cached Claude one, naming the OpenAI model. Inline code, bullets and bold
   still render, and no stray markdown shows.
6. Revoke the OpenAI key at the provider and click Explain on a new file. It
   fails with the provider's reason. It does not quietly answer on the app's key.
7. Remove the key. Explanations work again on the app's key and say so.
8. Run each eval against OpenAI. The output and the LangSmith experiment both
   name the provider and the model.
9. With a key saved, ask a question in Ask. Its trace shows that provider's
   model answering. Remove the key and ask again: the app's model answers.

## Ask uses the organization's key too

- The agent asks the app for the key at the start of each question, with the
  same grant its tools use. The grant names one analysis, so it can only ever
  get that analysis's organization's key. The key is never in the run's
  context, the conversation or the prompt.
- No saved key means the app's own key for Ask. A failing organization key
  fails the question with the provider's reason; there is no fallback.
- Every model call the agent and its subagent make goes through that choice.
  The agent's built-in default model holds no real key, so a call that skips
  the choice is rejected rather than billed to the app.

## An answer on the map

- A finished answer offers **Show on map** when its graph tools returned files.
  Only files a tool returned light up — never paths the model merely wrote —
  and a line stays lit only where the parser recorded an import between two of
  them. Everything else dims, nothing is removed.
- It starts at the files the tools began from. **Next hop** lights one more
  hop each click, **All** lights everything, **Clear** puts the map back.
  Nothing moves unless clicked.
- Ask answers use the same three pieces of formatting as explanations.
