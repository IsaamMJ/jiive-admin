// Live re-test against dev after backend cleared blockers 1 & 2.
// Real auth. Does NOT start the EC2 box (cost). Tests HF chat (cold start ok).
const { chromium } = require("playwright");
const fs = require("fs");
const TOKEN = process.argv[2];
const OUT = "C:/Users/Jahir/AppData/Local/Temp/pw";
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log("[pw]", ...a);

(async () => {
  const browser = await chromium.launch({ headless: true, args: ["--disable-web-security"] });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

  await page.goto("http://localhost:3000/login", { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => { sessionStorage.setItem("jiive_admin_token", t); sessionStorage.setItem("jiive_admin_name", "Isaam"); sessionStorage.setItem("jiive_admin_role", "admin"); }, TOKEN);
  await page.goto("http://localhost:3000/playground", { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/live-01-initial.png`, clip: { x: 240, y: 70, width: 1040, height: 120 } });
  log("initial shot (expect: HF active, MedGemma box 'Offline' + enabled Start box)");

  // Are both model options enabled now?
  const hfDisabled = await page.getByRole("radio", { name: /HuggingFace/ }).isDisabled();
  const awsDisabled = await page.getByRole("radio", { name: /AWS MedGemma/ }).isDisabled();
  log("HF disabled?", hfDisabled, "| AWS disabled?", awsDisabled);

  // Send an HF chat (default model = hf). Cold start can take 30-60s.
  await page.getByLabel("Prompt input").fill("In one short sentence, what is CRP?");
  await page.getByLabel("Send message").click();
  log("sent HF prompt; waiting for cold start + stream...");
  const ok = await page.waitForFunction(
    () => {
      const t = document.body.innerText;
      const streaming = !!document.querySelector('[aria-label="Stop generation"]');
      return !streaming && (/\d+ms/.test(t) || /warming up/i.test(t));
    },
    { timeout: 90000 },
  ).then(() => true).catch(() => false);
  log("HF answer completed?", ok);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/live-02-hf-answer.png`, clip: { x: 240, y: 70, width: 1040, height: 500 } });

  const html = await page.evaluate(() => {
    const p = document.querySelectorAll(".prose-sm");
    return p.length ? p[p.length - 1].innerText.slice(0, 200) : "(none)";
  });
  log("HF answer text:", html.replace(/\n/g, " "));
  log("CONSOLE ERRORS:", errors.length ? JSON.stringify(errors) : "none");
  await browser.close();
})();
