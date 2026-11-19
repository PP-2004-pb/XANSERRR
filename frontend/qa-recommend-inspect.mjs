export default async function run(page, ui) {
  const before = await ui.snapshot(); const id = before.match(/@(e\d+) button "Enter workspace"/)?.[1]; await ui.click(id); await page.getByRole('heading', { name: /Good morning/i }).waitFor(); const s1 = await ui.snapshot({ full: true }); await page.getByRole('button', { name: 'Movement tracking' }).click(); await page.getByRole('heading', { name: /Where every asset/i }).waitFor(); const s2 = await ui.snapshot({ full: true }); return { s1, s2, nav: await page.locator('nav').innerText() };
}
