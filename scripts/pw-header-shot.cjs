const { chromium } = require("playwright");
const fs = require("fs");
const TOKEN = process.argv[2];
const OUT = "C:/Users/Jahir/AppData/Local/Temp/pw";
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true, args: ["--disable-web-security", "--disable-features=IsolateOrigins,site-per-process"] });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await page.goto("http://localhost:3000/login", { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => { sessionStorage.setItem("jiive_admin_token", t); sessionStorage.setItem("jiive_admin_name", "Isaam"); sessionStorage.setItem("jiive_admin_role", "admin"); }, TOKEN);
  await page.goto("http://localhost:3000/playground", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const clip = { x: 240, y: 70, width: 1040, height: 70 };
  await page.screenshot({ path: `${OUT}/h1-hf-active.png`, clip });
  console.log("[pw] hf-active shot");
  // switch to AWS
  await page.getByRole("radio", { name: /AWS MedGemma/ }).click().catch((e) => console.log("click err", e.message));
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/h2-aws-active.png`, clip });
  console.log("[pw] aws-active shot");
  await browser.close();
})();
