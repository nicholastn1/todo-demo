# Attaching evidence to a pull request

`docs/evidence/` is gitignored on purpose — evidence reaches the PR as
GitHub attachments in the description, never as committed files. Capture the
evidence **before** opening the PR, so the description ships with it
embedded.

## Pick the right GitHub account first

`upload-evidence-attachments.cjs` shells out to the `gh` **binary** for its
token and the repository id. That bypasses the owner-routing `gh` shell
function in this machine's zsh profile, so it uses whichever account `gh auth
status` reports as *active* — which is often the work account, not the one
that owns this repo. A token without access to the repo fails the upload with
an opaque HTTP error.

Check, and pin the token explicitly for the run:

```bash
gh auth status                        # which account is active?
export GH_TOKEN="$(gh auth token -u "$(gh repo view --json owner --jq .owner.login)")"
```

`GH_TOKEN` takes precedence over the active account for both scripts, and
scoping it to one command (or one `unset` afterwards) avoids leaving the
wrong account active in other terminals.

## Upload, then build the description block

```bash
mkdir -p /tmp/todo-evidence

# 1. attach the video and screenshots to GitHub; keep the returned URLs
node .claude/skills/playwright-evidence/scripts/upload-evidence-attachments.cjs \
  [--slug <branch-slug>] > /tmp/todo-evidence/uploads.json

# 2. build the PR-body section around those URLs
node .claude/skills/playwright-evidence/scripts/build-evidence-pr-block.cjs \
  [--slug <branch-slug>] --attachments "$(cat /tmp/todo-evidence/uploads.json)"
```

Paste the output as the PR description's "Agent Evidence" section. `--slug`
is required on a detached HEAD; otherwise it defaults to the current branch
with `/` replaced by `-`.

The upload posts each file to
`https://uploads.github.com/user-attachments/assets` with the `gh` CLI's
token and returns the same `https://github.com/user-attachments/assets/<uuid>`
URLs a manual drag-and-drop produces — GitHub renders a bare video URL as an
inline player and an `![](...)` image URL inline.

**Size ceilings** are enforced before the upload is spent: 10 MB for images,
and for video 10 MB on a free plan or 100 MB on a paid one. The script reads
the owner's plan to choose; a user-owned repo (this one) has no org to ask,
so it assumes the conservative 10 MB. A 1280×900 storyboard of a few scenes
lands well under that, but a long recording will be rejected — trim the
storyboard rather than raising the limit.

## When the upload fails

The endpoint is undocumented and has no SLA — treat a failure as normal and
never let it block the PR:

1. The script reports each failure on stderr and still prints the URLs that
   succeeded. Use them; do not retry in a loop.
2. For a file that did not upload, the PR block names the local path
   instead. Deliver that file to the user through the session's
   file-delivery mechanism (not just a folder path) and say in the PR body
   that the attachment is pending their drag-in.
3. Missing evidence is a **human** action: never create a GitHub Release,
   tag, Gist, evidence branch, or external host to work around it.
