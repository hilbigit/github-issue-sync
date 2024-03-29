import {GitHub} from "@actions/github/lib/utils";

import {IIssues, Issue, Repository} from "./types";
import {CoreLogger} from "src/github/CoreLogger";

export class IssueApi implements IIssues {
  /** Requires permissions to the repository with access to the repo */
  constructor(
    private readonly octokit: InstanceType<typeof GitHub>,
    private readonly repoData: Repository,
    private readonly logger = new CoreLogger()

) {}

  async getIssueState(issueId: number): Promise<"open" | "closed"> {
    const { owner, repo } = this.repoData;
    const issueData = await this.octokit.rest.issues.get({
      repo,
      owner,
      issue_number: issueId,
    });
    return issueData.data.state === "open" ? "open" : "closed";
  }

  async getAllIssues(
    excludeClosed: boolean,
    labels?: string[],
  ): Promise<Issue[]> {
    const allIssues = await this.octokit.rest.issues.listForRepo({
      ...this.repoData,
      state: excludeClosed ? "open" : "all",
      labels: labels?.join(","),
    });
    return allIssues.data;
  }

  async createIssue(issue: Issue, ) {
      this.logger.info(`Copying #${issue.number} to target repo ${this.repoData.owner}/${this.repoData.repo}, labels=${JSON.stringify(issue.labels)}`);

      let create_issue_response = await this.octokit.rest.issues.create({
        ...this.repoData,
        title: issue.title!,
        labels: issue.labels,
        body: issue.body!,

      });
      return create_issue_response.data;
    }
}

