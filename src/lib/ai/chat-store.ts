export type ChatRole = "system" | "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
  timestamp: string;
};

const MAX_HISTORY = 20;
const sessions = new Map<string, ChatMessage[]>();

const clampHistory = (messages: ChatMessage[]): ChatMessage[] =>
  messages.slice(-MAX_HISTORY);

export const createChatId = (): string => crypto.randomUUID();

export const readHistory = (chatId: string): ChatMessage[] =>
  sessions.get(chatId) ?? [];

export const appendHistory = (
  chatId: string,
  messages: ChatMessage[]
): ChatMessage[] => {
  const existing = readHistory(chatId);
  const merged = clampHistory([...existing, ...messages]);
  sessions.set(chatId, merged);
  return merged;
};

export const resetHistory = (chatId: string): void => {
  sessions.delete(chatId);
};
