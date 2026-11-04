import { loadStealthRuns } from "../lib/stealth";

try {
  loadStealthRuns();
  console.log("Weekly score files validated.");
} catch {
  console.error("Invalid weekly score files. Deployment refused.");
  process.exitCode = 1;
}
