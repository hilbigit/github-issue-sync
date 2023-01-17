
# Introduction

This project enables syncing GitHub Issues to a [GitHub Project](https://docs.github.com/en/issues/planning-and-tracking-with-projects/learning-about-projects/about-projects).

## Why is this necessary?

GitHub projects are a nice tool to organize many repositories and issues while staying inside their ecosystem (and an alternative to those project management tools we all know). They [provide some automation to migrate the state of issues inside the projects](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-built-in-automations), but their **current** biggest weakness is that it doesn't provide any kind of auto assignment. When you create an issue, you need to manually assign it to a project. If you are an external collaborator you don't have permissions to interact with the projects.
This action brings such necessary automation, it allows issues to be automatically assigned to a project. 
Hopefully, GitHub will provide this automation in the near future and make this action redundant.

**This action works well in combination with [GitHub's Project Automation](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-built-in-automations)**.


# How it works
The following events trigger the synchronization of an issue into the project:
- [`issues`](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#issues)
	- `opened`
	- `reopened`
	- `labeled`
- [`workflow_dispatch`](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#workflow_dispatch)

The action will sync any newly created or reopened issue, but, those that were already in the project won't be synced. To solve this problem we provide the `workflow_dispatch` action which will fetch and sync all available issues in your repository.
To use it go to your repository and then select: `Action tab` -> `GitHub Issue Sync` -> `Run workflow`.
You have the option of exclude closed issues from this iteration, and once you run the workflow it will automatically sync all the existing issues into their corresponding project.

## Setup
To have the action working in your repository you need to create the file `.github/workflows/github-issue-sync.yml` in your repository with the following content:
```yaml
name: GitHub Issue Sync

on:
  issues:
    types:
      - opened
      - reopened
      - labeled
  workflow_dispatch:
    inputs:
      excludeClosed:
        description: 'Exclude closed issues in the sync.'
        type: boolean 
        default: true

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - name: Sync issues
        uses: paritytech/github-issue-sync@master
        with:
          # This token is autogenerated by GitHub
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          # This is a Personal Access Token and it needs to have the following permissions
          # - "read:org": used to read the project's board
          # - "write:org": used to assign issues to the project's board
          PROJECT_TOKEN: ${{ steps.generate_token.outputs.token }}
          # The number of the project which the issues will be synced to
          # You can find this in https://github.com/orgs/@ORGANIZATION/projects/<NUMBER>
          project: 4
```
You can generate a new token [in your user's token dashboard](https://github.com/settings/tokens/new).
### Using a GitHub app instead of a PAT
In some cases, specially in big organizations, it is more organized to use a GitHub app to authenticate, as it allows us to give it permissions per repository and we can fine-grain them even better. If you wish to do that, you need to create a GitHub app with the following permissions:
- Repository permissions:
  - [x] Metadata
- Organization permissions
	- Projects
		- [x] Read
		- [x] Write

Because this project is intended to be used with a token we need to do an extra step to generate one from the GitHub app:
- After you create the app, copy the *App ID* and the *private key* and set them as secrets.
- Then you need to modify the workflow file to have an extra step:
```yml
    steps:
      - name: Generate token
        id: generate_token
        uses: tibdex/github-app-token@v1
        with:
          app_id: ${{ secrets.APP_ID }}
          private_key: ${{ secrets.PRIVATE_KEY }}
      - name: Sync issues
        uses: paritytech/github-issue-sync@master
        with:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          # The previous step generates a token which is used as the input for this action
          PROJECT_TOKEN: ${{ steps.generate_token.outputs.token }}
```

## Development
To work on this app, you require
- `Node 18.x`
- `yarn`
Use `yarn install` to set up the project.
`yarn test` runs the unit tests.
`yarn build` compiles the TypeScript code to JavaScript.
