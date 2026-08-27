/**
 * Captures the screenshots that document a working run, into docs/evidence/.
 *
 * Scripted rather than taken by hand so the evidence can be regenerated after any change
 * and always shows the same scenes in the same order.
 *
 * Requires the API on :4000 and the web app on :3000, with the corpus seeded and indexed.
 *
 * Usage: npm run evidence
 */
import { chromium, type Page } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";
import "dotenv/config";

const WEB = process.env.EVIDENCE_WEB_URL ?? "http://localhost:3000";
const OUT = resolve(import.meta.dirname, "..", "docs", "evidence");
const PASSWORD = "Riwi2026*";

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

/** Someone in three public channels and in neither private one. */
const OUTSIDER = "juan.jose.giraldo@riwi.io";
/** A member of Dirección Financiera: the positive control. */
const INSIDER = "daniela.pineda@riwi.io";

const PRIVATE_QUESTION = "cual fue el ajuste salarial del segundo semestre?";
const PUBLIC_QUESTION = "por que el equipo eligio SSE en vez de websockets?";

let step = 0;
const shot = async (page: Page, name: string) => {
  step += 1;
  const file = resolve(OUT, `${String(step).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  ${file.replace(`${OUT}/`, "")}`);
};

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto(`${WEB}/login`);
  await page.getByLabel("Correo").fill(email);
  await page.getByLabel("Contraseña").fill(PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL("**/chat");
  // The conversation list arriving is the signal that the session really works.
  await page.getByRole("button", { name: /General/ }).first().waitFor();
}

/** On a phone the channel list is its own tab, so a channel has to be picked explicitly. */
async function openGeneralOnMobile(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Canales" }).click();
  await page.getByRole("button", { name: /General/ }).first().click();
  await page.waitForTimeout(500);
}

async function askCopilot(page: Page, question: string): Promise<void> {
  await page.getByPlaceholder("¿Qué quieres saber?").fill(question);
  await page.getByRole("button", { name: "Preguntar" }).click();
  // The refusal path never calls the model and returns almost immediately; an answered
  // question waits on a completion, so the timeout has to cover the slow case.
  await page.getByText("Buscando en tus canales…").waitFor({ state: "detached", timeout: 90_000 });
  await page.waitForTimeout(400);
}

/**
 * Each run posts one message to prove realtime delivery. Left alone they accumulate, so
 * the ones from previous runs are removed first and the corpus stays as the seed left it.
 */
async function clearPreviousRuns(): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  await client.connect();
  try {
    await client.query("begin");
    await client.query(
      "delete from rw_message_reads where message_id in (select id from rw_messages where body like 'Mensaje en vivo %')",
    );
    await client.query(
      "delete from rw_message_embeddings where message_id in (select id from rw_messages where body like 'Mensaje en vivo %')",
    );
    await client.query("delete from rw_messages where body like 'Mensaje en vivo %'");
    await client.query("commit");
  } finally {
    await client.end();
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  await clearPreviousRuns();
  console.log(`Capturing evidence into docs/evidence\n`);

  const browser = await chromium.launch();

  // --- Desktop, as the outsider -------------------------------------------------
  const desktop = await browser.newContext({ viewport: DESKTOP, locale: "es-CO" });
  const page = await desktop.newPage();

  await page.goto(`${WEB}/login`);
  await shot(page, "login");

  await signIn(page, OUTSIDER);
  // Three zones at once: channels, conversation, and profile above the copilot.
  await shot(page, "chat-three-zones-desktop");

  await page.getByPlaceholder("Buscar en tus canales…").fill("paginacion");
  await page.getByText(/resultados/).waitFor();
  await page.waitForTimeout(500);
  // Accent insensitive: the query has no accent, the corpus does.
  await shot(page, "search-highlight");
  await page.getByPlaceholder("Buscar en tus canales…").fill("");

  await askCopilot(page, PUBLIC_QUESTION);
  await shot(page, "copilot-answer-with-citations");

  // The scene the whole design exists for: this user is not in Dirección Financiera.
  await askCopilot(page, PRIVATE_QUESTION);
  await shot(page, "copilot-refuses-private-channel");

  await page.getByRole("button", { name: "en", exact: true }).first().click();
  await page.waitForTimeout(400);
  await shot(page, "interface-in-english");
  await page.getByRole("button", { name: "es", exact: true }).first().click();

  // --- Desktop, as a member: the same question, answered ------------------------
  const insiderContext = await browser.newContext({ viewport: DESKTOP, locale: "es-CO" });
  const insiderPage = await insiderContext.newPage();
  await signIn(insiderPage, INSIDER);
  await askCopilot(insiderPage, PRIVATE_QUESTION);
  await shot(insiderPage, "copilot-answers-same-question-for-member");

  // --- Real time: a second person receives a message they did not send ----------
  const listener = await browser.newContext({ viewport: DESKTOP, locale: "es-CO" });
  const listenerPage = await listener.newPage();
  await signIn(listenerPage, "laura.betancur@riwi.io");
  await listenerPage.getByRole("button", { name: /General/ }).first().click();
  await listenerPage.waitForTimeout(1500);

  const stamp = `Mensaje en vivo ${new Date().toISOString().slice(11, 19)}`;
  await page.getByRole("button", { name: /General/ }).first().click();
  await page.getByPlaceholder("Escribe un mensaje…").fill(stamp);
  await page.getByRole("button", { name: "Enviar" }).click();

  // It arrives in the other browser without a reload: that is the whole claim.
  await listenerPage.getByText(stamp).waitFor({ timeout: 20_000 });
  await shot(listenerPage, "realtime-message-received");
  await shot(page, "realtime-message-sent");

  // --- Mobile ------------------------------------------------------------------
  const mobile = await browser.newContext({ viewport: MOBILE, locale: "es-CO", isMobile: true, hasTouch: true });
  const mobilePage = await mobile.newPage();
  await signIn(mobilePage, OUTSIDER);
  await shot(mobilePage, "mobile-channels");

  await openGeneralOnMobile(mobilePage);
  await shot(mobilePage, "mobile-conversation");

  await mobilePage.getByRole("button", { name: "Copiloto" }).click();
  await mobilePage.waitForTimeout(300);
  // An empty panel proves the tab exists and nothing else, so ask something first.
  await askCopilot(mobilePage, PUBLIC_QUESTION);
  await shot(mobilePage, "mobile-copilot");

  await mobilePage.getByRole("button", { name: "Perfil" }).click();
  await mobilePage.waitForTimeout(300);
  await shot(mobilePage, "mobile-profile");

  await browser.close();
  console.log(`\nDone. ${step} screenshots.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
