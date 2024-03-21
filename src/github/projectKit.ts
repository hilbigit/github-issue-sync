import { graphql } from "@octokit/graphql";

import { FieldValues, ILogger, IProjectApi, Issue, Repository } from "./types";

type NodeData = { id: string; title: string };
type FieldData = {
  name: string;
  id: string;
  options?: { name: string; id: string }[];
};

export const PROJECT_V2_QUERY = `
query($organization: String!, $number: Int!) {
  organization(login: $organization){
    projectV2(number: $number) {
      id
      title
    }
  }
}
`;

export const ADD_PROJECT_V2_ITEM_BY_ID_QUERY = `
mutation($project: ID!, $issue: ID!) {
  addProjectV2ItemById(input: {projectId: $project, contentId: $issue}) {
    item {
      id
    }
  }
}
`;

export const PROJECT_FIELD_ID_QUERY = `
query($project: ID!) {
  node(id: $project) {
    ... on ProjectV2 {
      fields(first: 20) { 
        nodes {
          ... on ProjectV2Field {
            id
            name
          }
          ... on ProjectV2IterationField {
            id
            name
            configuration {
              iterations {
                startDate
                id
              }
            }
          }
          ... on ProjectV2SingleSelectField {
            id
            name
            options {
              id
              name
            }
          }
        }
      }
    }
  }
}
`;

export const UPDATE_PROJECT_V2_ITEM_FIELD_VALUE_QUERY = `
mutation (
  $project: ID!
  $item: ID!
  $targetField: ID!
  $targetFieldValue: String!
) {
  updateProjectV2ItemFieldValue(
    input: {
      projectId: $project
      itemId: $item
      fieldId: $targetField
      value: {
        singleSelectOptionId: $targetFieldValue
        }
      }
    ) {
    projectV2Item {
      id
    }
  }
}
`;
export const CREATE_ISSUE_QUERY = `
mutation CreateIssue($title: String!, $body: String!, $repo_id: ID!) {
  createIssue(input: {repositoryId: $repo_id, title: $title, body: $body}) {
    issue {
      number
      body
    }
  }
}`;
export const FIND_REPOSITORY_QUERY = `
query FindRepo($organization: String!, $repo: String!) {
  repository(owner: $organization, name: $repo) {
    id
  }
}`;

/**
 * Instance that manages the GitHub's project api
 * ? Octokit.js doesn't support Project v2 API yet so we need to use graphQL
 * Used this blog post as a reference for the queries: https://www.cloudwithchris.com/blog/automate-adding-gh-issues-projects-beta/
 */
export class ProjectKit implements IProjectApi {
  private projectNode: NodeData | null = null;

  async changeIssueStateInProject(
    issueCardId: string,
    project: NodeData,
    fields: FieldValues,
  ): Promise<void> {
    try {
      const op = await this.gql(UPDATE_PROJECT_V2_ITEM_FIELD_VALUE_QUERY, {
        project: project.id,
        item: issueCardId,
        targetField: fields.field,
        targetFieldValue: fields.value,
      });

      this.logger.debug("Returned " + JSON.stringify(op));
    } catch (e) {
      throw new Error(
        "Failed while executing the 'UPDATE_PROJECT_V2_ITEM_FIELD_VALUE_QUERY' query",
        { cause: e },
      );
    }
  }

  /**
   * Get all the project fields in a project, with their node ids and available options
   * @returns A collection of all the fields available in the issue item
   */
  async getProjectFields(projectId: string): Promise<FieldData[]> {
    try {
      type returnType = { node: { fields: { nodes: FieldData[] } } };
      const projectData = await this.gql<returnType>(PROJECT_FIELD_ID_QUERY, {
        project: projectId,
      });

      this.logger.debug(
        "correct node data: " +
          JSON.stringify(projectData.node.fields.nodes[0]),
      );
      return projectData.node.fields.nodes;
    } catch (e) {
      this.logger.error("Failed while executing the 'PROJECT_V2_QUERY' query");
      throw e;
    }
  }

  /** Requires an instance with a PAT with the 'write:org' permission enabled */
  constructor(
      private readonly gql: typeof graphql,
      private readonly repoData: Repository,
      private readonly projectNumber: number,
      private readonly logger: ILogger,
      private readonly gqlDestination: typeof graphql | undefined,
      private readonly destination_org: string, private readonly destination_reponame: string
  ) {}

  async fetchProjectData(): Promise<NodeData> {
    if (this.projectNode) {
      return this.projectNode;
    }

    try {
      // Source: https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects#using-variables
      const projectData = await this.gql<{
        organization: { projectV2: NodeData };
      }>(PROJECT_V2_QUERY, {
        organization: this.repoData.owner,
        number: this.projectNumber,
      });

      this.projectNode = projectData.organization.projectV2;

      return projectData.organization.projectV2;
    } catch (e) {
      throw new Error("Failed while executing the 'PROJECT_V2_QUERY' query", {
        cause: e,
      });
    }
  }

  async updateProjectNextItemField(
    project: string,
    item: string,
    targetField: string,
    targetFieldValue: string,
  ): Promise<void> {
    await this.gql(UPDATE_PROJECT_V2_ITEM_FIELD_VALUE_QUERY, {
      project,
      item,
      targetField,
      targetFieldValue,
    });
  }

  async assignIssueToProject(issue: Issue, projectId: string): Promise<string> {
    try {
      const migration = await this.gql<{
        addProjectV2ItemById: { item: { id: string } };
      }>(ADD_PROJECT_V2_ITEM_BY_ID_QUERY, {
        project: projectId,
        issue: issue.node_id,
      });

      return migration.addProjectV2ItemById.item.id;
    } catch (e) {
      throw new Error(
        "Failed while executing 'ADD_PROJECT_V2_ITEM_BY_ID_QUERY' query",
        { cause: e },
      );
    }
  }

  async fetchProjectFieldNodeValues(
    project: NodeData,
    projectFields?: FieldValues,
  ): Promise<FieldValues> {
    if (!projectFields) {
      throw new Error("'projectsFields' is null!");
    }

    const projectFieldData = await this.getProjectFields(project.id);

    const { field, value } = projectFields;

    // ? Should we use .localeCompare here?
    const customField = projectFieldData.find(
      ({ name }) => name.toUpperCase() === field.toUpperCase(),
    );

    // check that this custom field exists and it has available options to set up
    if (!customField) {
      throw new Error(`Field ${field} does not exist!`);
    } else if (!customField.options) {
      throw new Error(
        `Field ${field} does not have any available options!.` +
          "Please add options to set values",
      );
    }

    this.logger.debug(`Custom field '${field}' was found.`);

    // search for the node element with the correct name.
    const fieldOption = customField.options.find(
      ({ name }) => name.toUpperCase() === value.toUpperCase(),
    );
    if (!fieldOption) {
      const valuesArray = customField.options.map((options) => options.name);
      throw new Error(
        `Project value '${value}' does not exist. Available values are ${JSON.stringify(valuesArray)}`,
      );
    }

    this.logger.debug(`Field options '${value}' was found.`);

    return { field: customField.id, value: fieldOption.id };
  }

  async assignIssue(issue: Issue, project: NodeData): Promise<string> {
    this.logger.info(`Syncing issue #${issue.number} for ${project.title}`);

    return await this.assignIssueToProject(issue, project.id);
  }


  async createIssue(issue: Issue) {
    if (this.gqlDestination != undefined) {
      let gql: typeof graphql = this.gqlDestination;
      this.logger.info(`Creating issue #${issue.number} in org=${this.destination_org}`);

      type returnType = { repository: { id: string } };
      let repo: returnType = await gql<returnType>(FIND_REPOSITORY_QUERY, {
        organization: this.destination_org, repo: this.destination_reponame
      });

      let repo_id = repo?.repository.id;

      let create_issue_response = await this.gqlDestination!(CREATE_ISSUE_QUERY, {
        title: issue.title,
        body: issue.body,
        repo_id: repo_id,
      });
      return create_issue_response;
    }

  }
}
