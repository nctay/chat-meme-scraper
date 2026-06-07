const ignoredChatAuthors = new Set(["nightbot", "streamelements"]);

export function isIgnoredChatCommand(messageText: string): boolean {
  return /^!sr(?:\s|$)/i.test(messageText.trim());
}

export function isIgnoredChatAuthor(authorName: string): boolean {
  return ignoredChatAuthors.has(authorName.trim().toLowerCase());
}
