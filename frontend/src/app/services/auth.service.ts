import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject, from } from 'rxjs';
import { tap, switchMap } from 'rxjs/operators';
import { AuthResponse } from '../models/chat.model';
import { CryptoService } from './crypto.service';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private apiUrl = 'http://localhost:8080/api/auth';
  private loggedInUser = new BehaviorSubject<string | null>(localStorage.getItem('chat_username'));
  
  // Cache the decrypted ECDH private key in memory (never written to disk)
  private userPrivateKey: CryptoKey | null = null;
  private restorePromise: Promise<void>;

  constructor(
    private http: HttpClient,
    private cryptoService: CryptoService
  ) {
    console.log('[AuthService] Initializing and restoring private key...');
    this.restorePromise = this.restorePrivateKey();
  }

  public async waitForInit(): Promise<void> {
    await this.restorePromise;
  }

  private async restorePrivateKey(): Promise<void> {
    const cachedJwk = sessionStorage.getItem('chat_private_key');
    console.log('[AuthService] Cached private key in sessionStorage present:', !!cachedJwk);
    if (cachedJwk) {
      try {
        const jwk = JSON.parse(cachedJwk);
        this.userPrivateKey = await window.crypto.subtle.importKey(
          'jwk',
          jwk,
          {
            name: 'ECDH',
            namedCurve: 'P-256'
          },
          true,
          ['deriveKey', 'deriveBits']
        );
        console.log('[AuthService] Private key successfully restored from sessionStorage.');
      } catch (e) {
        console.error('[AuthService] Failed to restore private key from session storage', e);
      }
    } else {
      console.warn('[AuthService] No private key found in sessionStorage.');
    }
  }

  login(username: string, password: string): Observable<AuthResponse> {
    // 1. Derive the PBKDF2 key from password
    return from(this.cryptoService.deriveKeyFromPassword(password, username)).pipe(
      switchMap(passwordKey => {
        // 2. Perform HTTP login
        return this.http.post<AuthResponse>(`${this.apiUrl}/login`, { username, password }).pipe(
          switchMap(async response => {
            if (response.token && response.encryptedPrivateKey) {
              // 3. Decrypt private key on the fly and cache it in memory
              this.userPrivateKey = await this.cryptoService.decryptPrivateKey(
                response.encryptedPrivateKey,
                passwordKey
              );
              // Save decrypted private key in sessionStorage for refresh persistence
              const jwk = await window.crypto.subtle.exportKey('jwk', this.userPrivateKey);
              sessionStorage.setItem('chat_private_key', JSON.stringify(jwk));

              localStorage.setItem('chat_token', response.token);
              localStorage.setItem('chat_username', response.username);
              this.loggedInUser.next(response.username);
            }
            return response;
          })
        );
      })
    );
  }

  register(username: string, password: string): Observable<AuthResponse> {
    // 1. Generate keys and encrypt private key first
    return from(this.cryptoService.deriveKeyFromPassword(password, username)).pipe(
      switchMap(async passwordKey => {
        const keyPair = await this.cryptoService.generateECDHKeys();
        
        // Export public key to JWK JSON string
        const jwkPublic = await window.crypto.subtle.exportKey('jwk', keyPair.publicKey);
        const publicKeyStr = JSON.stringify(jwkPublic);
        
        // Encrypt private key with the password key
        const encryptedPrivateKeyStr = await this.cryptoService.encryptPrivateKey(
          keyPair.privateKey,
          passwordKey
        );
        
        return { publicKeyStr, encryptedPrivateKeyStr };
      }),
      switchMap(keys => {
        // 2. Perform HTTP registration with keys attached
        return this.http.post<AuthResponse>(`${this.apiUrl}/register`, {
          username,
          password,
          publicKey: keys.publicKeyStr,
          encryptedPrivateKey: keys.encryptedPrivateKeyStr
        });
      })
    );
  }

  logout(): void {
    localStorage.removeItem('chat_token');
    localStorage.removeItem('chat_username');
    sessionStorage.removeItem('chat_private_key');
    this.userPrivateKey = null;
    this.loggedInUser.next(null);
  }

  getToken(): string | null {
    return localStorage.getItem('chat_token');
  }

  getUsername(): string | null {
    return localStorage.getItem('chat_username');
  }

  getPrivateKey(): CryptoKey | null {
    return this.userPrivateKey;
  }

  isLoggedIn(): boolean {
    const hasToken = !!this.getToken();
    const hasPrivateKey = !!this.getPrivateKey() || !!sessionStorage.getItem('chat_private_key');
    const logged = hasToken && hasPrivateKey;
    console.log('[AuthService] isLoggedIn check:', { hasToken, hasPrivateKey, logged });
    if (!logged && hasToken) {
      console.warn('[AuthService] User is logged out because private key or token is missing, clearing storage...');
      this.logout();
    }
    return logged;
  }

  get currentUser$() {
    return this.loggedInUser.asObservable();
  }
}

