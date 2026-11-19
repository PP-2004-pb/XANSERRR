export default async function run(page, ui) {
  const before = await ui.snapshot();
  const login = before.match(/@(e\d+) button "Enter workspace"/)?.[1];
  await ui.click(login);
  await page.getByRole('heading', { name: /Good morning/i }).waitFor({ timeout: 10000 });
  const buttons = page.getByRole('navigation').getByRole('button');
  await buttons.filter({ hasText: 'AI recommendations' }).click();
  await page.waitForTimeout(1500);
  return { text: (await page.locator('body').innerText()).slice(0, 2000), snapshot: await ui.snapshot({ full: true }) };
}
