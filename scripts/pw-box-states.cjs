// Verify the AWS box UI across states by MOCKING /status (no live auth needed).
const { chromium } = require("playwright");
const fs = require("fs");
const OUT = "C:/Users/Jahir/AppData/Local/Temp/pw";
fs.mkdirSync(OUT, { recursive: true });

const STATES = [
  { name: "stopped", aws: { running: false, state: "stopped", instanceId: "i-x" } },
  { name: "pending", aws: { running: false, state: "pending", instanceId: "i-x" } },
  { name: "running", aws: { running: true, state: "running", instanceId: "i-x" } },
  { name: "perm", aws: { running: false, state: "permission_denied", instanceId: "i-x" } },
];

(async () => {
  const browser = await chromium.launch({ headless: true, args: ["--disable-web-security"] });
  for (const s of STATES) {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    // Mock both status (chosen state) and the sidebar stuck-count (avoid noise).
    await page.route("**/llm-playground/status", (route) =>
      route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ aws: s.aws, hf: { configured: true, endpointUrl: "https://x" } }) }));
    await page.route("**/bookings/stuck", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ count: 0 }) }));

    await page.goto("http://localhost:3000/login", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => { sessionStorage.setItem("jiive_admin_token", "dummy"); sessionStorage.setItem("jiive_admin_name", "Isaam"); sessionStorage.setItem("jiive_admin_role", "admin"); });
    await page.goto("http://localhost:3000/playground", { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    // Select AWS model.
    await page.getByRole("radio", { name: /AWS MedGemma/ }).click().catch((e) => console.log("click err", e.message));
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/box-${s.name}.png`, clip: { x: 240, y: 70, width: 1040, height: 720 } });
    console.log(`[pw] box-${s.name} shot`);
    await page.close();
  }
  await browser.close();
})();
