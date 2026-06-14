import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ChatService } from '../../services/chat.service';
import { AuthService } from '../../services/auth.service';
import { FriendService } from '../../services/friend.service';
import { CryptoService } from '../../services/crypto.service';
import { ChatMessage, UserSearchResponse, PendingRequest } from '../../models/chat.model';
import { Subscription, interval } from 'rxjs';
import { startWith } from 'rxjs/operators';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.css']
})
export class ChatComponent implements OnInit, OnDestroy, AfterViewChecked {
  @ViewChild('scrollContainer') private scrollContainer!: ElementRef;
  @ViewChild('fileInput') fileInput!: ElementRef;
  @ViewChild('messageInput') messageInput!: ElementRef<HTMLInputElement>;

  messages: ChatMessage[] = [];
  newMessage = '';
  currentUser = '';
  isConnected = false;

  // Cache for decrypted files: msgId -> file metadata + objectUrl
  decryptedFiles: { [msgId: number]: { url: string, name: string, type: string, size: number, loading?: boolean, error?: boolean } } = {};
  expandedSummaries: { [msgId: number]: boolean } = {};


  // Friendship & DMs state
  activeChat = ''; // Empty string by default (welcome screen)
  searchQuery = '';
  searchResults: UserSearchResponse[] = [];
  pendingRequests: PendingRequest[] = [];
  friends: { username: string, publicKey: string }[] = [];
  unreadFriends: { [username: string]: boolean } = {};
  showSearch = false;

  private subs = new Subscription();

  constructor(
    private chatService: ChatService,
    private authService: AuthService,
    private friendService: FriendService,
    private cryptoService: CryptoService
  ) {
    this.currentUser = this.authService.getUsername() || 'Anonymous';
  }

  ngOnInit(): void {
    this.chatService.connect();

    // Subscribe to messages array
    this.subs.add(
      this.chatService.messages$.subscribe(msgs => {
        this.messages = msgs;
        this.scrollToBottom();
        msgs.forEach(msg => {
          if (msg.type === 'FILE') {
            this.decryptFileIfNeeded(msg);
          }
        });
      })
    );

    // Subscribe to connection state
    this.subs.add(
      this.chatService.connectionState$.subscribe(state => {
        this.isConnected = state;
      })
    );

    // Subscribe to messageReceived$ for dynamic E2EE decryption & notifications
    this.subs.add(
      this.chatService.messageReceived$.subscribe(async (msg: ChatMessage) => {
        if (!msg.recipient || msg.recipient === 'public') {
          // Ignore public lounge messages since it's removed
          return;
        }

        // Handle DELETE and CLEAR_CHAT events first (no decryption needed)
        if (msg.type === 'DELETE') {
          if (msg.id) {
            this.chatService.removeMessageFromLocal(msg.id);
            if (this.decryptedFiles[msg.id]) {
              const fileData = this.decryptedFiles[msg.id];
              if (fileData && fileData.url) {
                window.URL.revokeObjectURL(fileData.url);
              }
              delete this.decryptedFiles[msg.id];
            }
          }
          return;
        }

        if (msg.type === 'CLEAR_CHAT') {
          const clearedFriend = msg.content;
          if (this.activeChat === clearedFriend) {
            this.messages.forEach(m => {
              if (m.id && this.decryptedFiles[m.id]) {
                const fileData = this.decryptedFiles[m.id];
                if (fileData && fileData.url) {
                  window.URL.revokeObjectURL(fileData.url);
                }
                delete this.decryptedFiles[m.id];
              }
            });
            this.chatService.clearLocalChatHistory();
          }
          return;
        }

        // Private DM message
        const isFromActiveFriend = msg.sender === this.activeChat && msg.recipient === this.currentUser;
        const isSentByMeToActiveFriend = msg.sender === this.currentUser && msg.recipient === this.activeChat;

        // Decrypt the message first if it is relevant to us
        const friendName = msg.sender === this.currentUser ? msg.recipient! : msg.sender;
        const friendObj = this.friends.find(f => f.username === friendName);
        
        if (friendObj && friendObj.publicKey) {
          try {
            msg = await this.chatService.decryptIncomingMessage(msg, friendObj.publicKey);
          } catch (e) {
            msg.content = '[Decryption Failed: Key Mismatch]';
          }
        }

        if (isFromActiveFriend || isSentByMeToActiveFriend) {
          this.chatService.appendMessage(msg);
        } else if (msg.sender !== this.currentUser) {
          // Message from someone else, trigger notification bubble
          this.unreadFriends[msg.sender] = true;
        }
      })
    );

    // Poll Friends List and Pending Requests every 5 seconds
    this.subs.add(
      interval(5000)
        .pipe(startWith(0))
        .subscribe(() => {
          this.loadFriendsAndRequests();
        })
    );
  }

  ngAfterViewChecked(): void {
    this.scrollToBottom();
  }

  ngOnDestroy(): void {
    this.chatService.disconnect();
    this.subs.unsubscribe();
  }

  // Fetch friends list and pending invites
  loadFriendsAndRequests(): void {
    if (!this.authService.isLoggedIn()) return;

    this.friendService.getFriendsList().subscribe({
      next: (list) => {
        this.friends = list;
      }
    });

    this.friendService.getPendingRequests().subscribe({
      next: (requests) => {
        this.pendingRequests = requests;
      }
    });
  }

  // Switch chat channel (Friend DM)
  switchChat(destination: string): void {
    this.activeChat = destination;
    
    if (destination) {
      this.unreadFriends[destination] = false; // clear notifications
      const friendObj = this.friends.find(f => f.username === destination);
      if (friendObj && friendObj.publicKey) {
        this.chatService.loadPrivateHistory(destination, friendObj.publicKey);
      }
    } else {
      this.messages = [];
    }
  }

  // Trigger search query
  onSearchChange(): void {
    if (!this.searchQuery.trim()) {
      this.searchResults = [];
      return;
    }
    this.friendService.searchUsers(this.searchQuery.trim()).subscribe({
      next: (results) => {
        this.searchResults = results;
      }
    });
  }

  // Send request
  sendFriendRequest(targetUsername: string): void {
    this.friendService.sendFriendRequest(targetUsername).subscribe({
      next: () => {
        this.onSearchChange(); // refresh search list status
        this.loadFriendsAndRequests();
      }
    });
  }

  // Accept request
  acceptFriendRequest(requestId: number): void {
    this.friendService.acceptFriendRequest(requestId).subscribe({
      next: () => {
        this.loadFriendsAndRequests();
        if (this.searchQuery.trim()) {
          this.onSearchChange();
        }
      }
    });
  }

  // Decline request
  declineFriendRequest(requestId: number): void {
    this.friendService.declineFriendRequest(requestId).subscribe({
      next: () => {
        this.loadFriendsAndRequests();
        if (this.searchQuery.trim()) {
          this.onSearchChange();
        }
      }
    });
  }

  // Send private message
  async sendMessage(): Promise<void> {
    if (!this.newMessage.trim() || !this.activeChat) return;

    const messageText = this.newMessage.trim();
    this.newMessage = '';

    const friendObj = this.friends.find(f => f.username === this.activeChat);
    if (friendObj && friendObj.publicKey) {
      const words = messageText.split(/\s+/).filter(w => w.length > 0);
      if (words.length > 50) {
        this.chatService.summarizeText(messageText).subscribe({
          next: async (res) => {
            await this.chatService.sendPrivateMessage(this.activeChat!, friendObj.publicKey!, messageText, res.summary);
          },
          error: async (err) => {
            console.error('AI summarization failed, sending original message without summary', err);
            await this.chatService.sendPrivateMessage(this.activeChat!, friendObj.publicKey!, messageText);
          }
        });
      } else {
        await this.chatService.sendPrivateMessage(this.activeChat, friendObj.publicKey, messageText);
      }
    }

    // Maintain focus on the input to keep the mobile keyboard open
    setTimeout(() => {
      this.messageInput?.nativeElement?.focus();
    }, 50);
  }

  toggleSummary(msgId: number): void {
    this.expandedSummaries[msgId] = !this.expandedSummaries[msgId];
  }

  // Trigger file selection
  triggerFileInput(): void {
    this.fileInput.nativeElement.click();
  }

  onFileSelected(event: any): void {
    const file = event.target.files[0];
    if (!file || !this.activeChat) return;

    // Limit sharing size to 50MB
    const MAX_SIZE = 50 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      alert('The selected file is too large. Maximum size allowed for sharing is 50MB.');
      this.fileInput.nativeElement.value = '';
      return;
    }

    const friendObj = this.friends.find(f => f.username === this.activeChat);
    if (!friendObj || !friendObj.publicKey) {
      console.error('Cannot send file: friend public key missing.');
      this.fileInput.nativeElement.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e: any) => {
      try {
        const fileBytes = e.target.result as ArrayBuffer;

        // 1. Get or derive the shared secret key
        const sharedKey = await this.chatService.getOrCreateSharedKey(this.activeChat, friendObj.publicKey);

        // 2. Encrypt file bytes
        const encryptedResult = await this.cryptoService.encryptFile(fileBytes, sharedKey);

        // 3. Upload encrypted file to backend
        const encryptedBlob = new Blob([encryptedResult.ciphertext], { type: 'application/octet-stream' });
        
        // Temporarily append a local fake loading message or let it upload
        this.chatService.uploadFile(encryptedBlob).subscribe({
          next: async (res) => {
            // 4. Compile file metadata
            const metadata = {
              fileId: res.fileId,
              fileName: file.name,
              fileType: file.type || 'application/octet-stream',
              fileSize: file.size,
              fileIv: this.cryptoService['bufToBase64'](encryptedResult.iv)
            };

            // 5. Send STOMP FILE message
            const metadataStr = JSON.stringify(metadata);
            await this.chatService.sendPrivateFileMessage(
              this.activeChat,
              friendObj.publicKey,
              metadataStr,
              'FILE',
              res.fileId
            );
          },
          error: (err) => {
            console.error('Upload failed', err);
          }
        });
      } catch (err) {
        console.error('Encryption or upload failed', err);
      }
    };
    reader.readAsArrayBuffer(file);
    // Clear input to allow re-selection
    this.fileInput.nativeElement.value = '';
  }

  async decryptFileIfNeeded(msg: ChatMessage): Promise<void> {
    if (msg.type !== 'FILE' || !msg.id || this.decryptedFiles[msg.id]) {
      return;
    }

    // Initialize cache entry to prevent duplicate triggers
    this.decryptedFiles[msg.id] = { url: '', name: '', type: '', size: 0, loading: true };

    try {
      // Content contains the decrypted metadata string
      const metadata = JSON.parse(msg.content);
      const { fileId, fileName, fileType, fileSize, fileIv } = metadata;
      
      this.decryptedFiles[msg.id].name = fileName;
      this.decryptedFiles[msg.id].type = fileType;
      this.decryptedFiles[msg.id].size = fileSize;

      // Download encrypted file
      this.chatService.downloadFile(fileId).subscribe({
        next: async (encryptedBlob) => {
          try {
            const fileBytes = await encryptedBlob.arrayBuffer();
            const friendName = msg.sender === this.currentUser ? msg.recipient! : msg.sender;
            const friendObj = this.friends.find(f => f.username === friendName);
            if (!friendObj) throw new Error('Friend not found in list');

            const sharedKey = await this.chatService.getOrCreateSharedKey(friendObj.username, friendObj.publicKey);
            
            // Decrypt the file bytes
            const decryptedBytes = await this.cryptoService.decryptFile(
              fileBytes,
              this.cryptoService['base64ToBuf'](fileIv),
              sharedKey
            );

            // Create object URL for local display/download
            const decryptedBlob = new Blob([decryptedBytes], { type: fileType });
            const url = URL.createObjectURL(decryptedBlob);

            this.decryptedFiles[msg.id!].url = url;
            this.decryptedFiles[msg.id!].loading = false;
          } catch (err) {
            console.error('Failed to decrypt file bytes for message ' + msg.id, err);
            this.decryptedFiles[msg.id!].loading = false;
            this.decryptedFiles[msg.id!].error = true;
          }
        },
        error: (err) => {
          console.error('Failed to download file for message ' + msg.id, err);
          this.decryptedFiles[msg.id!].loading = false;
          this.decryptedFiles[msg.id!].error = true;
        }
      });
    } catch (e) {
      console.error('Failed to parse file metadata for message ' + msg.id, e);
      this.decryptedFiles[msg.id].loading = false;
      this.decryptedFiles[msg.id].error = true;
    }
  }

  getDecryptedFile(msgId: number | undefined): { url: string, name: string, type: string, size: number, loading?: boolean, error?: boolean } | null {
    if (msgId === undefined) return null;
    return this.decryptedFiles[msgId] || null;
  }



  deleteMessage(messageId: number): void {
    if (confirm('Are you sure you want to delete this message? This will delete it for everyone.')) {
      this.chatService.deleteMessage(messageId).subscribe({
        error: (err) => console.error('Failed to delete message', err)
      });
    }
  }

  clearActiveChat(): void {
    if (!this.activeChat) return;
    if (confirm(`Are you sure you want to clear your chat history with ${this.activeChat}? This will delete all messages for both of you and cannot be undone.`)) {
      this.chatService.clearChatHistory(this.activeChat).subscribe({
        error: (err) => console.error('Failed to clear chat history', err)
      });
    }
  }

  logout(): void {

    this.chatService.disconnect();
    this.authService.logout();
    window.location.reload();
  }

  private scrollToBottom(): void {
    try {
      this.scrollContainer.nativeElement.scrollTop = this.scrollContainer.nativeElement.scrollHeight;
    } catch (err) {}
  }

  getAvatarColor(username: string): string {
    if (!username) return '#6366f1';
    let hash = 0;
    for (let i = 0; i < username.length; i++) {
      hash = username.charCodeAt(i) + ((hash << 5) - hash);
    }
    const colors = [
      '#6366f1', '#3b82f6', '#10b981', '#f59e0b', 
      '#ec4899', '#8b5cf6', '#06b6d4', '#f43f5e'
    ];
    const index = Math.abs(hash) % colors.length;
    return colors[index];
  }
}
