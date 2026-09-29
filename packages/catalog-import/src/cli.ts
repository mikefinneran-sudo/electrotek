#!/usr/bin/env tsx
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { catalogStats, parseCatalog, toSql } from "./importer";
import { readSheet } from "./io";
import type { CatalogImportStats, CatalogImportTemplate } from "./types";

interface CliArgs {
  xlsxPath: string;
  templatePath: string;
  outPath?: string;
}

// Templates are client-owned (e.g. clients/<client>/catalog-template.ts) and
// loaded by path, so this package stays generic — no client-specific data lives
// in it. The template module must default-export a CatalogImportTemplate.
async function loadTemplate(templatePath: string): Promise<CatalogImportTemplate> {
  const absolute = resolve(process.cwd(), templatePath);
  let mod: { default?: unknown };
  try {
    mod = await import(pathToFileURL(absolute).href);
  } catch (cause) {
    throw new Error(`Could not load template at ${templatePath}: ${cause instanceof Error ? cause.message : cause}`);
  }

  const template = mod.default;
  if (
    !template ||
    typeof template !== "object" ||
    typeof (template as CatalogImportTemplate).name !== "string" ||
    typeof (template as CatalogImportTemplate).columns !== "object" ||
    typeof (template as CatalogImportTemplate).isCategoryRow !== "function"
  ) {
    throw new Error(`Template at ${templatePath} must default-export a CatalogImportTemplate`);
  }

  return template as CatalogImportTemplate;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const template = await loadTemplate(args.templatePath);
  const rows = await readSheet(args.xlsxPath, template.sheetName);
  const parsed = parseCatalog(rows, template);
  const sql = toSql(parsed);
  const stats = catalogStats(parsed);

  if (args.outPath) {
    await writeFile(args.outPath, sql, "utf8");
    console.log(`Wrote ${args.outPath}`);
    printStats(stats, console.log);
    return;
  }

  process.stdout.write(sql);
  printStats(stats, console.error);
}

function parseArgs(argv: string[]): CliArgs {
  let xlsxPath: string | undefined;
  let templatePath: string | undefined;
  let outPath: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      printUsage(console.log);
      process.exit(0);
    }

    if (arg === "--template") {
      templatePath = nextValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--out") {
      outPath = nextValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (!xlsxPath) {
      xlsxPath = arg;
      continue;
    }

    throw new Error(`Unexpected argument: ${arg}`);
  }

  if (!xlsxPath || !templatePath) {
    printUsage(console.error);
    throw new Error("Missing required arguments");
  }

  return {
    xlsxPath,
    templatePath,
    outPath,
  };
}

function nextValue(argv: string[], index: number, option: string) {
  const value = argv[index + 1];

  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${option}`);
  }

  return value;
}

function printUsage(write: (message: string) => void) {
  write("Usage: bananaforce-catalog-import <xlsx> --template <client-template.ts> [--out file.sql]");
}

function printStats(stats: CatalogImportStats, write: (message: string) => void) {
  write(`  locations:  ${stats.locations}`);
  write(`  categories: ${stats.categories}`);
  write(`  vendors:    ${stats.vendors}`);
  write(`  products:   ${stats.products}`);
  write(`  with shot_count: ${stats.productsWithShotCount}`);
  write(`  with gram_weight: ${stats.productsWithGramWeight}`);
  write(`  wholesale_excluded (NO flag): ${stats.wholesaleExcluded}`);
  write(`  duplicate products skipped: ${stats.duplicateProducts}`);
  write(`  skipped rows: ${stats.skippedRows}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
