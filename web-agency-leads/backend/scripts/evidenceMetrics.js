import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { measureEvidenceAccuracy } from "../src/services/evidenceService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const labelledPath = path.resolve(__dirname, "../test-fixtures/evidence-labelled-set.json");
const predictionsPath = process.argv[2];

if (!predictionsPath) {
  console.error("Usage: node backend/scripts/evidenceMetrics.js <predictions.json>");
  console.error("Predictions shape: { \"https://example.com\": { \"phoneVisible\": { \"value\": \"present\" } } }");
  process.exit(1);
}

const labelledSet = JSON.parse(await fs.readFile(labelledPath, "utf8"));
const predictionsByUrl = JSON.parse(await fs.readFile(path.resolve(predictionsPath), "utf8"));
const metrics = measureEvidenceAccuracy(labelledSet, predictionsByUrl);

console.table(metrics);
