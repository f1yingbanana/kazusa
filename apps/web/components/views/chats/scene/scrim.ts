/**
 * The overlay's surface over the world's art: the page's background, nearly
 * opaque and flat, so text in the foreground colour reads over any picture,
 * light or dark. Built from the theme token, since the dark theme follows the
 * system and no `dark:` class applies.
 */
export const SCRIM = "color-mix(in oklch, var(--background) 88%, transparent)";
