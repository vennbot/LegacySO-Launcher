# Contributing
## Introduction

Thank you so much for your interest in contributing! All types of contributions are encouraged and valued. 

Please make sure to read the relevant section before making your contribution! It will make it a lot easier for us maintainers to make the most of it and smooth out the experience for all involved. 💚

We look forward to your contributions. 🙌🏾✨

## Request support

If you have a question about this project, how to use it, or just need clarification about something:

* Use the Support category in the Discussions platform to create a
  discussion: https://github.com/ItsSim/lsolauncher/discussions/categories/support
* Provide as much context as you can about what you're running into.
* Provide project and platform versions (nodejs, npm, etc), depending on what seems relevant. If not, please be ready to provide that information if maintainers ask for it.

Once the discussion has been created, someone from the community will try
to have a reponse soon.

## Report an error or bug

If you run into an error or bug with the project:

* Open an Issue at https://github.com/ItsSim/lsolauncher/issues.
* Fill in the provided issue template that is automatically presented when
  opening a new issue.

Once it's filed:

* The issue will initially be marked as `bug` and `needs-repro`.
* A team member will try to reproduce the issue with your provided steps. If there are no repro steps or no obvious way to reproduce the issue, the team will ask you for those steps.
* If the team is able to reproduce the issue, it will be marked `needs-fix`
  (and `needs-repro` will be removed), as well as possibly other tags (such as `critical`), and the issue will
  be left to be [implemented by someone](#contribute-code).
* If you or the maintainers don't respond to an issue for 30 days, the
  issue will be closed. If you want to come back to it, reply (once, please), and we'll
  reopen the existing issue. Please avoid filing new issues as extensions
  of one you already made.
* `critical` issues may be left open, depending on perceived immediacy and severity, even past the 30 day deadline.

## Request a feature

If the project doesn't do something you need or want it to do:

* Open an Issue at https://github.com/ItsSim/lsolauncher/issues
* Provide as much context as you can about what you're running into.
* Please try and be clear about why existing features and alternatives would not work for you.

Once it's filed:

* The project team will label the issue.
* The project team will evaluate the feature request, possibly asking you more questions to understand its purpose and any relevant requirements. If the issue is closed, the team will convey their reasoning and suggest an alternative path forward.
* If the feature request is accepted, it will be marked for implementation with `feature-accepted`, which can then be done by either by a core team member or by anyone in the community who wants to [contribute code](#contribute-code).

Note: The team is unlikely to be able to accept every single feature request that is filed. Please understand if they need to say no.

## Contribute code

We like code commits a lot! They're super handy, and they keep the project going and doing the work it needs to do to be useful to others.

Code contributions of just about any size are acceptable!

To contribute code:

* [Set up the project](https://github.com/ItsSim/lsolauncher#prerequisites-for-development).
* Make any necessary changes to the source code.
* Go to https://github.com/ItsSim/lsolauncher/pulls and open a new pull
  request with your changes targeting the `develop` branch.
* Fill in the [pull request
  template](https://github.com/ItsSim/lsolauncher/blob/master/.github/pull_request_template.md).
* If your PR is connected to an open issue, add a line in your PR's description that says `Fixes: #123`, where `#123` is the number of the issue you're fixing.

Once you've filed the PR:

* The `electron-ci-pr` CI workflow will run to evaluate your code. If any checks (linter, run, build...) fail, you will have to fix your code and push the fixes to your branch so that the PR reflects your changes.
* One or more maintainers will use GitHub's review feature to review your PR.
* If the maintainer asks for any changes, edit your changes, push, and ask for another review.
* If the maintainer decides to pass on your PR, they will thank you for the contribution and explain why they won't be accepting the changes. That's ok! We still really appreciate you taking the time to do it, and we don't take that lightly. 💚
* If your PR gets accepted, it will be marked as such, and merged into the `develop` branch soon after. An alpha release with your changes will be automatically published to https://github.com/ItsSim/lsolauncher/releases
* Once the maintainers decide to release a new version, your changes will be merged into the `main` branch and will be distributed to the masses! A proper release will be published to https://github.com/ItsSim/lsolauncher/releases
