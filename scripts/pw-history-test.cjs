// Live test: conversation auto-save → reopen → delete + default prompt display.
const { chromium } = require("playwright");
const fs = require("fs");
const TOKEN = process.argv[2];
const OUT = "C:/Users/Jahir/AppData/Local/Temp/pw";
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log("[pw]", ...a);

async function sendMsg(page, text) {
  await page.getByLabel("Prompt input").fill(text);
  await page.getByLabel("Send message").click();
  await page.waitForFunction(() => !document.querySelector('[aria-label="Stop generation"]') && /\d+ms/.test(document.body.innerText), { timeout: 90000 }).catch(() => log("turn wait timeout"));
  await page.waitForTimeout(800); // allow autosave POST/PATCH + list refresh
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ["--disable-web-security"] });
  const page = await (await browser.newContext({ viewport: { width: 1340, height: 950 } })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

  await page.goto("http://localhost:3000/login", { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => { sessionStorage.setItem("jiive_admin_token", t); sessionStorage.setItem("jiive_admin_name", "Isaam"); sessionStorage.setItem("jiive_admin_role", "admin"); }, TOKEN);
  await page.goto("http://localhost:3000/playground", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  const marker = "HISTTEST What is HbA1c?";
  await sendMsg(page, marker);
  const afterCreate = await page.getByRole("button", { name: new RegExp("Open conversation: HISTTEST") }).count();
  log("conversation created in sidebar after 1st turn?", afterCreate > 0);

  await sendMsg(page, "what is a good value for it?");
  // messageCount should now be 4 (2 user + 2 assistant); reopen will verify.

  // New chat
  await page.getByRole("button", { name: "New chat" }).click();
  await page.waitForTimeout(400);
  const clearedAfterNew = await page.evaluate(() => document.querySelectorAll('.prose-sm').length === 0);
  log("transcript cleared after New chat?", clearedAfterNew);

  // Reopen the conversation
  await page.getByRole("button", { name: new RegExp("Open conversation: HISTTEST") }).first().click();
  await page.waitForTimeout(800);
  const reopenedTurns = await page.evaluate(() => document.querySelectorAll('.prose-sm').length); // assistant bubbles
  const reopenedHasMarker = await page.evaluate((m) => document.body.innerText.includes(m), marker);
  log("reopened: assistant bubbles =", reopenedTurns, "| has original question =", reopenedHasMarker);
  await page.screenshot({ path: `${OUT}/hist-01-reopened.png`, clip: { x: 0, y: 70, width: 1340, height: 700 } });

  // Default prompt display: open system prompt (empty override) → should show default text.
  await page.getByRole("button", { name: /Toggle system prompt|System prompt/ }).first().click().catch(() => {});
  await page.waitForTimeout(400);
  const defaultShown = await page.evaluate(() => /You are MedGemma|default/i.test(document.body.innerText));
  log("default prompt shown when override empty?", defaultShown);
  await page.screenshot({ path: `${OUT}/hist-02-defaultprompt.png`, clip: { x: 240, y: 400, width: 1100, height: 500 } });

  // Cleanup: delete the test conversation.
  const delBtn = page.getByRole("button", { name: new RegExp("Delete conversation: HISTTEST") }).first();
  if (await delBtn.count() > 0) { await delBtn.click({ force: true }); await page.waitForTimeout(600); log("deleted test conversation"); }
  const goneAfterDelete = await page.getByRole("button", { name: new RegExp("Open conversation: HISTTEST") }).count();
  log("conversation removed after delete?", goneAfterDelete === 0);

  log("ERRORS:", errors.length ? JSON.stringify(errors) : "none");
  await browser.close();
})();
