import fs from "node:fs/promises";
import ExcelJS from "exceljs";
import { prisma } from "../repositories/prisma.js";
import { normalizeWebsite, priorityFromScore } from "../utils/priority.js";

const columnAliases = {
  company: ["company", "business", "name", "company name"],
  website: ["website", "url", "site", "domain"],
  phone: ["phone", "telephone", "contact number"],
  address: ["address", "location"],
  industry: ["industry", "industry query", "category", "niche"],
  score: ["score", "audit score", "ai score"],
  screenshotPath: ["screenshot", "screenshot path", "image"],
  outreachEmail: ["outreach", "outreach email", "email copy"],
  issues: ["issues", "issue", "problems", "findings"]
};

function normalizeHeader(header) {
  return String(header || "").trim().toLowerCase();
}

function getValue(row, key) {
  const aliases = columnAliases[key];
  const found = Object.keys(row).find((column) => aliases.includes(normalizeHeader(column)));
  return found ? row[found] : undefined;
}

async function rowsFromFile(file) {
  const workbook = new ExcelJS.Workbook();
  if (/\.csv$/i.test(file.originalname)) {
    await workbook.csv.readFile(file.path);
  } else {
    await workbook.xlsx.readFile(file.path);
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];

  const headers = [];
  worksheet.getRow(1).eachCell({ includeEmpty: true }, (cell, columnNumber) => {
    headers[columnNumber] = String(cell.value || "").trim();
  });

  const rows = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const item = {};
    headers.forEach((header, columnNumber) => {
      if (header) item[header] = row.getCell(columnNumber).text || row.getCell(columnNumber).value || "";
    });
    rows.push(item);
  });
  return rows;
}

function parseIssues(value) {
  if (!value) return [];
  return String(value)
    .split(/\n|;|\|/g)
    .map((issue) => issue.trim())
    .filter(Boolean);
}

export async function importLeads(file, userId) {
  const rows = await rowsFromFile(file);
  const existing = await prisma.lead.findMany({ select: { website: true } });
  const existingSites = new Set(existing.map((lead) => normalizeWebsite(lead.website)));
  let created = 0;
  let skipped = 0;

  for (const row of rows) {
    const website = normalizeWebsite(getValue(row, "website"));
    const company = String(getValue(row, "company") || "").trim();
    if (!website || !company || existingSites.has(website)) {
      skipped += 1;
      continue;
    }

    const score = Number(getValue(row, "score") || 7);
    await prisma.lead.create({
      data: {
        company,
        website,
        phone: String(getValue(row, "phone") || "").trim() || null,
        address: String(getValue(row, "address") || "").trim() || null,
        industry: String(getValue(row, "industry") || "").trim() || null,
        score,
        priority: priorityFromScore(score),
        screenshotPath: String(getValue(row, "screenshotPath") || "").trim() || null,
        outreachEmail: String(getValue(row, "outreachEmail") || "").trim() || null,
        issues: { create: parseIssues(getValue(row, "issues")).map((issueText) => ({ issueText })) }
      }
    });
    existingSites.add(website);
    created += 1;
  }

  const importRecord = await prisma.import.create({
    data: {
      fileName: file.originalname,
      importedBy: userId,
      totalRows: rows.length
    }
  });

  await fs.unlink(file.path).catch(() => {});
  return { import: importRecord, created, skipped, totalRows: rows.length };
}
