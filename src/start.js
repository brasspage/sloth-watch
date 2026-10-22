// Starts one watch: node src/start.js businesses/little-kettle-cafe.json [--nights 1] [--gap "24 hours"]
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { Client, Connection } from "@temporalio/client";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    nights: { type: "string", default: "0" },
    gap: { type: "string", default: "24 hours" },
  },
});
const business = JSON.parse(
  await readFile(
    positionals[0] ?? "businesses/little-kettle-cafe.json",
    "utf8",
  ),
);
const connection = await Connection.connect({
  address: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
});
const client = new Client({ connection });
const id = `sloth-watch-${business.slug}`;
await client.workflow.start("slothWatch", {
  taskQueue: "sloth-watch",
  workflowId: id,
  args: [{ business, maxNights: Number(values.nights), gap: values.gap }],
});
console.log(
  `Started ${id}. Watch it: http://localhost:8233/namespaces/default/workflows/${id}`,
);
await connection.close();
