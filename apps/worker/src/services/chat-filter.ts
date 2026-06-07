export function isIgnoredChatCommand(messageText: string): boolean {
  return /^!sr(?:\s|$)/i.test(messageText.trim());
}

export function isIgnoredChatAuthor(authorName: string): boolean {
  return authorName.trim().toLowerCase() === "nightbot";
}
