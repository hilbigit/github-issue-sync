import {debug, error, getInput, getMultilineInput, info, setFailed,} from "@actions/core";
import {context, getOctokit} from "@actions/github";

import {CoreLogger} from "./github/CoreLogger";
import {IssueApi} from "./github/issueKit";
import {GitHubContext, Synchronizer} from "./synchronizer";


const getRequiredLabels = (): string[] => getMultilineInput("labels");

//* * Generates the class that will handle the project logic */
const generateSynchronizer = (): Synchronizer => {
  const repoToken = getInput("GITHUB_TOKEN", { required: true });
  const destinationToken = getInput("DESTINATION_TOKEN", { required: false });
  const destinationOrg = getInput("DESTINATION_ORG", { required: true });
  const destinationRepo = getInput("DESTINATION_REPO", { required: false});
  const sync_labels_disabled = getInput("SYNC_LABELS_DISABLED", { required: false});


  const { repo } = context;

  const sourceKit = new IssueApi(getOctokit(repoToken), repo);
  const destinationApi = new IssueApi(getOctokit(destinationToken?destinationToken: repoToken), {
    repo: destinationRepo ? destinationRepo: repo.repo,
    owner: destinationOrg
  });
  const logger = new CoreLogger();

  return new Synchronizer(sourceKit, destinationApi, logger, !(sync_labels_disabled && sync_labels_disabled=="true"));
};

const synchronizer = generateSynchronizer();
const labels = getRequiredLabels();

const { payload } = context;
const parsedContext: GitHubContext = {
  eventName: context.eventName,
  payload,
  config: { labels },
};

const errorHandler = (e: Error) => {
  let er = e;
  setFailed(e);
  while (er !== null) {
    debug(`Stack -> ${er.stack as string}`);
    if (er.cause != null) {
      debug("Error has a nested error. Displaying.");
      er = er.cause as Error;
      error(er);
    } else {
      break;
    }
  }
};

synchronizer
  .synchronizeIssue(parsedContext)
  .then(() => {
    info("Operation finished successfully!");
  })
  .catch(errorHandler);
