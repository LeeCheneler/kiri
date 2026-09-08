# Quickstart

Install Kiri, connect a model, and have your first conversation.
You'll need **macOS on Apple silicon**, Homebrew, and access to a model.

## Install and initialise

```sh
brew install LeeCheneler/kiri/kiri
mkdir -p ~/kiri-workspace
cd ~/kiri-workspace
kiri init
```

This folder is your workspace. You can use an existing folder instead.
[Other install options](/docs/cli-reference#install-and-upgrade).

## Connect a model

Before starting Kiri, edit `kiri.yaml` in your workspace. For an Anthropic
API key, use:

```yaml
providers:
  anthropic:
    type: anthropic
    api_key: { env: ANTHROPIC_API_KEY }
```

Add `.env` to your workspace’s `.gitignore`, then create `.env` beside
`kiri.yaml` and add your key:

```sh
ANTHROPIC_API_KEY=your-api-key
```

Keep the key in `.env`, never in `kiri.yaml`. Your provider bills model usage separately.

Using another provider or a local model? Follow
[Models & providers](/docs/llm-providers), then continue below.

## Open Kiri

From your workspace folder, run:

```sh
kiri
```

Open [local.kiri.build](https://local.kiri.build). If your browser cannot
connect, use [localhost:4242](http://localhost:4242) directly.
Keep the terminal running while you use Kiri. If you change `.env` later,
stop Kiri with **Ctrl+C** and start it again.

## Have a conversation

Click **+ New session**. To change the selected model, open **settings**
(the gear in the message box). Then try:

> Help me plan a small personal project: an app that shows when the northern
> lights might be visible. Ask me about the scope before suggesting a plan.

Answer the assistant's questions and work through the idea. No file access
or extra tools are needed for this first conversation.

When you have something worth keeping, try:

> Save our plan as an article.

Open the article from the conversation or activity feed. You can ask the
assistant to update it as your thinking changes.

## Next

- [Have a conversation](/docs/sessions) — writing, attachments, and finding earlier answers.
- [Work with files](/docs/working-with-files) — enable file access for research and coding.
- [Projects & memories](/docs/projects-and-memories) — keep related work together.
