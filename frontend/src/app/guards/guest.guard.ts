import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const guestGuard: CanActivateFn = async (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  console.log('[GuestGuard] Awaiting AuthService initialization...');
  await authService.waitForInit();
  console.log('[GuestGuard] AuthService initialized.');

  if (authService.isLoggedIn()) {
    console.log('[GuestGuard] User already logged in. Redirecting to chat.');
    router.navigate(['/chat'], { replaceUrl: true });
    return false;
  }

  return true;
};
