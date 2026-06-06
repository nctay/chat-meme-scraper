export function isIgnoredChatCommand(messageText: string): boolean {
  return /^!sr(?:\s|$)/i.test(messageText.trim());
}
