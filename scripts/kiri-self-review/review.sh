#!/bin/sh
# Pipe the working-tree diff into claude -p. The diff travels via stdin so
# nothing user-controlled ever lands in argv or a shell string; the prompt
# is a fixed literal.
set -eu
git diff | claude -p --model sonnet "Review the following git diff. Call out bugs, regressions, and unclear changes. Keep it short and concrete."
