import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { Client, IMessage } from '@stomp/stompjs';
import { ChatMessage } from '../models/chat.model';
import { AuthService } from './auth.service';
import { CryptoService } from './crypto.service';

@Injectable({
  providedIn: 'root'
})
export class ChatService {
  private stompClient: Client | null = null;
  
  private messagesSubject = new BehaviorSubject<ChatMessage[]>([]);
  public messages$: Observable<ChatMessage[]> = this.messagesSubject.asObservable();
  
  private connectionStateSubject = new BehaviorSubject<boolean>(false);
  public connectionState$: Observable<boolean> = this.connectionStateSubject.asObservable();

  private messageReceivedSubject = new Subject<ChatMessage>();
  public messageReceived$: Observable<ChatMessage> = this.messageReceivedSubject.asObservable();

  private getApiUrl(): string {
    const base = (window.location.hostname === 'localhost' && window.location.port === '4200')
      ? 'http://localhost:8080'
      : window.location.origin;
    return base + '/api/chat';
  }
  private apiUrl = this.getApiUrl();

  // Cache derived AES shared keys in memory
  private sharedSecrets: { [username: string]: CryptoKey } = {};

  constructor(
    private http: HttpClient,
    private authService: AuthService,
    private cryptoService: CryptoService
  ) {}

  public async getOrCreateSharedKey(friendUsername: string, friendPublicKeyJwk: string): Promise<CryptoKey> {
    if (this.sharedSecrets[friendUsername]) {

      return this.sharedSecrets[friendUsername];
    }
    
    const myPrivateKey = this.authService.getPrivateKey();
    if (!myPrivateKey) {
      throw new Error('User private key not available. Please log in again.');
    }
    
    const sharedKey = await this.cryptoService.deriveSharedSecret(myPrivateKey, friendPublicKeyJwk);
    this.sharedSecrets[friendUsername] = sharedKey;
    return sharedKey;
  }

  loadPublicHistory(): void {
    this.http.get<ChatMessage[]>(`${this.apiUrl}/history`).subscribe({
      next: (history) => {
        this.messagesSubject.next(history);
      },
      error: (err) => {
        console.error('Error fetching public chat history', err);
      }
    });
  }

  async loadPrivateHistory(friendUsername: string, friendPublicKeyJwk: string): Promise<void> {
    try {
      const sharedKey = await this.getOrCreateSharedKey(friendUsername, friendPublicKeyJwk);
      
      this.http.get<ChatMessage[]>(`${this.apiUrl}/history/${friendUsername}`).subscribe({
        next: async (history) => {
          // Decrypt all historical messages in this DM
          const decryptedHistory = await Promise.all(
            history.map(async (msg) => {
              if ((msg.type === 'CHAT' || msg.type === 'FILE') && msg.content && msg.iv) {
                try {
                  const decrypted = await this.cryptoService.decryptMessage(msg.content, msg.iv, sharedKey);
                  try {
                    const parsed = JSON.parse(decrypted);
                    msg.content = parsed.text;
                    msg.summary = parsed.summary;
                  } catch (e) {
                    msg.content = decrypted;
                  }
                } catch (e) {
                  msg.content = '[Decryption Failed: Key Mismatch]';
                }
              }
              return msg;
            })
          );
          this.messagesSubject.next(decryptedHistory);
        },
        error: (err) => {
          console.error(`Error fetching private chat history for ${friendUsername}`, err);
        }
      });
    } catch (e) {
      console.error('Failed to load private history due to crypto error', e);
    }
  }

  // Decrypts an incoming real-time private message
  async decryptIncomingMessage(msg: ChatMessage, friendPublicKeyJwk: string): Promise<ChatMessage> {
    if ((msg.type === 'CHAT' || msg.type === 'FILE') && msg.content && msg.iv) {
      const friendUsername = msg.sender === this.authService.getUsername() ? msg.recipient! : msg.sender;
      const sharedKey = await this.getOrCreateSharedKey(friendUsername, friendPublicKeyJwk);
      try {
        const decrypted = await this.cryptoService.decryptMessage(msg.content, msg.iv, sharedKey);
        try {
          const parsed = JSON.parse(decrypted);
          msg.content = parsed.text;
          msg.summary = parsed.summary;
        } catch (e) {
          msg.content = decrypted;
        }
      } catch (e) {
        msg.content = '[Decryption Failed]';
      }
    }
    return msg;
  }


  appendMessage(msg: ChatMessage): void {
    const current = this.messagesSubject.getValue();
    this.messagesSubject.next([...current, msg]);
  }

  removeMessageFromLocal(messageId: number): void {
    const current = this.messagesSubject.getValue();
    this.messagesSubject.next(current.filter(m => m.id !== messageId));
  }

  clearLocalChatHistory(): void {
    this.messagesSubject.next([]);
  }

  connect(): void {
    const token = this.authService.getToken();
    const username = this.authService.getUsername();
    
    if (!token || !username) {
      console.warn('Cannot connect to chat: token or username missing.');
      return;
    }

    // Configure STOMP Client
    this.stompClient = new Client({
      brokerURL: (window.location.hostname === 'localhost' && window.location.port === '4200')
        ? 'ws://localhost:8080/ws'
        : ((window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host + '/ws'),
      connectHeaders: {
        Authorization: `Bearer ${token}`
      },
      reconnectDelay: 5000,
      heartbeatIncoming: 4000,
      heartbeatOutgoing: 4000,
      debug: (msg) => {
        console.log(msg);
      }
    });

    this.stompClient.onConnect = (frame) => {
      console.log('Connected to WebSocket server: ' + frame);
      this.connectionStateSubject.next(true);

      // Subscribe to public topic
      this.stompClient!.subscribe('/topic/public', (message: IMessage) => {
        const chatMsg: ChatMessage = JSON.parse(message.body);
        this.messageReceivedSubject.next(chatMsg);
      });

      // Subscribe to private queue
      this.stompClient!.subscribe('/user/queue/messages', (message: IMessage) => {
        const chatMsg: ChatMessage = JSON.parse(message.body);
        this.messageReceivedSubject.next(chatMsg);
      });

      // Send join notification
      const joinMessage: ChatMessage = {
        sender: username,
        content: '',
        type: 'JOIN'
      };
      this.stompClient!.publish({
        destination: '/app/chat.addUser',
        body: JSON.stringify(joinMessage)
      });
    };

    this.stompClient.onDisconnect = () => {
      console.log('Disconnected from WebSocket server');
      this.connectionStateSubject.next(false);
    };

    this.stompClient.onStompError = (frame) => {
      console.error('STOMP Broker reported error: ' + frame.headers['message']);
      console.error('Additional details: ' + frame.body);
    };

    this.stompClient.activate();
  }

  sendPublicMessage(content: string): void {
    const username = this.authService.getUsername();
    if (this.stompClient && this.stompClient.connected && username) {
      const chatMessage: ChatMessage = {
        sender: username,
        content: content,
        type: 'CHAT'
      };
      this.stompClient.publish({
        destination: '/app/chat.sendMessage',
        body: JSON.stringify(chatMessage)
      });
    }
  }

  summarizeText(text: string): Observable<{ summary: string }> {
    const baseApi = this.apiUrl.substring(0, this.apiUrl.lastIndexOf('/chat'));
    const aiUrl = baseApi + '/ai/summarize';
    return this.http.post<{ summary: string }>(aiUrl, { text });
  }

  async sendPrivateMessage(recipient: string, recipientPublicKeyJwk: string, content: string, summary?: string): Promise<void> {
    const username = this.authService.getUsername();
    if (this.stompClient && this.stompClient.connected && username) {
      try {
        const sharedKey = await this.getOrCreateSharedKey(recipient, recipientPublicKeyJwk);
        
        let textToEncrypt = content;
        if (summary) {
          textToEncrypt = JSON.stringify({ text: content, summary: summary });
        }
        
        const encrypted = await this.cryptoService.encryptMessage(textToEncrypt, sharedKey);
        
        const chatMessage: ChatMessage = {
          sender: username,
          recipient: recipient,
          content: encrypted.ciphertext,
          iv: encrypted.iv,
          type: 'CHAT'
        };
        
        this.stompClient.publish({
          destination: '/app/chat.privateMessage',
          body: JSON.stringify(chatMessage)
        });
      } catch (e) {
        console.error('Failed to encrypt and send private message', e);
      }
    }
  }

  // Send private file message metadata
  async sendPrivateFileMessage(recipient: string, recipientPublicKeyJwk: string, content: string, type: 'CHAT' | 'JOIN' | 'LEAVE' | 'FILE', fileId: string): Promise<void> {
    const username = this.authService.getUsername();
    if (this.stompClient && this.stompClient.connected && username) {
      try {
        const sharedKey = await this.getOrCreateSharedKey(recipient, recipientPublicKeyJwk);
        const encrypted = await this.cryptoService.encryptMessage(content, sharedKey);
        
        const chatMessage: ChatMessage = {
          sender: username,
          recipient: recipient,
          content: encrypted.ciphertext,
          iv: encrypted.iv,
          type: type,
          fileId: fileId
        };
        
        this.stompClient.publish({
          destination: '/app/chat.privateMessage',
          body: JSON.stringify(chatMessage)
        });
      } catch (e) {
        console.error('Failed to encrypt and send private file message', e);
      }
    }
  }

  deleteMessage(messageId: number): Observable<any> {
    return this.http.delete<any>(`${this.apiUrl}/messages/${messageId}`);
  }

  clearChatHistory(friendUsername: string): Observable<any> {
    return this.http.delete<any>(`${this.apiUrl}/history/${friendUsername}`);
  }

  uploadFile(encryptedBlob: Blob): Observable<{ fileId: string }> {
    const formData = new FormData();
    formData.append('file', encryptedBlob, 'encrypted.bin');
    return this.http.post<{ fileId: string }>(`${this.apiUrl}/upload`, formData);
  }

  downloadFile(fileId: string): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/download/${fileId}`, { responseType: 'blob' });
  }

  disconnect(): void {

    if (this.stompClient) {
      const username = this.authService.getUsername();
      if (this.stompClient.connected && username) {
        const leaveMessage: ChatMessage = {
          sender: username,
          content: '',
          type: 'LEAVE'
        };
        this.stompClient.publish({
          destination: '/app/chat.sendMessage',
          body: JSON.stringify(leaveMessage)
        });
      }
      this.stompClient.deactivate();
      this.connectionStateSubject.next(false);
    }
  }
}
