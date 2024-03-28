import {IIssues, ILogger, Issue,} from "./github/types";

export type IssueEvent =
  | "opened"
  | "deleted"
  | "closed"
  | "reopened"
  | "labeled"
  | "unlabeled"
  | "transfered";

type EventNames = "workflow_dispatch" | "issues" | string;

type Payload = {
  action?: IssueEvent | string;
  inputs?: { excludeClosed?: "true" | "false" };
  issue?: Issue;
  label?: {
    id: number;
    name: string;
  };
};

export type GitHubContext = {
  eventName: EventNames;
  payload: Payload;
  config?: {
    labels?: string[];
  };
};

const toLowerCase = (array: string[]): string[] =>
  array.map((a) => a.toLowerCase());

export class Synchronizer {
  constructor(
    private readonly sourceIssueKit: IIssues,
    private readonly targetIssueKit: IIssues,
    private readonly logger: ILogger,
  ) {}

  async synchronizeIssue(context: GitHubContext): Promise<void> | never {
    if (context.eventName === "workflow_dispatch") {
      const excludeClosed = context.payload.inputs?.excludeClosed === "true";
      this.logger.notice(
        excludeClosed
          ? "Closed issues will NOT be synced."
          : "Closed issues will be synced.",
      );
      return await this.updateAllIssues(
        excludeClosed,
        context.config?.labels,
      );
    } else if (context.eventName === "issues") {
      this.logger.debug(
        `Required labels are: '${JSON.stringify(context.config?.labels)}'`,
      );
      this.logger.debug("Payload received: " + JSON.stringify(context.payload));
      const { issue } = context.payload;
      if (!issue) {
        throw new Error("Issue payload object was null");
      }
      this.logger.debug(`Received event: ${context.eventName}`);
      if (this.shouldAssignIssue(context.payload, context.config?.labels)) {
        this.logger.info(`Copying #${issue.number} to target organization`);
        return this.targetIssueKit.createIssue(issue)
      } else {
        return this.logger.info(
          "Skipped assigment as it didn't fullfill requirements.",
        );
      }
    } else {
      const failMessage = `Event '${context.eventName}' is not expected. Failing.`;
      this.logger.warning(failMessage);
      throw new Error(failMessage);
    }
  }

  /**
   * Labels can be either an array of objects or an array of string (or maybe both?)
   * This functions cleans them and returns all the labels names as a string array
   */
  convertLabelArray(labels?: (string | { name?: string })[]): string[] {
    if (!labels || labels.length === 0) {
      return [];
    }
    const list: string[] = [];

    labels.forEach((label) => {
      if (typeof label === "string" || label instanceof String) {
        list.push(label as string);
      } else if (label.name) {
        list.push(label.name);
      }
    });

    return list;
  }

  /**
   * Method which takes all of the (predicted) cases and calculates if the issue should be assigned or skipped
   * @param payload object which contains both the event, the issue type and it's information
   * @param labels labels required for the action. Can be null or empty
   * @returns true if the label should be assigned, false if it should be skipped
   */
  shouldAssignIssue(payload: Payload, labels?: string[]): boolean {
    const action = payload.action as IssueEvent;

    if (action === "labeled") {
      const labelName = payload.label?.name;
      // Shouldn't happen. Throw and find out what is this kind of event.
      if (!labelName) {
        throw new Error("No label found in a labeling event!");
      }

      this.logger.info(`Label ${labelName} was added to the issue.`);

      // If this is a labeling event but there are no labels in the config we skip them
      if (!labels || labels.length === 0) {
        this.logger.notice(
          "No required labels found for event. Skipping assignment.",
        );
        return false;
      }

      if (toLowerCase(labels).indexOf(labelName.toLowerCase()) > -1) {
        this.logger.info(
          `Found matching label '${labelName}' in required labels.`,
        );
        return true;
      }
      this.logger.notice(
        `Label '${labelName}' does not match any of the labels '${JSON.stringify(labels)}'. Skipping.`,
      );
      return false;
    } else if (action === "unlabeled") {
      this.logger.warning("No support for 'unlabeled' event. Skipping");
      return false;
    }

    // if no labels are required and this is not a labeling event, assign the issue.
    if (!labels || labels.length === 0) {
      this.logger.info(
        "Matching requirements: not a labeling event and no labels found in the configuration.",
      );
      return true;
    }
    // if the issue in this event has labels and a matching label config, assign it.
    const issueLabels = payload.issue?.labels ?? null;
    if (labels.length > 0 && issueLabels && issueLabels.length > 0) {
      // complex query. Sanitizing everything to a lower case string array first
      const parsedLabels = toLowerCase(this.convertLabelArray(issueLabels));
      const requiredLabels = toLowerCase(labels);
      // checking if an element in one array is included in the second one
      const matchingElement = parsedLabels.some((pl) =>
        requiredLabels.includes(pl),
      );
      if (matchingElement) {
        this.logger.info(
          `Found matching element between ${JSON.stringify(parsedLabels)} and ${JSON.stringify(labels)}`,
        );
        return true;
      }
      return false;
    }

    this.logger.debug(
      `Case ${action} not considered. Accepted with the following payload: ${JSON.stringify(payload)}`,
    );
    return true;
  }
  private async updateAllIssues(
    excludeClosed = false,
    labels?: string[],
  ): Promise<void> | never {
    const issues = await this.sourceIssueKit.getAllIssues(excludeClosed, labels);
    if (issues?.length === 0) {
      return this.logger.notice("No issues found");
    }
    this.logger.info(`Updating ${issues.length} issues`);

    const issueCreateInDestinationPromises = issues.map((issue) =>
        this.targetIssueKit.createIssue(issue),
    );
    await Promise.all(issueCreateInDestinationPromises);
  }

}
