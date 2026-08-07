// Headless browser smoke + UX test for the LLM Playground page.
// Drives a real Chromium against the local dev server (which proxies to the dev backend).
// Usage: node scripts/pw-playground-test.cjs <token>
const { chromium } = require("playwright");
const fs = require("fs");

const TOKEN = process.argv[2];
const OUT = "C:/Users/Jahir/AppData/Local/Temp/pw";
const BASE = "http://localhost:3000";

if (!TOKEN) { console.error("no token"); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

const log = (...a) => console.log("[pw]", ...a);
const shot = async (page, name) => { await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false }); log("shot", name); };

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-web-security", "--disable-features=IsolateOrigins,site-per-process"],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

  try {
    // Establish a session: load origin, inject sessionStorage token, then go to /playground.
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.evaluate((t) => {
      sessionStorage.setItem("jiive_admin_token", t);
      sessionStorage.setItem("jiive_admin_name", "Isaam");
      sessionStorage.setItem("jiive_admin_role", "admin");
    }, TOKEN);

    await page.goto(`${BASE}/playground`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500); // let /status settle
    await shot(page, "01-initial");

    // Select AWS MedGemma (it streams on dev).
    const awsBtn = page.getByRole("button", { name: "AWS MedGemma" }).first();
    if (await awsBtn.isVisible()) { await awsBtn.click().catch(() => {}); }
    await page.waitForTimeout(300);
    await shot(page, "02-aws-selected");

    // Send a markdown-eliciting prompt.
    const ta = page.getByLabel("Prompt input");
    await ta.click();
    await ta.fill("Reply in markdown: a bold heading '**CRP**' then 3 bullet points of causes of high CRP, and one `inline code` token.");
    await shot(page, "03-typed");
    await page.getByLabel("Send message").click();

    // Catch it mid-stream.
    await page.waitForTimeout(250);
    await shot(page, "04-streaming");

    // Wait for completion (latency footnote text "ms" appears in an assistant block).
    await page.waitForFunction(() => {
      return /\d+ms/.test(document.body.innerText) && !document.querySelector('[aria-label="Stop generation"]');
    }, { timeout: 30000 }).catch(() => log("done-wait timed out"));
    await page.waitForTimeout(500);
    await shot(page, "05-answer-rendered");

    // Dump the rendered HTML of the last assistant bubble to verify markdown became real elements.
    const mdHtml = await page.evaluate(() => {
      const proses = document.querySelectorAll(".prose-sm");
      const last = proses[proses.length - 1];
      return last ? last.innerHTML.slice(0, 800) : "(no .prose-sm found)";
    });
    fs.writeFileSync(`${OUT}/answer-html.txt`, mdHtml);
    log("answer markdown HTML:", mdHtml.replace(/\n/g, " ").slice(0, 300));

    // Copy button.
    const copyBtn = page.getByLabel("Copy answer").first();
    if (await copyBtn.isVisible().catch(() => false)) { await copyBtn.click().catch(() => {}); await page.waitForTimeout(300); await shot(page, "06-after-copy"); log("clicked Copy"); }
    else log("Copy button not visible");

    // Stop mid-stream: regenerate a longer answer then hit Stop.
    await ta.click();
    await ta.fill("Write a long 200-word explanation of inflammation markers in detail.");
    await page.getByLabel("Send message").click();
    await page.waitForTimeout(350); // let some tokens arrive
    const stopBtn = page.getByLabel("Stop generation");
    if (await stopBtn.isVisible().catch(() => false)) { await stopBtn.click(); log("clicked Stop"); }
    await page.waitForTimeout(600);
    await shot(page, "07-after-stop");
    const stoppedSeen = await page.evaluate(() => document.body.innerText.includes("stopped"));
    log("stopped marker present:", stoppedSeen);

    // RAG toggle visual.
    const ragBtn = page.getByRole("button", { name: /RAG grounding/ });
    if (await ragBtn.isVisible().catch(() => false)) { await ragBtn.click().catch(() => {}); await page.waitForTimeout(200); await shot(page, "08-rag-on"); }

    // AWS box control area (top right).
    await shot(page, "09-final-state");

    log("CONSOLE ERRORS:", errors.length ? JSON.stringify(errors, null, 2) : "none");
  } catch (e) {
    log("SCRIPT ERROR:", e.message);
    await shot(page, "99-error").catch(() => {});
  } finally {
    await browser.close();
  }
})();
