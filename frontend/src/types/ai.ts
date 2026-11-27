export interface GoogleReader {
  id: string;
  name: string;
  email: string;
}

export interface AISession {
  user: GoogleReader | null;
  googleClientId: string;
  geminiConfigured: boolean;
  model: string;
  csrfToken: string;
}

export interface AICatalogBook {
  id: string;
  title: string;
  author: string;
  category: string;
  description: string;
  available_copies: number;
  shelf: string;
}

export interface AIHistoryMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface AIAnswer {
  text: string;
  bookIds: string[];
  query: string;
  suggestions: string[];
  model: string;
}
