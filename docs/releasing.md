# Preparing a release

Public source: https://github.com/VKirill/bb-plugin-moa. Marketplace acceptance is a separate maintainer review; a GitHub release alone does not imply acceptance.

1. Run `npm ci`, `npm run check`, and `bb plugin types --check` on the declared BB release.
2. Test parallel A/B routing, follow-up history, off/on and reload in an isolated chat. Verify failure leaves its message queued. Stop/archive test workers afterward.
3. Recheck Send now bypass and composer placement on new BB releases. Do not claim unbypassable routing without a supported provider API and tests.
4. Verify repository/homepage/bugs fields and the authenticated GitHub account before publishing.
5. Set version/engine ranges, build, and inspect `npm pack --dry-run --json`. Exclude transcripts, personal screenshots, credentials, `.bb`, `node_modules` and machine paths.
6. Commit source and lockfile in the standalone repository. npm/release artifacts need `dist` and generated metadata. Git installs must build with development dependencies omitted.
7. Take clean screenshots in a demonstration workspace; do not publish private chats.
8. Publish or submit only when requested, following BB's current Community marketplace contract.

Rollback: turn MoA off in affected chats, then disable the plugin or reinstall the last known-good release. Disabling releases pending requests; do not upgrade while a consultation is being delivered.
