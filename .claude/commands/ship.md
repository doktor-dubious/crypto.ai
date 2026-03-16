---
model: haiku
allowed-tools: Bash, Read, Glob, Grep
---

Stage all changes, commit with a descriptive message, and push to the current remote branch.

Steps:
1. Run `git status` to see all changes and `git log --oneline -5` to see recent commit style.
2. Run `git diff` and `git diff --cached` to understand what changed.
3. Stage all changes with `git add -A`.
4. Write a concise commit message that follows the repository's existing commit style. End with:
   Authored-By: Rune Skardhamar <rune@predictioninstitute.com>
5. Commit the changes.
6. Push to the current branch's remote tracking branch. If no upstream is set, push with `git push -u origin HEAD`.

If the user provided an argument, use it as the commit message instead of generating one.
