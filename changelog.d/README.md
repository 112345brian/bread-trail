# Changelog fragments

Add one fragment for every user-visible change in the same commit as that
change. Use an orphan fragment because this project does not require an issue
number:

```
changelog.d/+short-description.feature.md
changelog.d/+short-description.fix.md
changelog.d/+short-description.change.md
```

Write one concise, user-facing sentence. At release time, `npm version
patch`, `npm version minor`, or `npm version major` compiles all fragments into
`CHANGELOG.md`, removes them, updates the plugin metadata, creates the git
commit, and creates an unprefixed version tag.

Use `uvx towncrier build --draft --version 1.2.31` to preview the next release
without changing files.
