import { test, expect } from '@playwright/test';

test('Video Editor UI Loads and Interacts', async ({ page }) => {
  // 1. Navigate to home
  await page.goto('http://localhost:5173');

  // 2. Check for main layout elements
  await expect(page.getByText('Lumina Cut')).toBeVisible();
  await expect(page.getByText('Resources')).toBeVisible();
  await expect(page.getByText('Properties')).toBeVisible();
  await expect(page.getByText('PREVIEW')).toBeVisible();
  
  // 3. Check Timeline
  await expect(page.getByText('00:00:12:05')).toBeVisible();
  await expect(page.getByText('Clip_01.mp4')).toBeVisible();

  // 4. Theme Toggle
  // Check initial class on html or body. VueUse useDark usually adds 'dark' class to html
  const html = page.locator('html');
  await expect(html).toHaveClass(/dark/); // Assuming default might be dark or we toggle it.
  
  // Click toggle
  await page.getByLabel('Toggle Theme').click();
  await expect(html).not.toHaveClass(/dark/);
  
  // Toggle back
  await page.getByLabel('Toggle Theme').click();
  await expect(html).toHaveClass(/dark/);

  // 5. Resizing (basic check)
  const leftPanel = page.locator('div').filter({ hasText: /^Resources$/ }).first().locator('..');
  const initialWidth = await leftPanel.evaluate((el) => el.getBoundingClientRect().width);
  
  // Find the resizer handle (first one)
  const resizer = page.locator('.cursor-col-resize').first();
  
  // Drag resizer
  const box = await resizer.boundingBox();
  if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + 100, box.y + box.height / 2);
      await page.mouse.up();
  }

  // Check new width
  const newWidth = await leftPanel.evaluate((el) => el.getBoundingClientRect().width);
  expect(newWidth).toBeGreaterThan(initialWidth);
});
