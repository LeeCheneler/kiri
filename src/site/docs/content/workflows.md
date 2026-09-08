# Create a workflow

A workflow is a saved task you run from a button. Use one when you want the
same steps again: a project brief, release notes, or a review of open pull
requests. It runs when you start it, while Kiri is open.

## Start with a task you understand

Work through the task in a [session](/docs/sessions) first. For example,
with [file access enabled](/docs/working-with-files):

> Read this repo's recent commits and write a short project update.
> Group it into progress, decisions, and next steps.

Adjust the result until it is useful. A one-off answer can stay in the session.

## Ask to save a workflow

When you want to repeat the task, ask:

> Create a workflow that reads the last week's commits and writes this kind
> of update as an article. Use the same model as this session.

Kiri writes a YAML file under `workflows/` and shows the change for approval.
The file describes the commands and model calls it will run. Review those
steps before approving; workflow scripts run with your user's permissions.
Creating a workflow does not run it.

## Run it

Open **Workflows**, choose the workflow, and click **Run**. If it takes inputs,
fill them in first. The run page shows progress and each step's output.
A workflow configured to produce an article links the finished page there
and in the activity feed.

You can also ask a session to run a workflow. Kiri asks for approval by default.

## Change it as you learn

Ask a session to update the workflow when your needs change, or edit its YAML
yourself. Changes appear in Kiri automatically. The next run uses the current
definition; previous runs keep their results.

## Write your own

- [Workflow authoring](/docs/workflow-authoring) — build up a workflow with shell and model steps.
- [Recipes](/docs/recipes) — complete examples to adapt.
- [Workflow reference](/docs/workflow-reference) — every field and execution rule.
