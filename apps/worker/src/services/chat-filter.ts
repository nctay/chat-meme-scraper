const ignoredChatAuthors = new Set(["nightbot", "streamelements"]);

export function isIgnoredChatCommand(messageText: string): boolean {
  return /^!sr(?:\s|$)/i.test(messageText.trim());
}

export function isIgnoredChatAuthor(authorName: string): boolean {
  return ignoredChatAuthors.has(authorName.trim().toLowerCase());
}

export function hasSkipTelegramPublicTag(messageText: string): boolean {
  return /!skip_tg(?=https?:\/\/|\s|$)/i.test(messageText);
}

export function stripSkipTelegramPublicTag(messageText: string): string {
  return messageText.replace(/!skip_tg(?=https?:\/\/|\s|$)/gi, " ").replace(/\s+/g, " ").trim();
}
