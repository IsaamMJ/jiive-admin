// Live test: multi-turn context retention + New chat.
const { chromium } = require("playwright");
const fs = require("fs");
const TOKEN = process.argv[2];
const OUT = "C:/Users/Jahir/AppData/Local/Temp/pw";
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log("[pw]", ...a);

async function send(page, text) {
  await page.getByLabel("Prompt input").fill(text);
  await page.getByLabel("Send message").click();
  await page.waitForFunction(() => {
    const t = document.body.innerText;
    return !document.querySelector('[aria-label="Stop generation"]') && (/\d+ms/.test(t) || /warming up/i.test(t));
  }, { timeout: 90000 }).catch(() => log("wait timeout"));
  await page.waitForTimeout(400);
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ["--disable-web-security"] });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 950 } })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

  await page.goto("http://localhost:3000/login", { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => { sessionStorage.setItem("jiive_admin_token", t); sessionStorage.setItem("jiive_admin_name", "Isaam"); sessionStorage.setItem("jiive_admin_role", "admin"); }, TOKEN);
  await page.goto("http://localhost:3000/playground", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  // Turn 1: establish a subject.
  await send(page, "What is HbA1c?");
  // Turn 2: a BARE follow-up that only makes sense WITH context.
  await send(page, "What is a good value for it?");
  await page.screenshot({ path: `${OUT}/mt-01-followup.png`, clip: { x: 240, y: 70, width: 1040, height: 600 } });

  const allText = await page.evaluate(() => document.body.innerText);
  // The 2nd answer should reference HbA1c / a percentage — proving context carried.
  const contextRetained = /hba1c|7\.?0?%|%/i.test(allText.split("What is a good value for it?")[1] || "");
  log("context retained on bare follow-up?", contextRetained);

  // New chat clears it.
  const newChat = page.getByRole("button", { name: /new chat/i });
  log("New chat button present?", await newChat.count() > 0);
  await newChat.first().click().catch((e) => log("newchat click err", e.message));
  await page.waitForTimeout(400);
  const cleared = await page.evaluate(() => /each message|follow-ups keep context|Ask a medical question/i.test(document.body.innerText) && !/HbA1c/i.test(document.querySelectorAll('.prose-sm').length ? document.body.innerText : ""));
  log("transcript cleared after New chat?", await page.evaluate(() => document.querySelectorAll('.prose-sm').length === 0));
  await page.screenshot({ path: `${OUT}/mt-02-newchat.png`, clip: { x: 240, y: 70, width: 1040, height: 400 } });

  log("ERRORS:", errors.length ? JSON.stringify(errors) : "none");
  await browser.close();
})();
