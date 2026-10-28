import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exportCampaign } from "./publication.js";

export async function exportFiles(source: string, id: string, destination: string) {
  const summary = JSON.parse(await fs.readFile(path.join(source, "summary.json"), "utf8"));
  let text: string;
  try { text = await fs.readFile(path.join(source, "attempts.jsonl"), "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    // Cancellation before the first attempt still has a summary and a plan.
    text = "";
  }
  const rows = text.split("\n").filter(line => line.trim()).map(line => JSON.parse(line));
  const campaign = exportCampaign(id, summary, rows);
  await fs.mkdir(destination, { recursive: true });
  const file = path.join(destination, `${campaign.id}.json`);
  await fs.writeFile(file, JSON.stringify(campaign, null, 2) + "\n", { flag: "wx" });
  return file;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [source, id, ...extra] = process.argv.slice(2);
  if (!source || !id || extra.length) {
    console.error("Usage: npm run captcha:export -- PRIVATE_CAMPAIGN_DIRECTORY CAMPAIGN_ID");
    process.exitCode = 1;
  } else {
    const repository = fileURLToPath(new URL("../../../", import.meta.url));
    exportFiles(source, id, path.join(repository, "results/captcha"))
      .then(file => console.log(`Exported ${file}. Review and commit this file in a PR; nothing was pushed.`))
      .catch(error => { console.error(error.message); process.exitCode = 1; });
  }
}
