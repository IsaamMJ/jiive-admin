// Verify info tooltips render on hover + context indicator appears after a turn.
const { chromium } = require("playwright");
const fs = require("fs");
const TOKEN = process.argv[2];
const OUT = "C:/Users/Jahir/AppData/Local/Temp/pw";
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log("[pw]", ...a);

(async () => {
  const browser = await chromium.launch({ headless: true, args: ["--disable-web-security"] });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 950 } })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

  await page.goto("http://localhost:3000/login", { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => { sessionStorage.setItem("jiive_admin_token", t); sessionStorage.setItem("jiive_admin_name", "Isaam"); sessionStorage.setItem("jiive_admin_role", "admin"); }, TOKEN);
  await page.goto("http://localhost:3000/playground", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  // Count info-tip triggers present.
  const tipCount = await page.locator('[aria-label="More info"], button:has(svg.lucide-info), [data-infotip]').count().catch(() => 0);
  log("info-tip triggers found (heuristic):", tipCount);

  // Hover the first info icon near the Model label and screenshot the tooltip.
  const firstTip = page.locator("button").filter({ has: page.locator("svg") }).first();
  // More robust: hover the Model-area info icon by position — hover all small info buttons; capture tooltip text.
  const infoButtons = page.getByRole("button").filter({ hasText: "" });
  // Hover the model info tip: it's right after the "Model" label.
  await page.getByText("Model", { exact: true }).hover();
  await page.waitForTimeout(300);
  // Try hovering the icon just after it
  const modelTip = page.locator('span:text("Model") + button, span:text("Model") ~ button').first();
  await modelTip.hover().catch(() => {});
  await page.waitForTimeout(700);
  const tipVisible = await page.evaluate(() => /same medical AI|MedGemma|hosted backup/i.test(document.body.innerText));
  log("model tooltip text visible on hover?", tipVisible);
  await page.screenshot({ path: `${OUT}/tip-01-model.png`, clip: { x: 240, y: 70, width: 1040, height: 220 } });

  // Do one turn so the context indicator can appear.
  await page.getByLabel("Prompt input").fill("What is HbA1c?");
  await page.getByLabel("Send message").click();
  await page.waitForFunction(() => !document.querySelector('[aria-label="Stop generation"]') && /\d+ms/.test(document.body.innerText), { timeout: 90000 }).catch(() => log("turn wait timeout"));
  await page.waitForTimeout(500);
  const ctxVisible = await page.evaluate(() => /context/i.test(document.body.innerText) && /tokens?|\d+k?\b/i.test(document.body.innerText));
  log("context indicator text present?", await page.evaluate(() => /context[^.]{0,40}token/i.test(document.body.innerText.replace(/\n/g, " "))));
  await page.screenshot({ path: `${OUT}/tip-02-context.png`, clip: { x: 240, y: 600, width: 1040, height: 300 } });

  log("ERRORS:", errors.length ? JSON.stringify(errors) : "none");
  await browser.close();
})();
