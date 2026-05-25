import { createContext, useContext } from 'react';

export interface MarkdownRendererContextValue {
  onFilePreview?: (fileId: string, context?: { conversationId?: string }) => void;
  conversationId?: string;
}

export const MarkdownRendererContext = createContext<MarkdownRendererContextValue>({});

export function useMarkdownRendererContext(): MarkdownRendererContextValue {
  return useContext(MarkdownRendererContext);
}
