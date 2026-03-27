export interface DocumentRecord {
  id: string;
  title: string;
  subjectName: string;
  date: string;
  imageUrl: string;
  extractedText: string;
  language: string;
  summary: string;
  status: 'processed' | 'pending' | 'error';
  uid: string;
}

export type ViewState = 'list' | 'upload' | 'detail' | 'admin';

export interface User {
  id: string;
  email: string;
  role: 'user' | 'admin';
  token: string;
}
