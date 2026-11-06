# Security policy

## Reporting a vulnerability

Please don't report a security problem in a public issue. Report it privately on GitHub instead: [report a vulnerability](https://github.com/wesleyegbertsen/CardiPaw/security/advisories/new), also under this repository's **Security** tab. Only the maintainer can see the report until an advisory is published.

Say what is affected (the website, the Android app or the Docker image, and which version), how to reproduce it, and what someone could do with it.

CardiPaw is maintained by one person in their spare time, so there is no fixed response time. Replies, and the fix, come in the advisory; the fix ships in a normal release. The advisory credits you unless you'd rather not be named.

## Supported versions

Only the latest release is fixed. cardipaw.com always runs it; the Android app and the Docker image get a fix by [updating the app](docs/android.md#updating) or [pulling the new image](docs/self-hosting.md).

## What to look at

CardiPaw has no server and no accounts: pet data stays on the device (see [Privacy](README.md#privacy)). The reports that matter most are about data leaving the device or code running where it shouldn't, for example through:

- a share link, an imported backup file or a pet note
- the Content-Security-Policy ([`nginx.conf`](nginx.conf), and [`src/native/csp.ts`](src/native/csp.ts) for the Android app)
- the Docker image
- how release APKs are built and signed ([Release signing](docs/releasing.md#release-signing))

A known advisory in a dependency, with no way to exploit it in CardiPaw, can go in a normal issue.
