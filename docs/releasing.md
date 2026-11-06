# Releases & Versioning

CardiPaw follows [Semantic Versioning](https://semver.org/). The version is shown at the bottom of the About section on the Settings page and links to its release notes.

Releases are automated by the [Release workflow](../.github/workflows/release.yml), which runs daily and can be started manually from the Actions tab:

1. If no commits have been merged into `main` since the last `vX.Y.Z` tag, the run stops.
2. The commit must pass the same [checks as CI](../CONTRIBUTING.md#development) (lint, type-check, tests, locale check, link check, build and `npm audit`); otherwise nothing is released.
3. [GitVersion](https://gitversion.net/) determines the next version from the commit messages since that release (see [PR titles](../CONTRIBUTING.md#pr-titles) and [`GitVersion.yml`](../GitVersion.yml)).
4. [`scripts/set-version.mjs`](../scripts/set-version.mjs) stamps that version into `package.json` and `package-lock.json`, from which the app reads it at build time. You can run it locally with `npm run set-version -- 1.2.3`.
5. The website is deployed, the Docker image is pushed with the new version tags, and the Android APK is built and signed (see [Release signing](#release-signing)).
6. The commit is tagged `vX.Y.Z` and a GitHub release is created with the APK attached and a changelog that lists every commit merged since the previous release. When a PR's description has a `## Release notes` section (see the [PR template](../.github/pull_request_template.md)), that text is quoted under the PR's line; a section that only says NONE or N/A adds nothing. If a PR's description can't be read, was edited after the PR was merged, or its notes contain raw HTML, footnotes or link reference definitions (which can break out of the quote), its line is listed without notes and the run shows a warning.

If the deploy, the Docker image or the APK fails, nothing is tagged, and the next run retries with the same version.

The version is not committed back to the repository: the git tags are the source of truth, so `package.json` stays at `0.0.0` on `main`.

## Release signing

The [Release workflow](../.github/workflows/release.yml) calls [`android-release.yml`](../.github/workflows/android-release.yml):

- One job builds an **unsigned** release APK with Gradle.
- A second job, on a fresh runner that installs no npm packages and runs no Gradle, signs it with the SDK's `apksigner` through [`scripts/android-apk.mjs`](../scripts/android-apk.mjs).
- So no dependency code can reach the signing key.
- The script also checks that the APK's version matches the release, and that the APK verifies with exactly one signer whose certificate matches `ANDROID_CERT_SHA256`.

It needs:

| Name | Kind | Value |
| --- | --- | --- |
| `ANDROID_KEYSTORE_BASE64` | secret in the `android-signing` environment | the keystore file, base64 on one line |
| `ANDROID_KEYSTORE_PASSWORD` | secret in the `android-signing` environment | its password (a PKCS12 keystore, keytool's default, uses the same password for the key) |
| `ANDROID_KEY_ALIAS` | secret in the `android-signing` environment | the key's alias, e.g. `cardipaw` |
| `ANDROID_CERT_SHA256` | repository variable | the certificate's SHA-256 fingerprint; public, it is printed in every release's notes. Case and colons don't matter, so keytool's `AB:CD:…` works as is |

The secrets live in a GitHub [environment](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments) that only the signing job names, so no other job can read them, and that only `main` may use.

If a secret or the variable is missing, or the APK's certificate doesn't match `ANDROID_CERT_SHA256`, the APK job fails with a message that names it. A wrong password or alias fails in `apksigner`, which says which. Either way nothing is tagged.

One-time setup. keytool is in the JDK's `bin` folder, which usually isn't on the `PATH`: for example `"/c/Program Files/Java/jdk-21/bin/keytool"` in Git Bash or `& "$env:JAVA_HOME\bin\keytool"` in PowerShell; Android Studio has one in `jbr/bin`.

```bash
# The environment, usable only from main (or in Settings → Environments: a new environment
# android-signing whose deployment branches are limited to main).
gh api -X PUT 'repos/{owner}/{repo}/environments/android-signing' \
  -F 'deployment_branch_policy[protected_branches]=false' \
  -F 'deployment_branch_policy[custom_branch_policies]=true'
gh api -X POST 'repos/{owner}/{repo}/environments/android-signing/deployment-branch-policies' \
  -f name=main -f type=branch

keytool -genkeypair -v -keystore cardipaw-release.jks -alias cardipaw -keyalg RSA -keysize 4096 -validity 36500
base64 -w0 cardipaw-release.jks | gh secret set ANDROID_KEYSTORE_BASE64 --env android-signing
read -rsp 'Keystore password: ' p; echo; printf %s "$p" | gh secret set ANDROID_KEYSTORE_PASSWORD --env android-signing; unset p
gh secret set ANDROID_KEY_ALIAS --env android-signing --body cardipaw
keytool -list -v -keystore cardipaw-release.jks -alias cardipaw   # copy the "SHA256:" value
gh variable set ANDROID_CERT_SHA256 --body "<that value>"
```

Don't type the password into `gh secret set` itself in Git Bash: it has no hidden prompt there. The `read -rs` line above keeps it off the screen and out of the history. In PowerShell or Windows Terminal, `gh secret set ANDROID_KEYSTORE_PASSWORD --env android-signing` does prompt without echoing.

In PowerShell, encode the keystore with `[Convert]::ToBase64String([IO.File]::ReadAllBytes("$PWD\cardipaw-release.jks")) | gh secret set ANDROID_KEYSTORE_BASE64 --env android-signing`. Don't use `certutil -encode`: it adds header lines.

**The key is permanent.** Every future APK must be signed with it. If it is lost, no installed copy can ever be updated again, and users would have to uninstall, which deletes their data. Keep at least two offline backups of the `.jks` file and its password, and never commit it (`.gitignore` covers `*.jks`).

**Google Play ([#85](https://github.com/wesleyegbertsen/CardiPaw/issues/85)):** use this key as Play's *app signing* key, not only as the upload key. Otherwise Play installs and GitHub APKs can't update each other.
