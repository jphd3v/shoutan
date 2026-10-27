# Hosting and releases

Shoutan lives in two places besides the phones: a Supabase project, which it may share with other apps, and the private GitHub repository. In a shared project it owns only Go's namespace: the schema `go`, the roles `go_owner` and `go_reports`, and its entry in the list of exposed schemas. `npm run infra` never creates, replaces or deletes a shared project. Without `SUPABASE_PROJECT_REF` it creates and manages a project of its own instead.

There are three builds. Each has its own package ID, so they install side by side, and each keeps its own game, settings and login on the phone. Shoutan Dev is the next version of Shoutan. Both use the schema `go`, so they play each other online, and the same e-mail is the same player in both.

| Build         | Android package                  | Database schema                    |
| ------------- | -------------------------------- | ---------------------------------- |
| Shoutan Local | `io.github.jphd3v.shoutan.local` | `public` on the local Docker stack |
| Shoutan Dev   | `io.github.jphd3v.shoutan.dev`   | `go`                               |
| Shoutan       | `io.github.jphd3v.shoutan`       | `go`                               |

The app opens into offline play, which needs no account. Online play and feedback need a login: the player signs in with a code sent by e-mail, with no password and no anonymous users, then joins once with a name and the family code. Losing the connection leaves offline play working. Clearing the app's data signs the phone out, and signing in with the same e-mail brings back the player and their online games.

## Setting up the hosting

Everything hosted is described by one file outside the repository, `~/.config/shoutan/infra.env`, and built by one command:

1. Copy `infra/infra.env.example` to `~/.config/shoutan/infra.env` and fill it in. Each field says where its value comes from. Only one needs a website: a Supabase access token.
2. Restore the signing key from your backup. For the very first setup, `npm run infra` prints the `keytool` command that creates one.
3. Run `gh auth login`, then `npm run infra -- --plan` to see what would change, and `npm run infra` to do it.

`npm run infra` creates or repairs, in this order:

- **Supabase.** The `go` schema with every migration, its place in the exposed schemas (it only ever adds to that list), the family code and the `go_reports` password, and it checks that the reports login connects. Sign-in settings are project-wide: it turns anonymous sign-ins off, keeps e-mail sign-in on, allows the redirect `shoutan://sign-in` and adds the one-time code to the magic-link and confirmation e-mails, keeping any links another app relies on. E-mails need the project's own mail server, set in the dashboard. In own-project mode it also creates the project.
- **Local settings.** `.env.dev.local`, `.env.prod.local`, `.env.signing.local` and `~/.config/shoutan/reports.env`, all readable only by you.
- **GitHub.** The repository (created private if missing), `origin`, `main` if the repository is empty, the issue labels and every Actions secret.
- **Claude Code.** `.claude/settings.local.json`, which hides your secrets from agents.

You can run it any number of times. On an unchanged deployment it says "Everything was already in place". After dropping Go's schema or deleting the repository, run it again and Go's parts are rebuilt with empty tables. Games and reports are not recreated, and free Supabase projects have no backups. A missing shared project is never recreated. Keep a copy of the filled-in `infra.env` and the signing key somewhere safe outside the machine, such as a password manager.

The project's sign-in e-mails are shared with the other apps in it. Shoutan's code requests carry the redirect `shoutan://sign-in`, so the templates can give Shoutan its own text with `{{ if eq .RedirectTo "shoutan://sign-in" }}`, and keep the other apps' text in the `else` part. `supabase/templates/` holds the magic-link and confirmation templates in that shape, and `supabase/config.toml` their subjects. The local stack uses them as they are. For a hosted project, paste them into the dashboard's e-mail templates and put another app's own text in the `else` parts. `npm run infra` leaves templates that already contain the code as they are.

`npm run status` checks the hosted side without the dashboard. It is read-only and uses the same token: project health, sign-in settings and the mail server, the exposed schemas, whether the app can reach `go`, the applied migrations, how many players, games and reports there are, the newest reports and recent database errors. Each problem comes with the step that fixes it. A listed schema that doesn't exist breaks the whole Data API (`PGRST002`). `npm run status -- --restart` restarts the project.

`npm run setup` is the developer's side: from a fresh clone it installs the dependencies, starts the local Supabase stack and runs `verify`.

## Who can do what

| Who                            | How                                            | Can                                                                                                   | Cannot                                                                                                                    |
| ------------------------------ | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| A phone                        | publishable key and e-mail login               | Once in the family: read Go's players, games and events, act through the game functions, send reports | Anything while anonymous or outside the family; read reports, family codes or the migration ledger; write tables directly |
| Game functions                 | run as `go_owner` (security definer)           | Own and change Go's tables, and what a signed-in phone may do                                         | Log in; reach anything a phone couldn't                                                                                   |
| Report polling, release checks | `go_reports` login (`GO_REPORTS_DATABASE_URL`) | Read reports, set their status and notes, read the migration ledger                                   | Read players, games, events or family codes; change a report's text; anything outside Go                                  |
| The owner                      | SQL editor, dashboard                          | Everything                                                                                            | Nothing is off limits                                                                                                     |

Nothing in this repository uses the project's secret key. `npm run test:schema` checks these boundaries, including that neither role can read another app's tables.

## Keeping other projects safe

The GitHub and Supabase accounts may hold other projects. Everything Go owns is namespaced. The Supabase credential an agent holds is limited to Go. On GitHub, agents use your own `gh` login, so they could reach your other repositories too:

| Account  | Go's namespace                                    | What an agent holds    | What it can't reach                                                                      |
| -------- | ------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------- |
| GitHub   | one repository, its labels and Actions secrets    | your `gh` login        | whatever your login can't                                                                |
| Supabase | schema `go` and roles `go_owner` and `go_reports` | the `go_reports` login | players, games, family codes, other schemas, the project's secret key, the account token |

`npm run infra` uses your own Supabase token and `gh` login, and refuses to run inside an agent session. Agents never read `infra.env` or the signing key; how the machine keeps them out of reach is part of its own setup, not this repository.

## Database changes

`npm run infra` applies new migrations from `supabase/migrations/` to `go` on every run. Shoutan Dev and Shoutan share that schema, so every migration must keep the released app working: add tables, columns and functions, and don't rename or drop what the released app uses until no family phone runs that version. The install is one transaction. It records each applied migration in `go.applied_migrations` and skips it later (`scripts/lib/schema.mjs`; `node scripts/schema-sql.mjs go` prints the SQL). Never run the local `public` migrations or `supabase db push` against the hosted project.

Both release workflows refuse to build when the hosted schema lacks a migration (`scripts/check-hosted-schema.mjs`). The commit guard refuses statements that can break installed apps: drops and renames, new constraints, `set not null`, revokes from `authenticated`, data updates and deletes, and replacing a function an earlier migration defined. A line can say why it is safe with `-- compatible: <reason>` or `-- breaking-ok: <reason>`. New tables and functions must belong to `go_owner`, or `test:schema` fails.

The schema starts from one baseline, `20261024120000_go`, written before the app had users. `npm run infra` decides what is pending by counting migrations, so a `go` schema installed from earlier migrations isn't upgraded to it. Drop it with `drop schema go cascade;` in the SQL editor, which deletes every game, player, record and report, and run `npm run infra` again.

## Finished-game records

A finished game is kept as a versioned record (`src/go/finished.ts`) on the phone and in the server's `game_records`. Every later release must be able to read it.

- `format` says how a record is laid out, and `core.rules` which rules version it replays under. `core` holds only what replays and scores the game, and its fields never change meaning. `meta` describes the game and may gain optional fields. `meta.player` is the owner's account id. It is absent for a game played signed out, until history sync claims it, and always there online, with the opponent's.
- Each record has one spelling, so equal records are equal JSON. Times are UTC to the millisecond, as `toISOString` writes them. `startedAt` is the first move and `endedAt` when the result was known, from the phone's clock offline and from the server's event rows online. Setup stones and dead stones are in ascending order. The setup is exactly the handicap stones on their points, with White moving first after them. Ratings are whole numbers, and numbers are spelled as `JSON.stringify` writes them (`7.5`, not `7.50`). An upload is at most 1 MB.
- A reader keeps the fields it doesn't know and writes them back when it rewrites a record, so a newer phone's additions survive an older one.
- An app that meets a newer `format` or `core.rules` keeps the record as it is and lists it as "Saved with a newer version of the app".
- The golden records in `src/go/__tests__/records/` must keep reading and replaying to their stored result. Jest replays them, and the database tests send them to `record_game`. Never edit one once a release wrote that format.
- `valid_game_record` on the server accepts exactly the format-1 records the phone's `readFinished` reads. The server never replays, so it doesn't need the rules. It refuses formats and fields it hasn't learned yet, while the phone reads past them.

A change to the record goes in this order: add golden records for it, teach `readFinished` and `valid_game_record` the same thing in one change, and apply the migration before the app that writes it is released. Never stop accepting what a released app sends.

## How online games stay honest

Go has no hidden information, so both phones check everything.

- **Hash chain.** Each event stores `prev`, the hash of the event before it, and `hash`, which covers `prev`, the event and the whole game state after it. The chain starts from a hash of the game's id, size, komi, rules version and handicap, which the database computes the same way.
- **The phones** parse each event strictly, replay it with the shared rules and compare the hashes. They also compare the stored summary (status, side to move, result, acceptances, chain head) with their own replay. `src/net/match.ts` holds this logic, and the app, the E2E opponent and the database tests all use it.
- **The database** checks seats, turn order, event numbering, that each event extends the stored chain, each event's shape, that points are on the board, and the phases of the game: scoring starts only after two passes in a row, a resignation names the right winner, and a game ends by score only after both players accept. It can't check captures or the score; the hashes cover those.
- **A disagreement stops the game.** A phone that finds a wrong hash, a malformed event, an illegal move or a summary that differs from its replay calls `dispute_game`. The game becomes `disputed` for both players, the board stays at the last move both agreed on, and an error report records the event and the reason. Network failures never stop a game.
- **Rules version.** Each game records the rules version it started with: 4, the Chinese rules of 2002 with the Chinese handicap. When a rules change would replay a game differently, bump `RULES_VERSION` in `src/go/rules.ts` and `create_game` in a new migration. An older app shows a game of a higher version as needing an update instead of disputing it.

A stopped game usually means a bug or two app versions disagreeing. Read the report, reproduce the game from its stored events with `replay()`, and fix the cause. A stopped game stays stopped, and the players start a new one.

## Testing

You need Node from `.nvmrc`, npm 12.2.0, Java 21, Docker, the Android SDK, the emulator and Maestro (`npm run maestro:install` puts the pinned version in `tools/maestro/`).

```sh
npx supabase start
npm run verify
npm run build:local
adb install -r dist/shoutan-local-*.apk
npm run test:offline   # the smoke flow, a few minutes
npm run test:online    # flows 06 to 09 against scripted opponents
npm run test:full      # before a release: the offline flows 01 to 05
```

`verify` runs the guard, Prettier, ESLint, oxlint, actionlint on the workflows, TypeScript, the unit and screen tests with coverage, and the script tests. It runs the database tests and the hosted install test only when `supabase/`, `src/net/`, `src/online/` or the schema scripts changed since `main`. `verify:all` always runs them, and CI runs it on every push.

`test:offline` runs the smoke flow (`e2e/smoke.yaml`) once in airplane mode and turns the network back on afterwards. `test:full` does the same with the offline flows `01` to `05`. `test:online` plays flows `06` to `09` against API opponents that check every event: creating and joining games, a capture, reopening a game, marking, keep playing, resigning, asking a family member to play, and sending a report. Screen behaviour is tested in Jest (`src/__tests__/app.test.tsx`), so the emulator runs only check what needs a phone. Look at the screenshots under `e2e-output/` before approving a build.

A freshly booted emulator may show a keyboard stylus tutorial that blocks typing. Dismiss it and run `adb shell settings put secure stylus_handwriting_enabled 0`.

## Releasing

Both releases are yours to start.

1. **Push to `main`, then release Shoutan Dev when there is something to try.** The `Verify Shoutan` workflow runs `verify` on every push. Run `gh workflow run "Release Shoutan Dev" --repo <owner>/<private-repo>`, or start it in Actions: it takes the newest commit on `main` that passed Verify, checks that `go` has every migration, builds and signs Shoutan Dev from it, and attaches the APK and its manifest to a private pre-release, `shoutan-dev-<code>`. Install it and play. A push alone builds nothing, so quick pushes in a row cost only their Verify runs.
2. **Release Shoutan.** Run `gh workflow run "Release Shoutan" --repo <owner>/<private-repo> -f dev_tag=shoutan-dev-<code>` with the Dev tag you tested. It first runs `Device tests` on that commit: the offline flows `01` to `05` and the online flows, on an emulator, in about half an hour. It refuses a tag that isn't a Shoutan Dev release on `main`, checks `go`, rebuilds that exact commit as Shoutan, as an APK and an app bundle (`.aab`) signed with the release key, and publishes both in a private release. Phones that installed Shoutan from Google Play update from there; an APK installed by hand doesn't update itself. Once Google Play uploads are on, the bundle also goes to Google Play's internal testing track (below); until then, upload it by hand.

A private repository has a limited monthly budget of Actions minutes. `Verify Shoutan` skips commits that only change Markdown, screenshots or the licence, and cancels a run when a newer push replaces it. The emulator tests run only for Shoutan releases and when started by hand. A Shoutan Dev build takes about ten minutes, and a Shoutan release about an hour, most of it the emulator tests.

Until the Actions secrets exist, both releases stop with a list of the missing secrets. The version code is the commit count on `main`, so each release can update the one before. Each build writes a JSON manifest next to the APK with the commit, build, version code, schema and SHA-256. The release notes list the commit subjects since the previous release of the same kind, with the issues they refer to (`scripts/release-notes.mjs`), so write commit subjects that read as release notes.

Local builds work the same way: `npm run build:dev` and `npm run build:prod` read `.env.dev.local`, `.env.prod.local` and `.env.signing.local`, need `APP_VERSION_CODE`, and refuse to build with uncommitted changes. When `.env.signing.local` exists, `npm run build:local` signs with the release key too.

Keep a backup of the signing key and its password: a phone accepts an update only when it is signed with the same key. A phone with a build signed by another key, such as a debug build, must uninstall it first. To roll back, release an earlier Dev tag only if its version code is higher than what phones have. Otherwise revert on `main` and release again. Never delete family data to roll back code.

### Google Play

The family can install Shoutan from Google Play as internal testers. `Release Shoutan` then runs one more job, `play-internal`, after the private release. It checks that the bundle is `io.github.jphd3v.shoutan` with the release's version code, then uploads it with Fastlane Supply (`fastlane/Fastfile`, pinned in `Gemfile.lock`) to the `internal` track, as a completed release. The package and the track are fixed in the Fastfile. Any error fails the run, and nothing tries another track. The lane refuses a version code that isn't above the newest on the internal track, and Play refuses one it has seen before, so only a commit newer than the last upload can go to Play. To retry a failed upload, re-run the failed job. The private release is already made.

The job is off until the repository variable `PLAY_INTERNAL_UPLOAD` is `true`. Set it up once, in this order:

1. **Create the app** in Play Console with the package `io.github.jphd3v.shoutan`.
2. **Choose Play App Signing.** Phones only update an app signed with the same key. To let family phones with an APK from GitHub update from Play, give Google the existing release key: under App signing, choose to use your own key and follow the export steps with the signing key from your backup. If Google makes the key instead, the release key becomes the upload key, which also works for these uploads. Then each phone must uninstall the GitHub APK, which loses its games and settings, before installing from Play, and the GitHub APKs can't update the Play app. This choice can't be undone.
3. **Make the first internal release by hand.** Download the `.aab` from a Shoutan release on GitHub, create a release under Testing → Internal testing, add the family's Google accounts as testers and roll it out. Play doesn't let the API upload an app that has never had a release.
4. **Create the service account.** In a Google Cloud project, enable the Google Play Android Developer API and create a service account with no roles, only for this. Create its JSON key. In Play Console, under Users and permissions, invite the service account's e-mail with no account permissions. Give it this app only, with "Release apps to testing tracks". Don't give it "Release to production" or anything else.
5. **Store the key.** Keep the JSON key outside the repository, backed up like the signing key. Put its path in `GO_PLAY_SERVICE_ACCOUNT_FILE` in `infra.env`, set `GO_PLAY_INTERNAL_UPLOAD=on` and run `npm run infra`. It stores the key as the Actions secret `PLAY_SERVICE_ACCOUNT_JSON` and sets `PLAY_INTERNAL_UPLOAD`.
6. **Release from a newer Dev tag.** The first upload reads the internal track before it uploads, so a key without access fails without changing anything. To stop uploads, set `GO_PLAY_INTERNAL_UPLOAD=off` and run `npm run infra` again.

Without branch protection on `main`, the releases rely on only the maintainer having write access.

## Reports and issues

The app saves JavaScript errors and feedback on the phone and sends them to Supabase when it can. The APK holds no GitHub credentials. The queue keeps at most 50 reports, repeated errors are grouped by fingerprint, and each report includes recent moves, online events, the app version and recent actions. Native crashes aren't reported.

`npm run sync-issues` files new reports as GitHub issues in this private repository, labelled `from-app`, `bug`, `crash` or `idea`, and `family` or `dev`. A repeated error becomes a comment on its open issue. The `Sync reports to issues` workflow runs it every six hours. Each filed report is marked `filed`, with the issue's link in its notes. `npm run reports` lists reports by status.

Your own requests are ordinary issues. When a commit that says `Refs #<issue>` reaches a release, the Dev release comments on the issue, and the Shoutan release comments and closes it.

The reports login is in `~/.config/shoutan/reports.env`: `GO_REPORTS_DATABASE_URL`, the `go_reports` database login. Run locally, the issues are filed with the maintainer's `gh` login; the workflow uses its own credential.

`.husky/pre-push` keeps agents in line where the repository has no branch protection: a push from an agent session may only move `main` forward on `origin` or the private mirrors the hook names. Deleting a branch, rewriting `main` or pushing to another remote is refused (see `AGENTS.md`).

## Publishing the source

This repository is private. It holds the Actions, the releases with their APKs and the issues filed from player reports. The source goes to a separate public repository, the `public` remote, from the local `public` branch. That branch has a history of its own, one commit per publish, authored by your public identity.

```sh
git config shoutan.publicAuthor "Name <id+username@users.noreply.github.com>"   # once, your public name and GitHub no-reply address
git config shoutan.privateTerms "Full Name, employer.example"           # once: text that must never be published
npm run publish:public -- --dry-run   # what would be published, and the checks
npm run publish:public                # commits main's source onto public
git push public public:main           # you push; `public` is the public remote
```

`scripts/publish-public.mjs` leaves out `.github/`, `.claude/`, the release tooling only the private repository runs (`fastlane/`, `Gemfile`, `Gemfile.lock`) and `.husky/pre-push`, which names the private remotes. Releases and Actions secrets aren't part of git, so they never reach the public repository. It refuses to publish when the source holds an environment file, a key or token, a hosted Supabase address, the private repository's name, any of the terms in `shoutan.privateTerms`, or an e-mail address other than placeholders and GitHub's no-reply ones. The terms live in your local git settings, so they aren't in the source either. Agents may only run the dry run. Publish the commit a family APK was built from, so the source of every APK given out is public, as the AGPL requires.
