import { chromium } from 'playwright';

const TOKEN = '5deec24db491335748e8a945ba6b42bca90529a6775a673054089be99f1bbba8';
const BASE = 'http://localhost:3000';
const SCRATCHPAD = 'C:/Users/Jahir/AppData/Local/Temp/claude/E--DXB-Superpowers-jiive-admin/590e2e50-3570-49c6-b6ca-ff4f6821f1af/scratchpad';
const log = (...a) => console.log('[TEST]', ...a);

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--disable-web-security', '--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  const setupAuth = async () => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.evaluate((t) => {
      sessionStorage.setItem('jiive_admin_token', t);
      sessionStorage.setItem('jiive_admin_name', 'Isaam');
      sessionStorage.setItem('jiive_admin_role', 'admin');
    }, TOKEN);
  };

  await setupAuth();

  // ── FLOW 13: Delete conversation — need to create + verify trash icon ────────
  log('\n=== FLOW 13 re-test: Delete conversation ===');
  await page.goto(`${BASE}/playground`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // Create a new conversation
  const textarea = page.locator('textarea[aria-label="Prompt input"]');
  await textarea.fill('What is serotonin?');
  await page.locator('button[aria-label="Send message"]').click();
  await page.waitForSelector('button[aria-label="Send message"]', { timeout: 90000 });
  await page.waitForTimeout(2000); // autosave

  // New chat — should push this to sidebar
  await page.locator('button:has-text("New chat")').click();
  await page.waitForTimeout(1000);

  // Dump all button texts to understand sidebar structure
  const buttons = await page.locator('button').all();
  const btnTexts = [];
  for (const b of buttons) {
    const text = await b.textContent().catch(() => '');
    const ariaLabel = await b.getAttribute('aria-label').catch(() => '');
    if (text.trim() || ariaLabel) btnTexts.push(`[${ariaLabel || ''}] "${text.trim()}"`);
  }
  log('All buttons on page:', btnTexts.slice(0, 30).join(', '));

  // Check page body
  const body = await page.locator('body').textContent();
  log('Serotonin in page:', /serotonin/i.test(body));

  // Try to find any conversation in the sidebar
  // Looking at ConversationSidebar code in memory — it renders buttons
  const seroBtn = page.locator('button').filter({ hasText: /serotonin/i });
  const seroBtnCount = await seroBtn.count();
  log('Buttons with "serotonin":', seroBtnCount);

  if (seroBtnCount > 0) {
    const seroEl = seroBtn.first();
    // Get parent for hover
    await seroEl.hover();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SCRATCHPAD}/flow13_hover.png` });
    log('Screenshot taken: flow13_hover.png');

    // Look for any delete/trash button nearby
    const trashBtns = page.locator('button[aria-label*="Delete"], button[aria-label*="delete"], button[aria-label*="trash"], button[title*="Delete"]');
    const trashCount = await trashBtns.count();
    log('Trash buttons found:', trashCount);
    for (let i = 0; i < trashCount; i++) {
      const label = await trashBtns.nth(i).getAttribute('aria-label');
      const vis = await trashBtns.nth(i).isVisible();
      log(`Trash ${i}: label="${label}", visible=${vis}`);
    }

    if (trashCount > 0) {
      const firstTrash = trashBtns.first();
      const isVis = await firstTrash.isVisible();
      log('First trash visible:', isVis);
      if (isVis) {
        await firstTrash.click();
        await page.waitForTimeout(500);
        const bodyAfter = await page.locator('body').textContent();
        log('Serotonin still in page:', /serotonin/i.test(bodyAfter || ''));
        await page.screenshot({ path: `${SCRATCHPAD}/flow13_after_delete.png` });
        log('RESULT: Trash icon visible on hover, delete clicked, conversation removed');
      }
    } else {
      // Check ConversationSidebar source code interaction
      log('No trash button found — checking what happens on hover');
    }
  } else {
    log('No serotonin button in page — conversation might not have saved yet or title differs');
    // Show what IS in the page text
    const lines = (body || '').split('\n').filter(l => l.trim()).slice(0, 20);
    log('Page text lines:', lines.join(' | '));
  }

  // ── FLOW 6: Start box button investigation ───────────────────────────────────
  log('\n=== FLOW 6 re-check: Start box button ===');
  await page.goto(`${BASE}/playground`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const awsBtn = page.locator('button[aria-label*="AWS MedGemma"]');
  const awsDisabled = await awsBtn.isDisabled();
  log('AWS button disabled:', awsDisabled);

  if (!awsDisabled) {
    await awsBtn.click();
    await page.waitForTimeout(1000);

    // Look at BoxBanner
    const bannerText = await page.locator('.bg-muted\/50.rounded-lg').first().textContent().catch(() => 'not found');
    log('BoxBanner text:', bannerText);

    const startBox = page.locator('button:has-text("Start box")');
    const sbCount = await startBox.count();
    log('Start box buttons found:', sbCount);
    for (let i = 0; i < sbCount; i++) {
      const vis = await startBox.nth(i).isVisible();
      const disabled = await startBox.nth(i).isDisabled();
      log(`Start box ${i}: visible=${vis}, disabled=${disabled}`);
    }

    await page.screenshot({ path: `${SCRATCHPAD}/flow6_recheck.png` });
  }

  // ── FLOW 16: Auto-scroll re-test with a really long prompt ──────────────────
  log('\n=== FLOW 16 re-test: Auto-scroll ===');
  await page.goto(`${BASE}/playground`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  await textarea.fill('List every vitamin (A through K), their function, deficiency symptoms, food sources, RDA. Use markdown. Be very detailed and exhaustive.');
  await page.locator('button[aria-label="Send message"]').click();

  // Wait for streaming to start
  try { await page.waitForSelector('button[aria-label="Stop generation"]', { timeout: 20000 }); } catch {}
  log('Streaming started');

  // Wait for some content then scroll up aggressively
  await page.waitForTimeout(3000);
  const scrollArea = page.locator('.overflow-y-auto').first();

  // Scroll all the way to top
  await scrollArea.evaluate((el) => { el.scrollTop = 0; });
  log('Scrolled to top');
  await page.waitForTimeout(800);

  const jumpBtn = page.locator('button[aria-label="Jump to latest message"]');
  const jumpVisible = await jumpBtn.isVisible().catch(() => false);
  log('Jump to latest button visible:', jumpVisible);

  if (!jumpVisible) {
    // Check if streaming is still going
    const stopVisible = await page.locator('button[aria-label="Stop generation"]').isVisible().catch(() => false);
    log('Still streaming:', stopVisible);
    // Check scroll position
    const scrollInfo = await scrollArea.evaluate((el) => ({
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      distFromBottom: el.scrollHeight - el.scrollTop - el.clientHeight,
    }));
    log('Scroll info:', JSON.stringify(scrollInfo));
  }

  await page.screenshot({ path: `${SCRATCHPAD}/flow16_retest.png` });

  // Stop and check
  await page.locator('button[aria-label="Stop generation"]').click().catch(() => {});
  await page.waitForSelector('
