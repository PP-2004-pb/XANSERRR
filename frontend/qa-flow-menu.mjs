export default async function run(page) {
  const result = [];
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.getByRole("button", { name: "Enter workspace" }).click();
  await page
    .getByRole("heading", { name: /Good morning/i })
    .waitFor({ timeout: 15000 });
  for (const name of [
    "Smart checkout",
    "Smart return",
    "Transactions",
    "Movement tracking",
  ]) {
    const button = page.getByRole("button", { name, exact: true });
    await button.click();
    await page.waitForTimeout(800);
    result.push({
      name,
      body: (await page.locator("main.content").innerText()).slice(0, 180),
    });
  }
  return { result, errors };
}
