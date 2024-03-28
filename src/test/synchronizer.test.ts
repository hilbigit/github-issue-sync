/* eslint-disable @typescript-eslint/unbound-method */
import {mock, mockReset} from "jest-mock-extended";

import {
    IIssues,
    ILogger,
    IProjectApi,
    Issue,
    NodeData,
} from "src/github/types";
import {GitHubContext, Synchronizer} from "src/synchronizer";

describe("Synchronizer tests", () => {
    const sourceKit = mock<IIssues>();
    const targetKit = mock<IIssues>();
    const logger = mock<ILogger>();
    let synchronizer: Synchronizer;

    beforeEach(() => {
        mockReset(sourceKit);
        mockReset(targetKit);
        mockReset(logger);
        synchronizer = new Synchronizer(sourceKit, targetKit, logger);
    });

    describe("synchronize Issues function", () => {
        test("should fail on invalid event name", async () => {
            const randomEventName = new Date().toDateString();
            const expectedError = `Event '${randomEventName}' is not expected. Failing.`;
            await expect(
                synchronizer.synchronizeIssue({
                    eventName: randomEventName,
                    payload: {},
                }),
            ).rejects.toThrow(expectedError);
        });

        test("should fail on issue event without payload", async () => {
            await expect(
                synchronizer.synchronizeIssue({eventName: "issues", payload: {}}),
            ).rejects.toThrow("Issue payload object was null");
        });

        test("should log when all issues will be synced", async () => {
            sourceKit.getAllIssues.mockResolvedValue([]);
            await synchronizer.synchronizeIssue({
                eventName: "workflow_dispatch",
                payload: {},
            });

            expect(logger.notice).toBeCalledWith("Closed issues will be synced.");
        });

        test("should log when only open issues will be synced", async () => {
            sourceKit.getAllIssues.mockResolvedValue([]);
            await synchronizer.synchronizeIssue({
                eventName: "workflow_dispatch",
                payload: {inputs: {excludeClosed: "true"}},
            });

            expect(logger.notice).toBeCalledWith("Closed issues will NOT be synced.");
        });
    });

    describe("update one issue", () => {
        let nodeData: NodeData;
        let ctx: GitHubContext;
        let issueNumber: number;
        beforeEach(() => {
            issueNumber = 123;
            nodeData = {id: new Date().toDateString(), title: "Update one issue"};
            ctx = {
                eventName: "issues",
                payload: {
                    issue: {node_id: "update_one_issue", number: issueNumber},
                },
            };
        });


        describe("label logic", () => {
            test("should throw error if the event is labeled and there is no label", async () => {
                ctx.payload.action = "labeled";
                await expect(synchronizer.synchronizeIssue(ctx)).rejects.toThrowError(
                    "No label found in a labeling event!",
                );
            });

            test("should skip on labeling event when config labels are null", async () => {
                ctx.payload.action = "labeled";
                ctx.payload.label = {name: "example1", id: 1};
                await synchronizer.synchronizeIssue(ctx);
                expect(logger.info).toHaveBeenCalledWith(
                    `Label ${ctx.payload.label.name} was added to the issue.`,
                );
                expect(logger.info).toHaveBeenCalledWith(
                    "Skipped assigment as it didn't fullfill requirements.",
                );
                expect(logger.notice).toHaveBeenCalledWith(
                    "No required labels found for event. Skipping assignment.",
                );
            });

            test("should skip on labeling event when config labels are empty", async () => {
                ctx.payload.action = "labeled";
                ctx.payload.label = {name: "example1", id: 1};
                ctx.config = {labels: []};
                await synchronizer.synchronizeIssue(ctx);
                expect(logger.info).toHaveBeenCalledWith(
                    `Label ${ctx.payload.label.name} was added to the issue.`,
                );
                expect(logger.info).toHaveBeenCalledWith(
                    "Skipped assigment as it didn't fullfill requirements.",
                );
                expect(logger.notice).toHaveBeenCalledWith(
                    "No required labels found for event. Skipping assignment.",
                );
            });

            test("should assign on labeling event when config labels match assigned label", async () => {
                ctx.payload.action = "labeled";
                ctx.payload.label = {name: "example2", id: 1};
                ctx.config = {labels: ["example1", "example2"]};
                await synchronizer.synchronizeIssue(ctx);
                expect(logger.info).toHaveBeenCalledWith(
                    `Label ${ctx.payload.label.name} was added to the issue.`,
                );
                expect(logger.info).toHaveBeenCalledWith(
                    `Found matching label '${ctx.payload.label.name}' in required labels.`,
                );
            });

            test("should skip on labeling event when config labels do not match assigned label", async () => {
                ctx.payload.action = "labeled";
                ctx.payload.label = {name: "example3", id: 1};
                ctx.config = {labels: ["example1", "example2"]};
                await synchronizer.synchronizeIssue(ctx);
                expect(logger.info).toHaveBeenCalledWith(
                    `Label ${ctx.payload.label.name} was added to the issue.`,
                );
                expect(logger.notice).toHaveBeenCalledWith(
                    `Label '${ctx.payload.label.name}' does not match any of the labels '${JSON.stringify(
                        ctx.config.labels,
                    )}'. Skipping.`,
                );
                expect(logger.info).toHaveBeenCalledWith(
                    "Skipped assigment as it didn't fullfill requirements.",
                );
            });

            test("should skip on unlabeling event ", async () => {
                ctx.payload.action = "unlabeled";
                await synchronizer.synchronizeIssue(ctx);
                expect(logger.warning).toHaveBeenCalledWith(
                    "No support for 'unlabeled' event. Skipping",
                );
                expect(logger.info).toHaveBeenCalledWith(
                    "Skipped assigment as it didn't fullfill requirements.",
                );
            });

            test("should assign on non labeling event when no labels are in the config", async () => {
                await synchronizer.synchronizeIssue(ctx);
                expect(logger.info).toHaveBeenCalledWith(
                    "Matching requirements: not a labeling event and no labels found in the configuration.",
                );
            });

            test("should assign when config labels match labels in issue", async () => {
                ctx.payload.issue = {
                    node_id: "test_with_labels",
                    number: issueNumber,
                    labels: [{name: "example3"}],
                };
                ctx.config = {labels: ["example3", "example2"]};
                await synchronizer.synchronizeIssue(ctx);
                expect(logger.info).toHaveBeenCalledWith(
                    `Found matching element between ["example3"] and ${JSON.stringify(ctx.config.labels)}`,
                );
            });

            test("should skip assigment when config labels do not match labels in issue", async () => {
                ctx.payload.issue = {
                    node_id: "test_with_different_labels",
                    number: issueNumber,
                    labels: [{name: "example4"}, {name: "random label"}],
                };
                ctx.config = {labels: ["example3", "example2"]};
                await synchronizer.synchronizeIssue(ctx);
                expect(logger.info).toHaveBeenCalledWith(
                    "Skipped assigment as it didn't fullfill requirements.",
                );
            });
        });
    });

    describe("update all issues", () => {
        let nodeData: NodeData;
        let ctx: GitHubContext;
        beforeEach(() => {
            nodeData = {id: new Date().toDateString(), title: "Update all issues"};
            ctx = {eventName: "workflow_dispatch", payload: {}};
        });

        test("should report when no issues are available", async () => {
            sourceKit.getAllIssues.mockResolvedValue([]);
            expect(await synchronizer.synchronizeIssue(ctx)).toBeFalsy();
            expect(logger.notice).toBeCalledWith("No issues found");
        });


        test("convertLabelArray should parse string array", () => {
            const array = ["asd", "dsa", "rew"];
            expect(synchronizer.convertLabelArray(array)).toEqual(array);
        });

        test("convertLabelArray should parse object array", () => {
            const array = [{name: "rep"}, {name: "lol"}, {name: "asd"}];
            expect(synchronizer.convertLabelArray(array)).toEqual([
                "rep",
                "lol",
                "asd",
            ]);
        });

        test("convertLabelArray should parse mixed object & string array", () => {
            const array = [
                "hola",
                {name: "chau"},
                "buenos dias",
                {name: "buenas tardes"},
                {name: "buenas noches"},
                "arrivederchi",
            ];
            expect(synchronizer.convertLabelArray(array)).toEqual([
                "hola",
                "chau",
                "buenos dias",
                "buenas tardes",
                "buenas noches",
                "arrivederchi",
            ]);
        });
    })
})
