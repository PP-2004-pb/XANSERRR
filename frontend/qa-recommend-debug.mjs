export default async function run(page, ui) {
  const before = await ui.snapshot()
  const login = before.match(/@(e\d+) button "Enter workspace"/)?.[1]
  if (!login) return { error: 'login button not found', before }
  await ui.click(login)
  await page.getByRole('heading', { name: /Good morning/i }).waitFor({ state: 'visible' })
  const buttons = page.getByRole('navigation').getByRole('button')
  const count = await buttons.count()
  const labels = await buttons.allTextContents()
  await buttons.filter({ hasText: 'Movement tracking' }).click()
  await page.getByRole('heading', { name: /Where every asset/i }).waitFor({ state: 'visible' })
  await buttons.filter({ hasText: 'AI recommendations' }).click()
  await page.getByRole('heading', { name: /Replacement radar/i }).waitFor({ state: 'visible' })
  return { count, labels, pageHeading: await page.getByRole('heading', { name: /Replacement radar/i }).innerText() }
}
