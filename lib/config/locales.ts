/**
 * Which languages this deployment SERVES, as against which it has.
 *
 * WHY THE TWO ARE DIFFERENT NOW. `nepali-native-read` holds 402 money, safety
 * and legal strings waiting for a native speaker to read them in place, and that
 * blocks a launch — correctly, because a professional misreading the cash-fee
 * line loses money with nobody there to correct them. But it is not the only way
 * out: a Nepali reader who is never served Nepali cannot be misled by it. So
 * `NEXT_PUBLIC_ENGLISH_ONLY=true` is the option the launch gating decision added
 * — a product that is SMALLER rather than one that is WRONG — and
 * `check:blockers` reads this same variable, so the gate and the product cannot
 * disagree about whether anybody is being served unread copy.
 *
 * IT IS NOT A FEATURE FLAG FOR TRANSLATION WORK. Nepali is a first-class path
 * here and every screen exists in both; this hides the half we have not had read
 * aloud yet, for as long as that is true, and `LAUNCH-BLOCKERS.md` is what
 * records the cost. The default is OFF, so a local run, CI, the paint check and
 * the booking-flow walk all keep exercising both languages — a switch that
 * changed the default would quietly stop testing the language it is about.
 *
 * `NEXT_PUBLIC_` BECAUSE IT IS READ AT BUILD TIME ON BOTH SIDES. Next inlines it,
 * which is what makes the gate honest: the check runs in the same build that
 * decides which locales the router serves, so "the strings are unread but nobody
 * is served them" is one fact rather than two that can drift. It also means
 * changing it needs a new build, which is the standing rule for every
 * environment variable in this product and not a limitation of this one.
 */

/**
 * Every locale this product HAS, in the order they were added.
 *
 * THE TYPE COMES FROM HERE AND NEVER FROM THE SERVED LIST, which is the trap
 * worth naming: `Locale` has to stay `"en" | "ne"` whatever a deployment serves,
 * because `messages/ne.json`, `categoryCopy`, `formatNpr` and every
 * `locale === "ne"` branch in the product are still there and still correct.
 * Narrowing the union to what is served would make hiding Nepali a
 * type-level deletion of the Nepali half of the codebase.
 */
export const ALL_LOCALES = ["en", "ne"] as const;

export type AnyLocale = (typeof ALL_LOCALES)[number];

/** Is the Nepali half hidden on this deployment? */
export function englishOnly(): boolean {
  return process.env.NEXT_PUBLIC_ENGLISH_ONLY === "true";
}

/**
 * The locales the router serves, which is what `/ne/...` resolving depends on.
 *
 * ENGLISH IS NEVER DROPPED, so this can only ever shrink to one. There is no
 * `NEPALI_ONLY` and the default locale is `en`, so an unparseable or absent
 * variable serves both — the honest direction, since the failure it guards
 * against is serving unread copy and the fix for that is reading it.
 */
export function servedLocales(): readonly AnyLocale[] {
  return englishOnly() ? (["en"] as const) : ALL_LOCALES;
}
