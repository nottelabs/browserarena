import { expect, test } from "@playwright/test";
test("access report preserves outcomes, round selection and replay provenance", async ({ page }) => {
  await page.goto("/website-access");
  await expect(page.getByRole("heading",{name:"Website access",exact:true})).toBeVisible();
  await expect(page.getByRole("columnheader",{name:/Browser Use.*53\/60/})).toBeVisible();
  const evidence=page.getByRole("region",{name:"Inspect a visit"});
  await expect(evidence.getByText("Recorded follow-up, excluded from scores",{exact:true})).toHaveCount(2);
  await page.getByRole("button", {name:"flo.com.tr",exact:true}).click(); await expect(evidence).toBeFocused();
  const round2=evidence.getByRole("button",{name:"2",exact:true});await round2.focus();await page.keyboard.press("Enter");
  await expect(round2).toBeFocused();await expect(round2).toHaveAttribute("aria-pressed","true");
  await expect(evidence.getByRole("article").first()).toHaveAttribute("aria-label",/round 2/);
  await page.getByRole("searchbox",{name:"Find a website"}).fill("does-not-exist");
  await expect(page.getByRole("status")).toContainText("No websites match");
  await page.getByRole("button",{name:"Clear search"}).click();
  await expect(page.getByRole("rowheader")).toHaveCount(20);
  const response=await page.request.get("/website-access/export");expect(response.ok()).toBeTruthy();expect((await response.json()).visits).toHaveLength(300);
});
test("access matrix scrolls locally on mobile and screenshots load",async({page})=>{
  await page.goto("/website-access");
  for(const width of [375,1440]){
    await page.setViewportSize({width,height:1000});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
  }
  const image=page.getByRole("img",{name:/Browser Use original 60-second view/});await image.scrollIntoViewIfNeeded();
  await expect(image).toBeVisible();await expect.poll(()=>image.evaluate((el:HTMLImageElement)=>el.naturalWidth)).toBeGreaterThan(0);
});
