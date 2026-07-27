import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerLocalReview } from "./local.ts";
import { registerPullRequestReview } from "./pull-request.ts";
import { ReviewWorkflow } from "./workflow.ts";

export default function reviewExtension(pi: ExtensionAPI): void {
  const workflow = new ReviewWorkflow(pi);
  workflow.registerCommands();
  registerLocalReview(pi, workflow);
  registerPullRequestReview(pi, workflow);
}
