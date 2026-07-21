// Render 1 file HTML tu chua -> PDF (dung cho nut "convert PDF de share").
// Goi: node html2pdf.mjs <input.html> <output.pdf>
// Playwright chromium lay tu project khac (khong cai rieng trong repo nay).
import pkg from "/home/ksp/inut-ffmpeg-service/node_modules/playwright/index.js";
const { chromium } = pkg;

const inp = process.argv[2];
const out = process.argv[3];
if (!inp || !out) {
  console.error("usage: node html2pdf.mjs <in.html> <out.pdf>");
  process.exit(2);
}
const b = await chromium.launch({ headless: true });
const p = await (await b.newContext()).newPage();
await p.goto("file://" + inp, { waitUntil: "networkidle" });
await p.waitForTimeout(600);
await p.pdf({
  path: out,
  format: "A4",
  printBackground: true,
  margin: { top: "8mm", bottom: "8mm", left: "6mm", right: "6mm" },
});
await b.close();
console.log("ok");
