import { test, expect } from '@playwright/test'

test('browse page loads with all required elements', async ({ page }) => {
  await page.goto('/')

  // Header
  await expect(page.getByText('INSU')).toBeVisible()
  await expect(page.getByRole('link', { name: /log in/i })).toBeVisible()
  await expect(page.getByRole('link', { name: /sign up/i })).toBeVisible()

  // Category tabs
  await expect(page.getByRole('tab', { name: /urban/i })).toBeVisible()
  await expect(page.getByRole('tab', { name: /nature/i })).toBeVisible()
  await expect(page.getByRole('tab', { name: /experiences/i })).toBeVisible()
  await expect(page.getByRole('tab', { name: /events/i })).toBeVisible()
})

test('login page renders the form', async ({ page }) => {
  await page.goto('/auth/login')
  await expect(page.getByText('Welcome back')).toBeVisible()
  await expect(page.getByRole('button', { name: /log in/i })).toBeVisible()
})

test('signup page renders the form', async ({ page }) => {
  await page.goto('/auth/signup')
  await expect(page.getByText('Get protected')).toBeVisible()
  await expect(page.getByRole('button', { name: /sign up/i })).toBeVisible()
})
