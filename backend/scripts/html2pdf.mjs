// Render 1 file HTML tu chua -> PDF (dung cho nut "convert PDF de share").
// Goi: node html2pdf.mjs <input.html> <output.pdf>
// Bao mat:
// - Import Playwright tu repo noi bo (frontend/node_modules hoac node resolution), KHONG import tu repo ngoai.
// - Tat JavaScript va offline mode, chan moi request http/https/loopback va moi file:// ngoai file input.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function loadPlaywright() {
  const localCandidate = path.resolve(__dirname, "../../frontend/node_modules/playwright");
  if (fs.existsSync(localCandidate)) {
    return require(localCandidate);
  }
  return require("playwright");
}

const inp = process.argv[2];
const out = process.argv[3];
if (!inp || !out) {
  console.error("usage: node html2pdf.mjs <in.html> <out.pdf>");
  process.exit(2);
}

const resolvedInput = path.resolve(inp);
if (!fs.existsSync(resolvedInput)) {
  console.error(`input file not found: ${resolvedInput}`);
  process.exit(2);
}
const allowedFileUrl = pathToFileURL(resolvedInput).href;

const { chromium } = loadPlaywright();
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    offline: true,
  });
  const page = await context.newPage();
  await page.route("**/*", (route) => {
    const reqUrl = route.request().url();
    if (reqUrl === allowedFileUrl || reqUrl.startsWith("data:")) {
      return route.continue();
    }
    return route.abort("blockedbyclient");
  });
  await page.goto(allowedFileUrl, { waitUntil: "load", timeout: 30000 });
  await page.pdf({
    path: path.resolve(out),
    format: "A4",
    printBackground: true,
    margin: { top: "8mm", bottom: "8mm", left: "6mm", right: "6mm" },
  });
  console.log("ok");
} finally {
  await browser.close();
}
