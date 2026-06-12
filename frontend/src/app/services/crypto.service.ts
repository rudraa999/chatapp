import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class CryptoService {

  // Derive an AES-GCM 256-bit key from username + password deterministically
  async deriveKeyFromPassword(password: string, username: string): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const passwordBytes = encoder.encode(password);
    // Use a static, user-specific salt for deterministic derivation across devices
    const salt = encoder.encode(username.toLowerCase() + '_uchat_salt_v1');
    
    const keyMaterial = await window.crypto.subtle.importKey(
      'raw',
      passwordBytes,
      'PBKDF2',
      false,
      ['deriveKey']
    );
    
    return window.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  // Generate ECDH P-256 Key Pair
  async generateECDHKeys(): Promise<CryptoKeyPair> {
    return window.crypto.subtle.generateKey(
      {
        name: 'ECDH',
        namedCurve: 'P-256'
      },
      true, // extractable
      ['deriveKey', 'deriveBits']
    );
  }

  // Encrypt the ECDH private key using the password key
  async encryptPrivateKey(privateKey: CryptoKey, passwordKey: CryptoKey): Promise<string> {
    const jwk = await window.crypto.subtle.exportKey('jwk', privateKey);
    const jwkString = JSON.stringify(jwk);
    const encoder = new TextEncoder();
    const data = encoder.encode(jwkString);
    
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      passwordKey,
      data
    );
    
    const payload = {
      iv: this.bufToBase64(iv),
      ciphertext: this.bufToBase64(new Uint8Array(ciphertext))
    };
    return JSON.stringify(payload);
  }

  // Decrypt the ECDH private key using the password key
  async decryptPrivateKey(encryptedPayloadStr: string, passwordKey: CryptoKey): Promise<CryptoKey> {
    const payload = JSON.parse(encryptedPayloadStr);
    const iv = this.base64ToBuf(payload.iv);
    const ciphertext = this.base64ToBuf(payload.ciphertext);
    
    const decrypted = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      passwordKey,
      ciphertext
    );
    
    const jwkString = new TextDecoder().decode(decrypted);
    const jwk = JSON.parse(jwkString);
    
    return window.crypto.subtle.importKey(
      'jwk',
      jwk,
      {
        name: 'ECDH',
        namedCurve: 'P-256'
      },
      true,
      ['deriveKey', 'deriveBits']
    );
  }

  // Derive shared 256-bit AES symmetric key from my private key and friend's public key
  async deriveSharedSecret(myPrivateKey: CryptoKey, friendPublicKeyJwkStr: string): Promise<CryptoKey> {
    const jwk = JSON.parse(friendPublicKeyJwkStr);
    const friendPublicKey = await window.crypto.subtle.importKey(
      'jwk',
      jwk,
      {
        name: 'ECDH',
        namedCurve: 'P-256'
      },
      true,
      []
    );
    
    return window.crypto.subtle.deriveKey(
      {
        name: 'ECDH',
        public: friendPublicKey
      },
      myPrivateKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  // Encrypt string content with AES shared key
  async encryptMessage(text: string, sharedKey: CryptoKey): Promise<{ ciphertext: string, iv: string }> {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    
    const ciphertext = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      sharedKey,
      data
    );
    
    return {
      ciphertext: this.bufToBase64(new Uint8Array(ciphertext)),
      iv: this.bufToBase64(iv)
    };
  }

  // Decrypt content with AES shared key
  async decryptMessage(ciphertextBase64: string, ivBase64: string, sharedKey: CryptoKey): Promise<string> {
    const ciphertext = this.base64ToBuf(ciphertextBase64);
    const iv = this.base64ToBuf(ivBase64);
    
    const decrypted = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      sharedKey,
      ciphertext
    );
    
    return new TextDecoder().decode(decrypted);
  }

  // Encrypt raw ArrayBuffer with AES shared key
  async encryptFile(fileBytes: ArrayBuffer, sharedKey: CryptoKey): Promise<{ ciphertext: ArrayBuffer, iv: Uint8Array }> {
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      sharedKey,
      fileBytes
    );
    return {
      ciphertext: ciphertext,
      iv: iv
    };
  }

  // Decrypt raw ArrayBuffer with AES shared key
  async decryptFile(ciphertext: ArrayBuffer, iv: Uint8Array, sharedKey: CryptoKey): Promise<ArrayBuffer> {
    return window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      sharedKey,
      ciphertext
    );
  }

  // Helpers: buffer <-> base64 conversion
  private bufToBase64(buf: Uint8Array): string {
    let binary = '';
    const len = buf.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(buf[i]);
    }
    return btoa(binary);
  }

  private base64ToBuf(b64: string): Uint8Array {
    const binary = atob(b64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
}

