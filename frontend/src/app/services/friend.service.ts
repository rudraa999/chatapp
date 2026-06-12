import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { UserSearchResponse, PendingRequest } from '../models/chat.model';

@Injectable({
  providedIn: 'root'
})
export class FriendService {
  private getApiUrl(): string {
    const base = (window.location.hostname === 'localhost' && window.location.port === '4200')
      ? 'http://localhost:8080'
      : window.location.origin;
    return base + '/api';
  }
  private apiUrl = this.getApiUrl();

  constructor(private http: HttpClient) {}

  searchUsers(username: string): Observable<UserSearchResponse[]> {
    return this.http.get<UserSearchResponse[]>(`${this.apiUrl}/users/search`, {
      params: { username }
    });
  }

  sendFriendRequest(receiver: string): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/friends/request`, null, {
      params: { receiver }
    });
  }

  getPendingRequests(): Observable<PendingRequest[]> {
    return this.http.get<PendingRequest[]>(`${this.apiUrl}/friends/pending`);
  }

  acceptFriendRequest(requestId: number): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/friends/accept/${requestId}`, null);
  }

  declineFriendRequest(requestId: number): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/friends/decline/${requestId}`, null);
  }

  getFriendsList(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/friends/list`);
  }
}
