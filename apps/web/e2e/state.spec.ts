import { expect, test as base, type Page } from "@playwright/test";
import {
  ChatsResponseSchema,
  TimelineResponseSchema,
  WikiListResponseSchema,
} from "@kazusa/client";

const test = base.extend<{ runtimeErrors: void }>({
  runtimeErrors: [
    async ({ context }, use) => {
      const errors: string[] = [];
      const trackErrors = (page: Page): void => {
        page.on("pageerror", (error) => errors.push(error.message));
      };
      context.pages().forEach(trackErrors);
      context.on("page", trackErrors);
      await use();
      context.off("page", trackErrors);
      expect(errors, "browser runtime errors").toEqual([]);
    },
    { auto: true },
  ],
});

test("two tabs preserve each other's preferences and synchronize removals", async ({
  page,
  context,
}) => {
  const other = await context.newPage();
  await Promise.all([
    page.goto("/?world.as=list"),
    other.goto("/?world.as=list"),
  ]);
  await Promise.all([expectLive(page), expectLive(other)]);
  const members = (tab: Page) =>
    tab.getByRole("list", { name: "Everyone members" });
  const star = members(page)
    .getByRole("button", { name: /^Star / })
    .first();
  await expect(star).toBeVisible();
  const character = (await star.innerText()).replace(/^Star /, "");
  await members(page).getByRole("button").first().click();
  await members(other).getByRole("button").first().click();

  await star.click();
  const starred = (tab: Page) =>
    members(tab).getByRole("button", {
      name: `Unstar ${character}`,
      exact: true,
    });
  await expect(starred(other)).toHaveAttribute("aria-pressed", "true");

  const about = (tab: Page) =>
    tab
      .getByRole("complementary", { name: "Inspector" })
      .getByRole("button", { name: /^About/ });
  await expect(about(other)).toHaveAttribute("aria-expanded", "false");
  await about(other).click();
  await expect(about(page)).toHaveAttribute("aria-expanded", "true");
  await expect(starred(page)).toHaveAttribute("aria-pressed", "true");

  await page.reload();
  await expect(starred(page)).toHaveAttribute("aria-pressed", "true");
  await expect(about(page)).toHaveAttribute("aria-expanded", "true");
  await page.evaluate(() => localStorage.removeItem("kazusa:preferences"));
  await expect(
    members(other).getByRole("button", {
      name: `Star ${character}`,
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(about(other)).toHaveAttribute("aria-expanded", "false");
});

async function expectLive(page: Page): Promise<void> {
  await expect(
    page.getByRole("status").filter({ hasText: /^Live$/ }),
  ).toBeVisible();
}

test("roster selection, persisted watchlist, navigation and cached resources", async ({
  page,
}) => {
  const worldRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/kazusa/world")
      worldRequests.push(request.url());
  });
  await page.goto("/?world.as=list");
  await expectLive(page);
  const members = page.getByRole("list", { name: "Everyone members" });
  await expect(members.getByRole("button").first()).toBeVisible();
  const star = members.getByRole("button", { name: /^Star / }).first();
  const character = (await star.innerText()).replace(/^Star /, "");
  await star.click();
  await members.getByRole("button").first().click();
  await expect(page).toHaveURL(/sel=character/);
  await expect(
    page.getByRole("complementary", { name: "Inspector" }),
  ).toContainText(character);
  const selection = new URL(page.url()).searchParams.get("sel");

  const sections = page.getByRole("navigation", { name: "Sections" });
  for (const name of ["Timeline", "Wiki", "Settings", "World"]) {
    await sections.getByRole("button", { name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`view=${name.toLowerCase()}`));
    await expect(page.locator("main")).not.toBeEmpty();
    expect(new URL(page.url()).searchParams.get("sel")).toBe(selection);
  }
  expect(worldRequests).toHaveLength(1);
  await page.reload();
  await expectLive(page);
  await expect(
    members.getByRole("button", { name: `Unstar ${character}`, exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("complementary", { name: "World sidebar" })
    .getByRole("button", { name: /^Watchlist/ })
    .click();
  await expect(
    page.getByRole("list", { name: "Watchlist members" }),
  ).toContainText(character);
});

test("real chat history renders and remains usable after reconnect", async ({
  page,
  request,
  context,
}) => {
  const response = await request.get("/kazusa/chats");
  expect(response.ok()).toBe(true);
  const { chats } = ChatsResponseSchema.parse(await response.json());
  const chat = chats.find((entry) => entry.type === "direct");
  expect(
    chat,
    "the configured world needs an existing direct chat",
  ).toBeDefined();
  if (!chat) return;
  await page.goto(`/?view=chats&chats.id=${encodeURIComponent(chat.id)}`);
  await expectLive(page);
  await expect(
    page.getByRole("textbox", { name: "Message", exact: true }),
  ).toBeVisible();
  await expect(page.locator("main [data-shot-id]").first()).toBeAttached();
  const messageIds = await page
    .locator("main [data-shot-id]")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-shot-id")),
    );
  const chatId = new URL(page.url()).searchParams.get("chats.id");
  await context.setOffline(true);
  await expect(
    page.getByRole("status").filter({ hasText: /Reconnecting|Offline/ }),
  ).toBeVisible();
  await context.setOffline(false);
  await expectLive(page);
  expect(new URL(page.url()).searchParams.get("chats.id")).toBe(chatId);
  await expect(
    page.getByRole("textbox", { name: "Message", exact: true }),
  ).toBeEnabled();
  await expect
    .poll(() =>
      page
        .locator("main [data-shot-id]")
        .evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute("data-shot-id")),
        ),
    )
    .toEqual(messageIds);
});

test("timeline scroll fetches another real history page", async ({ page }) => {
  await page.goto("/?view=timeline");
  await expectLive(page);
  const timeline = page.getByRole("region", { name: "Timeline", exact: true });
  await expect(timeline.locator("[data-index]").first()).toBeVisible();
  const nextPage = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/kazusa/timeline" &&
      url.searchParams.has("before") &&
      response.ok()
    );
  });
  await timeline.locator(".overflow-y-auto").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const history = TimelineResponseSchema.parse(await (await nextPage).json());
  expect(history.events.length).toBeGreaterThan(0);
});

test("wiki edits survive offline and reconnect without changing the server", async ({
  page,
  request,
  context,
}) => {
  const response = await request.get("/kazusa/wiki");
  expect(response.ok()).toBe(true);
  const { pages } = WikiListResponseSchema.parse(await response.json());
  const entry = pages[0];
  expect(entry, "the configured world needs a wiki page").toBeDefined();
  if (!entry) return;
  await page.goto(`/?view=wiki&wiki.page=${encodeURIComponent(entry.id)}`);
  await expectLive(page);
  await page
    .getByRole("button", { name: "Edit the world", exact: true })
    .click();
  const editor = page.getByRole("textbox", {
    name: `Markdown of ${entry.name}`,
  });
  await expect(editor).toBeVisible();
  const original = await editor.inputValue();
  const draft = `${original}\n\nUnsaved browser test draft.`;
  await editor.fill(draft);
  await context.setOffline(true);
  await expect(
    page.getByRole("status").filter({ hasText: /Reconnecting|Offline/ }),
  ).toBeVisible();
  await context.setOffline(false);
  await expectLive(page);
  await expect(editor).toHaveValue(draft);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Edit the world", exact: true })
    .click();
  await expect(editor).toHaveValue(original);
});

test("mobile selection opens the inspector and section navigation stays usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?world.as=list");
  await page.getByRole("button", { name: /^Everyone/ }).click();
  const members = page.getByRole("list", { name: "Everyone members" });
  await members.getByRole("button").first().click();
  const inspector = page.getByRole("dialog", { name: "Inspector" });
  await expect(inspector).toBeVisible();
  await inspector
    .getByRole("button", { name: "Close details", exact: true })
    .click();
  await expect(inspector).not.toBeVisible();
  await page
    .getByRole("navigation", { name: "Sections" })
    .getByRole("button", { name: "Timeline", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Timeline", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Sections" })
    .getByRole("button", { name: "World", exact: true })
    .click();
  await expect(members).toBeVisible();
});
