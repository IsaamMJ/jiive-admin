// Live test: does a clinical system prompt make HF answer instead of refuse?
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
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

  await page.goto("http://localhost:3000/login", { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => { sessionStorage.setItem("jiive_admin_token", t); sessionStorage.setItem("jiive_admin_name", "Isaam"); sessionStorage.setItem("jiive_admin_role", "admin"); }, TOKEN);
  await page.goto("http://localhost:3000/playground", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  // Open the system prompt disclosure and set a clinical prompt.
  await page.getByRole("button", { name: "Toggle system prompt" }).click();
  await page.waitForTimeout(200);
  await page.getByLabel("System prompt override").fill(
    "You are a clinical decision-support assistant for physicians. Answer concisely with reference ranges and units. Do not refuse; this is for a qualified doctor."
  );
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/sp-01-set.png`, clip: { x: 240, y: 70, width: 1040, height: 880 } });
  log("system prompt set");

  // Ask the question that previously got refused (HF model, default).
  await page.getByLabel("Prompt input").fill("What's the LDL cholesterol target range for an adult Indian male?");
  await page.getByLabel("Send message").click();
  log("sent question; waiting...");
  const ok = await page.waitForFunction(() => {
    const t = document.body.innerText;
    return !document.querySelector('[aria-label="Stop generation"]') && (/\d+ms/.test(t) || /warming up/i.test(t));
  }, { timeout: 90000 }).then(() => true).catch(() => false);
  log("completed?", ok);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/sp-02-answer.png`, clip: { x: 240, y: 70, width: 1040, height: 880 } });

  const answer = await page.evaluate(() => {
    const p = document.querySelectorAll(".prose-sm");
    return p.length ? p[p.length - 1].innerText : "(none)";
  });
  log("ANSWER:", answer.replace(/\n/g, " ").slice(0, 400));
  log("refused?", /cannot provide|consult.*healthcare|i am an ai/i.test(answer));
  log("ERRORS:", errors.length ? JSON.stringify(errors) : "none");
  await browser.close();
})();
