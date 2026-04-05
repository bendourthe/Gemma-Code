export type Role = "user" | "assistant" | "system";

export interface Message {
  readonly id: string;
  readonly role: Role;
  readonly content: string;
  readonly timestamp: number;
}

export interface ConversationSession {
  readonly id: string;
  readonly title: string;
  readonly messages: readonly Message[];
  readonly createdAt: number;
  readonly updatedAt: number;
}
