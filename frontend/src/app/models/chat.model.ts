export interface AuthResponse {
  token: string;
  username: string;
  message: string;
  publicKey?: string;
  encryptedPrivateKey?: string;
}

export interface ChatMessage {
  id?: number;
  sender: string;
  recipient?: string | null;
  content: string;
  iv?: string;
  fileId?: string;
  timestamp?: string;
  type: 'CHAT' | 'JOIN' | 'LEAVE' | 'FILE' | 'DELETE' | 'CLEAR_CHAT';
  summary?: string;
}

export interface UserSearchResponse {
  username: string;
  relationStatus: 'NONE' | 'PENDING' | 'ACCEPTED';
  relationSender?: string;
  requestId?: number;
  publicKey?: string;
}

export interface PendingRequest {
  id: number;
  sender: string;
  timestamp: string;
}
