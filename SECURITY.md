# Security

This repository publishes the results of demo trading accounts and a static website. It holds no
credentials, runs no server, and takes no input from visitors.

## What would be a security problem here

- **Private data in a published file.** Anything the project promises never to publish (see
  [docs/METHODS.md](docs/METHODS.md), section 7): trade times, tickets, broker logins or servers, file paths,
  ports, harness ids, equity, or a secret of any kind.
- **A way to make the website run someone else's code,** or load anything from outside its own address.
- **A way to change a frozen day without the checks noticing:** an edit that `node scripts/verify.mjs --all`
  accepts, a file that slips past the hooks and CI, or a break in the hash chain that goes unreported.
- **A workflow or script that could be turned against the repository:** a way to make CI or the Pages
  deployment run untrusted input, leak a token, or write outside its own folder.

A wrong figure is not a security problem but is very welcome as an ordinary issue: every number can be
recomputed from the files in `results/`.

## Reporting

Please use GitHub's **private vulnerability reporting** (the *Security* tab of this repository, then
*Report a vulnerability*) instead of a public issue, so a fix can land before the details are public. You
will get an answer; this is a small project run by one person, so please allow a few days.

## What already protects it

The allowlist that builds every public object, the privacy scan over every file and every commit, the
Content-Security-Policy on the site, the hooks and CI checks that refuse changes to frozen files, pinned
and vetted GitHub Actions with a read-only token, and the tests that exercise each of these, including
against hostile data. How they fit together: [docs/METHODS.md](docs/METHODS.md) and
[docs/DESIGN.md](docs/DESIGN.md).
