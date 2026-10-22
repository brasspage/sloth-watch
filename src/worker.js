// Runs the workflow and activities. Kill it any time; start it again and the
// sloth picks up where it stopped.
import { fileURLToPath } from "node:url";
import { NativeConnection, Worker } from "@temporalio/worker";
import { makeActivities } from "./activities.js";

const connection = await NativeConnection.connect({
  address: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
});
const worker = await Worker.create({
  connection,
  taskQueue: "sloth-watch",
  workflowsPath: fileURLToPath(new URL("./workflows.js", import.meta.url)),
  activities: makeActivities(),
});
await worker.run();
