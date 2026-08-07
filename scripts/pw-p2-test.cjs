// Live test P2: pick patient → loaded panel (no PII) → patientId sent in /chat request.
const { chromium } = require("playwright");
const fs = require("fs");
const TOKEN = process.argv[2];
const OUT = "C:/Users/Jahir/AppData/Local/Temp/pw";
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log("[pw]", ...a);

(async () => {
  const browser = await chromium.launch({ headless: true, args: ["--disable-web-security"] });
  const page = await (await browser.newContext({ viewport: { width: 1340, height: 950 } })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

  // Capture the outgoing /chat request body.
  let chatBody = null;
  page.on("request", (req) => {
    if (req.method() === "POST" && req.url().includes("/llm-playground/chat")) {
      try { chatBody = JSON.parse(req.postData() || "{}"); } catch {}
    }
  });

  await page.goto("http://localhost:3000/login", { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => { sessionStorage.setItem("jiive_admin_token", t); sessionStorage.setItem("jiive_admin_name", "Isaam"); sessionStorage.setItem("jiive_admin_role", "admin"); }, TOKEN);
  await page.goto("http://localhost:3000/playground", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  // Open picker + select first patient.
  await page.getByRole("button", { name: "Select patient" }).click();
  await page.getByRole("option").first().waitFor({ timeout: 15000 }).catch(() => log("no options appeared"));
  const list = page.getByRole("option");
  const n = await list.count();
  log("patients listed:", n);
  const firstLabel = await list.first().innerText().catch(() => "");
  await list.first().click();
  await page.waitForTimeout(800);

  // Loaded panel present? + de-identified (no PII patterns).
  const bodyText = await page.evaluate(() => document.body.innerText);
  const loadedShown = /Patient loaded/i.test(bodyText);
  const piiLeak = /@|\b\d{10}\b|\b[789]\d{9}\b/.test(bodyText.replace(/\d+%|\d+\.\d+/g, "")); // crude email/phone check
  log("Patient loaded panel shown?", loadedShown, "| selected:", firstLabel.replace(/\n/g, " ").slice(0, 50));
  log("possible PII leak in panel?", piiLeak);
  await page.screenshot({ path: `${OUT}/p2-01-loaded.png`, clip: { x: 240, y: 350, width: 1100, height: 560 } });

  // Send a question — capture the request body (don't care if model answers).
  await page.getByLabel("Prompt input").fill("Is this patient's biological age concerning?");
  await page.getByLabel("Send message").click();
  await page.waitForTimeout(2500); // let the request fire
  log("chat request body keys:", chatBody ? Object.keys(chatBody).join(",") : "(none captured)");
  log("patientId sent in /chat?", !!(chatBody && chatBody.patientId), chatBody ? `(= ${chatBody.patientId})` : "");
  log("messages sent?", !!(chatBody && Array.isArray(chatBody.messages) && chatBody.messages.length));

  log("ERRORS:", errors.length ? JSON.stringify(errors) : "none");
  await browser.close();
})();
