import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = async (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  console.log('[AuthGuard] Awaiting AuthService initialization...');
  await authService.waitForInit();
  console.log('[AuthGuard] AuthService initialized.');

  if (authService.isLoggedIn()) {
    return true;
  }

  console.warn('[AuthGuard] Access denied. Redirecting to login.');
  router.navigate(['/login']);
  return false;
};
