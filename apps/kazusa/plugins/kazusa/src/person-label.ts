/**
 * How a person appears to a character: their name to read and say, their id to
 * address (`members`, chat addresses). The id alone when no name is known.
 */
export function personLabel(name: string | undefined, id: string): string {
  return name && name !== id ? `${name} \`${id}\`` : `\`${id}\``;
}
