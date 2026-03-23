# opensearch-settings-cdk

## Releasing a new version

- (Almost certainly) be on latest main, with no unpublished changes
- Run `npm version (patch|minor|major)` as appropriate
- Run `git push` and `git push origin TAG` where `TAG` is the tag that `npm version` just created

The tag triggers a Github Actions job to publish to npm.
