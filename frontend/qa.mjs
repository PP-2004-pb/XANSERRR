export default async function run(page, ui) {
  const results = [];
  const record = (name, passed, details = {}) => results.push({ name, passed, ...details });

  const before = await ui.snapshot();
  const login = before.match(/@(e\d+) button "Enter workspace"/)?.[1];
  if (!login) return { passed: false, error: 'login button missing', snapshot: before };

  await ui.click(login);
  await page.getByRole('heading', { name: /Good morning/i }).waitFor({ timeout: 5000 });
  let dashboard = await ui.snapshot({ full: true });
  const dashboardLabels = ['Overview', 'Asset inventory', 'Movement tracking', 'Maintenance', 'AI recommendations', 'Priority queue'];
  const missingDashboard = dashboardLabels.filter(label => !dashboard.includes(label));
  record('login and dashboard', missingDashboard.length === 0, { missing: missingDashboard });

  await page.getByRole('button', { name: 'Asset inventory' }).click();
  await page.getByRole('heading', { name: /Every device, accounted for/i }).waitFor({ timeout: 5000 });
  const inventory = await ui.snapshot({ full: true });
  const inventoryText = inventory.toLowerCase();
  record('asset inventory loads', inventoryText.includes('pc-001') && inventoryText.includes('asset register'));

  const search = page.getByPlaceholder('Search ID, serial, floor…');
  await search.fill('PC-001');
  await page.waitForFunction(() => document.body.innerText.includes('PC-001'));
  const filtered = await ui.snapshot({ full: true });
  record('asset search', filtered.includes('PC-001'));

  await page.getByText('PC-001', { exact: true }).first().click();
  await page.getByRole('heading', { name: 'PC-001' }).waitFor({ timeout: 3000 });
  const detail = await ui.snapshot({ full: true });
  record('asset detail and QR', detail.includes('HEALTH') && detail.includes('RISK') && detail.includes('Why this score?'));
  await page.getByRole('button', { name: '×' }).click();

  await page.getByRole('button', { name: 'Movement tracking' }).click();
  await page.getByRole('heading', { name: /Where every asset has been/i }).waitFor({ timeout: 10000 });
  const movements = await ui.snapshot({ full: true });
  record('movement timeline', movements.includes('CHAIN OF CUSTODY') && movements.includes('FROM') && movements.includes('TO') && movements.includes('Reason:'));

  const recommendationNav = page.getByRole('navigation').getByRole('button', { name: /AI recommendations/ });
  await recommendationNav.waitFor({ state: 'visible', timeout: 5000 });
  await recommendationNav.click();
  await page.getByRole('heading', { name: /Replacement radar/i }).waitFor({ timeout: 10000 });
  const recommendations = await ui.snapshot({ full: true });
  record('replacement recommendations', recommendations.includes('Budget') && recommendations.includes('Risk'));

  const question = page.locator('.question input');
  await question.fill('เครื่องไหนเสี่ยงเสียมากที่สุด?');
  await page.locator('.question button').click();
  await page.getByText(/MongoDB/).waitFor({ timeout: 5000 });
  const assistant = await ui.snapshot({ full: true });
  record('grounded assistant', assistant.includes('Rule-based') && assistant.includes('risk'));

  const passed = results.every(result => result.passed);
  return { passed, results, title: await page.title(), url: page.url(), finalSnapshot: await ui.snapshot({ full: true }) };
}
