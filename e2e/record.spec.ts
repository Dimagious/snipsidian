import { test } from "./fixtures";

/**
 * Recording harness. Not a real test — it boots Obsidian against the
 * pristine vault (trust dialog auto-clicked, Welcome.md opened) and
 * then pauses so you can drive the rest by hand while Playwright
 * Inspector records the actions and generates code.
 *
 * Workflow:
 *   1. Run `npm run e2e:record`
 *   2. Obsidian + Playwright Inspector windows open
 *   3. In Inspector click the red "Record" button (top-right)
 *   4. Click into the Obsidian editor and perform the scenario you
 *      want to pin (type a trigger, open the picker, ...)
 *   5. Inspector shows generated locator code as you go
 *   6. Copy the code back into a real spec under `e2e/`
 *   7. Close Inspector / hit Ctrl+C
 */
test("interactive recording session", async ({ win }) => {
    // eslint-disable-next-line no-console
    console.log(
        "\n→ Obsidian is open at the pristine vault. " +
        "Click Record in the Playwright Inspector window, then drive the scenario.\n",
    );
    await win.pause();
});
