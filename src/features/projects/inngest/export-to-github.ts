import ky from "ky";
import { Octokit } from "octokit";
import { NonRetriableError } from "inngest";

import { convex } from "@/lib/convex-client";
import { inngest } from "@/inngest/client";

import { api } from "../../../../convex/_generated/api";
import { Doc, Id } from "../../../../convex/_generated/dataModel";
import { mapWithConcurrency, withExponentialBackoff } from "./utils";

interface ExportToGithubEvent {
  projectId: Id<"projects">;
  repoName: string;
  visibility: "public" | "private";
  description?: string;
  githubToken: string;
}

type FileWithUrl = Doc<"files"> & {
  storageUrl: string | null;
};

// Configurable constants for chunking and concurrency
export const EXPORT_BATCH_SIZE = 50;
export const EXPORT_CONCURRENCY_LIMIT = 5;

/**
 * Resolves the repository default branch name with a safe fallback to "main".
 */
export const resolveDefaultBranch = (defaultBranch?: string | null): string => {
  if (!defaultBranch || typeof defaultBranch !== "string") {
    return "main";
  }
  const trimmed = defaultBranch.trim();
  return trimmed.length > 0 ? trimmed : "main";
};

/**
 * Formats branch name into Git ref path (e.g. heads/main).
 */
export const getBranchRef = (branch: string): string => {
  const cleanBranch = branch.replace(/^refs\/heads\//, "").replace(/^heads\//, "");
  return `heads/${cleanBranch}`;
};

export const exportToGithub = inngest.createFunction(
  {
    id: "export-to-github",
    cancelOn: [
      {
        event: "github/export.cancel",
        if: "event.data.projectId == async.data.projectId",
      },
    ],
    onFailure: async ({ event, step }) => {
      const internalKey = process.env.NEXUS_CONVEX_INTERNAL_KEY;
      if (!internalKey) return;

      const { projectId } = event.data.event.data as ExportToGithubEvent;
      const errorMsg = event.data.error?.message || "Export failed";

      await step.run("set-failed-status", async () => {
        await convex.mutation(api.system.updateExportStatus, {
          internalKey,
          projectId,
          status: "failed",
        });

        await convex.mutation(api.system.updateExportProgress, {
          internalKey,
          projectId,
          progress: {
            status: "failed",
            totalFiles: 0,
            processedFiles: 0,
            successfulFiles: 0,
            failedFiles: 1,
            skippedFiles: 0,
            currentBatch: 0,
            totalBatches: 0,
            errorMessage: errorMsg,
          },
        });
      });
    },
  },
  {
    event: "github/export.repo",
  },
  async ({ event, step }) => {
    const { projectId, repoName, visibility, description, githubToken } =
      event.data as ExportToGithubEvent;

    const internalKey = process.env.NEXUS_CONVEX_INTERNAL_KEY;
    if (!internalKey) {
      throw new NonRetriableError(
        "NEXUS_CONVEX_INTERNAL_KEY is not configured",
      );
    }

    // Set status to exporting
    await step.run("set-exporting-status", async () => {
      await convex.mutation(api.system.updateExportStatus, {
        internalKey,
        projectId,
        status: "exporting",
      });
    });

    const octokit = new Octokit({ auth: githubToken });

    // Get authenticated user
    const { data: user } = await step.run("get-github-user", async () => {
      return await withExponentialBackoff(async () => {
        return await octokit.rest.users.getAuthenticated();
      });
    });

    // Create the new repository with auto_init to have an initial commit
    const { data: repo } = await step.run("create-repo", async () => {
      return await withExponentialBackoff(async () => {
        return await octokit.rest.repos.createForAuthenticatedUser({
          name: repoName,
          description: description || `Exported from Nexus`,
          private: visibility === "private",
          auto_init: true,
        });
      });
    });

    // Wait for GitHub to initialize the repo (auto_init is async on GitHub's side)
    await step.sleep("wait-for-repo-init", "3s");

    const defaultBranch = resolveDefaultBranch(repo.default_branch);
    const branchRef = getBranchRef(defaultBranch);

    // Get the initial commit SHA (we need this as parent for our commit)
    const initialCommitSha = await step.run("get-initial-commit", async () => {
      return await withExponentialBackoff(async () => {
        try {
          const { data: ref } = await octokit.rest.git.getRef({
            owner: user.login,
            repo: repoName,
            ref: branchRef,
          });
          return ref.object.sha;
        } catch (error) {
          // If default branch ref lookup fails, fallback to main then master
          if (defaultBranch !== "main") {
            try {
              const { data: mainRef } = await octokit.rest.git.getRef({
                owner: user.login,
                repo: repoName,
                ref: "heads/main",
              });
              return mainRef.object.sha;
            } catch {
              // Ignore fallback failure
            }
          }
          if (defaultBranch !== "master") {
            try {
              const { data: masterRef } = await octokit.rest.git.getRef({
                owner: user.login,
                repo: repoName,
                ref: "heads/master",
              });
              return masterRef.object.sha;
            } catch {
              // Ignore fallback failure
            }
          }
          throw error;
        }
      });
    });

    // Fetch all project files with storage URLs
    const files = await step.run("fetch-project-files", async () => {
      return (await convex.query(api.system.getProjectFilesWithUrls, {
        internalKey,
        projectId,
      })) as FileWithUrl[];
    });

    // Build a map of file IDs to their full paths
    const buildFilePaths = (allFiles: FileWithUrl[]) => {
      const fileMap = new Map<Id<"files">, FileWithUrl>();
      allFiles.forEach((f) => fileMap.set(f._id, f));

      const getFullPath = (file: FileWithUrl): string => {
        if (!file.parentId) {
          return file.name;
        }

        const parent = fileMap.get(file.parentId);
        if (!parent) return file.name;

        return `${getFullPath(parent)}/${file.name}`;
      };

      const paths: Record<string, FileWithUrl> = {};
      allFiles.forEach((file) => {
        paths[getFullPath(file)] = file;
      });

      return paths;
    };

    const filePaths = buildFilePaths(files);

    // Filter to only actual files (not folders)
    const fileEntries = Object.entries(filePaths).filter(
      ([, file]) => file.type === "file",
    );

    if (fileEntries.length === 0) {
      throw new NonRetriableError("No files to export");
    }

    const totalFiles = fileEntries.length;
    const totalBatches = Math.max(1, Math.ceil(totalFiles / EXPORT_BATCH_SIZE));

    // Initialize progress record in Convex
    await step.run("init-progress", async () => {
      await convex.mutation(api.system.updateExportProgress, {
        internalKey,
        projectId,
        progress: {
          status: "running",
          totalFiles,
          processedFiles: 0,
          successfulFiles: 0,
          failedFiles: 0,
          skippedFiles: 0,
          currentBatch: 0,
          totalBatches,
        },
      });
    });

    const allTreeItems: {
      path: string;
      mode: "100644";
      type: "blob";
      sha: string;
    }[] = [];

    let overallProcessed = 0;
    let overallSuccessful = 0;
    let overallFailed = 0;
    let overallSkipped = 0;

    // Process files in chunked batches across Inngest steps
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const start = batchIndex * EXPORT_BATCH_SIZE;
      const end = Math.min(start + EXPORT_BATCH_SIZE, totalFiles);
      const batchEntries = fileEntries.slice(start, end);

      if (batchEntries.length === 0) continue;

      const batchResult = await step.run(
        `create-blobs-batch-${batchIndex + 1}-of-${totalBatches}`,
        async () => {
          const items: {
            path: string;
            mode: "100644";
            type: "blob";
            sha: string;
          }[] = [];
          let batchFailed = 0;
          let batchSkipped = 0;

          await mapWithConcurrency(
            batchEntries,
            EXPORT_CONCURRENCY_LIMIT,
            async ([path, file]) => {
              let content: string;
              let encoding: "utf-8" | "base64" = "utf-8";

              if (file.content !== undefined) {
                // Text file
                content = file.content;
              } else if (file.storageUrl) {
                // Binary file - fetch and base64 encode
                try {
                  const response = await withExponentialBackoff(async () => {
                    return await ky.get(file.storageUrl!);
                  });
                  const buffer = Buffer.from(await response.arrayBuffer());
                  content = buffer.toString("base64");
                  encoding = "base64";
                } catch (err) {
                  console.error(
                    `Failed to fetch storage file for ${path}:`,
                    err,
                  );
                  batchFailed++;
                  return;
                }
              } else {
                // Skip empty files
                batchSkipped++;
                return;
              }

              try {
                const { data: blob } = await withExponentialBackoff(
                  async () => {
                    return await octokit.rest.git.createBlob({
                      owner: user.login,
                      repo: repoName,
                      content,
                      encoding,
                    });
                  },
                );

                items.push({
                  path,
                  mode: "100644",
                  type: "blob",
                  sha: blob.sha,
                });
              } catch (err) {
                console.error(`Failed to create blob for ${path}:`, err);
                batchFailed++;
              }
            },
          );

          return {
            items,
            processed: batchEntries.length,
            failed: batchFailed,
            skipped: batchSkipped,
          };
        },
      );

      allTreeItems.push(...batchResult.items);
      overallProcessed += batchResult.processed;
      overallSuccessful += batchResult.items.length;
      overallFailed += batchResult.failed;
      overallSkipped += batchResult.skipped;

      // Update progress in Convex after each batch
      await step.run(
        `update-export-progress-batch-${batchIndex + 1}-of-${totalBatches}`,
        async () => {
          await convex.mutation(api.system.updateExportProgress, {
            internalKey,
            projectId,
            progress: {
              status: "running",
              totalFiles,
              processedFiles: overallProcessed,
              successfulFiles: overallSuccessful,
              failedFiles: overallFailed,
              skippedFiles: overallSkipped,
              currentBatch: batchIndex + 1,
              totalBatches,
            },
          });
        },
      );
    }

    // Guard: Never create an incomplete commit if blob creation encountered failures
    if (overallFailed > 0 || allTreeItems.length === 0) {
      const errorMsg = `Export aborted: ${overallFailed} of ${totalFiles} file blobs failed to create.`;
      await step.run("set-partial-failure-status", async () => {
        await convex.mutation(api.system.updateExportStatus, {
          internalKey,
          projectId,
          status: "failed",
        });

        await convex.mutation(api.system.updateExportProgress, {
          internalKey,
          projectId,
          progress: {
            status: "failed",
            totalFiles,
            processedFiles: overallProcessed,
            successfulFiles: overallSuccessful,
            failedFiles: overallFailed,
            skippedFiles: overallSkipped,
            currentBatch: totalBatches,
            totalBatches,
            errorMessage: errorMsg,
          },
        });
      });

      throw new NonRetriableError(errorMsg);
    }

    // Create the git tree
    const { data: tree } = await step.run("create-tree", async () => {
      return await withExponentialBackoff(async () => {
        return await octokit.rest.git.createTree({
          owner: user.login,
          repo: repoName,
          tree: allTreeItems,
        });
      });
    });

    // Create the commit with the initial commit as parent
    const { data: commit } = await step.run("create-commit", async () => {
      return await withExponentialBackoff(async () => {
        return await octokit.rest.git.createCommit({
          owner: user.login,
          repo: repoName,
          message: "Initial commit from Nexus",
          tree: tree.sha,
          parents: [initialCommitSha],
        });
      });
    });

    // Update the default branch reference to point to our new commit
    await step.run("update-branch-ref", async () => {
      return await withExponentialBackoff(async () => {
        return await octokit.rest.git.updateRef({
          owner: user.login,
          repo: repoName,
          ref: branchRef,
          sha: commit.sha,
          force: true,
        });
      });
    });

    // Set status to completed with repo URL
    await step.run("set-completed-status", async () => {
      await convex.mutation(api.system.updateExportStatus, {
        internalKey,
        projectId,
        status: "completed",
        repoUrl: repo.html_url,
      });

      await convex.mutation(api.system.updateExportProgress, {
        internalKey,
        projectId,
        progress: {
          status: "completed",
          totalFiles,
          processedFiles: overallProcessed,
          successfulFiles: overallSuccessful,
          failedFiles: overallFailed,
          skippedFiles: overallSkipped,
          currentBatch: totalBatches,
          totalBatches,
        },
      });
    });

    return {
      success: true,
      repoUrl: repo.html_url,
      filesExported: allTreeItems.length,
    };
  },
);
