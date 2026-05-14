import { test, expect } from '@playwright/test'

// These tests require the dev server running (npm run dev) and
// a seeded Supabase database with at least one active contract.
// Run with: npx playwright test tests/e2e/markets.spec.ts

test('contract detail page renders key elements', async ({ page }) => {
  await page.goto('/')
  const firstCard = page.locator('article').first()
  await firstCard.click()

  await expect(page).toHaveURL(/\/markets\//)

  await expect(page.locator('main span').first()).toBeVisible()
  await expect(page.locator('h1')).toBeVisible()
  await expect(page.getByRole('button', { name: /buy protection/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /provide capital/i })).toBeVisible()
})

test('purchase panel opens on Buy Protection click', async ({ page }) => {
  await page.goto('/')
  await page.locator('article').first().click()
  await page.waitForURL(/\/markets\//)

  await page.getByRole('button', { name: /buy protection/i }).click()

  await expect(page.getByRole('dialog')).toBeVisible()
})

test('purchase panel shows auth gate when not logged in', async ({ page }) => {
  await page.goto('/')
  await page.locator('article').first().click()
  await page.waitForURL(/\/markets\//)

  await page.getByRole('button', { name: /buy protection/i }).click()

  await expect(page.getByRole('link', { name: /sign in/i })).toBeVisible()
})

test('purchase panel closes on backdrop click', async ({ page }) => {
  await page.goto('/')
  await page.locator('article').first().click()
  await page.waitForURL(/\/markets\//)

  await page.getByRole('button', { name: /buy protection/i }).click()
  await expect(page.getByRole('dialog')).toBeVisible()

  await page.mouse.click(100, 300)
  await expect(page.getByRole('dialog')).not.toBeVisible()
})
