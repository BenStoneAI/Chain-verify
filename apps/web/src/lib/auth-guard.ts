import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { getServerApiBase } from '@/lib/server-api';

export interface AuthUser {
    id: string;
    email: string | null;
    displayName: string;
}

async function getNextAuthSession() {
    try {
        const [{ getServerSession }, { authOptions }] = await Promise.all([
            import('next-auth'),
            import('@/lib/auth-options'),
        ]);
        return await getServerSession(authOptions);
    } catch (error) {
        // Log the actual error — getServerSession can fail silently when Prisma
        // cannot connect to the database (e.g. DATABASE_URL not set in Netlify
        // runtime env, password changed, or connection pool exhausted).
        // Without this catch, the caller sees null and redirects to /login,
        // creating an invisible auth loop.
        console.error('[auth-guard] getServerSession failed:', error);
        return null;
    }
}

function getApiBaseUrl(): string {
    return getServerApiBase();
}

export async function exchangeSessionForApiToken(user: AuthUser | null): Promise<string | null> {
    const cookieStore = await cookies();
    const nextAuthSessionToken =
        cookieStore.get('__Secure-next-auth.session-token')?.value ||
        cookieStore.get('next-auth.session-token')?.value ||
        '';

    const secrets = [
        process.env.WEB_INTERNAL_AUTH_SECRET,
        process.env.JWT_SECRET,
        process.env.NEXTAUTH_SECRET,
    ].filter((v): v is string => Boolean(v));

    const attempts: Array<{ sharedSecret?: string; sessionToken?: string }> = [
        ...(nextAuthSessionToken ? [{ sessionToken: nextAuthSessionToken }] : []),
        ...secrets.map((sharedSecret) => ({ sharedSecret })),
    ];

    if (attempts.length === 0) {
        return null;
    }

    const apiBase = getApiBaseUrl();
    for (const attempt of attempts) {
        const exchange = await fetch(`${apiBase}/auth/session/exchange`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                // Server-side fetches have no Origin header — API CORS rejects them.
                'Origin': process.env.NEXTAUTH_URL || 'https://swarmsync.ai',
                ...(attempt.sharedSecret ? { 'x-web-shared-secret': attempt.sharedSecret } : {}),
                ...(attempt.sessionToken ? { 'x-nextauth-session-token': attempt.sessionToken } : {}),
            },
            body: JSON.stringify({
                email: user?.email,
                displayName: user?.displayName,
            }),
            cache: 'no-store',
        });

        if (!exchange.ok) {
            continue;
        }

        const payload = await exchange.json().catch(() => null);
        if (payload?.accessToken) {
            return payload.accessToken as string;
        }
    }

    return null;
}

export async function getServerAuthToken(): Promise<string | null> {
    const cookieStore = await cookies();
    const jwtToken = cookieStore.get('auth_token')?.value;
    if (jwtToken) {
        return jwtToken;
    }

    const session = await getNextAuthSession();
    const sessionUser = session?.user
        ? {
            id: session.user.id || session.user.email || '',
            email: session.user.email ?? null,
            displayName: session.user.name || session.user.email || 'User',
        }
        : null;

    if (!sessionUser?.id) {
        return null;
    }

    return exchangeSessionForApiToken(sessionUser);
}

export async function requireAdmin(redirectTo = '/console/admin') {
    const authToken = await requireAuth(redirectTo);
    const user = await getCurrentUser();

    if (authToken === 'nextauth') {
        const token = await exchangeSessionForApiToken(user);
        if (!token) {
            redirect('/console/overview?error=admin_required');
        }

        const apiBase = getApiBaseUrl();
        const accessRes = await fetch(`${apiBase}/admin/access`, {
            headers: {
                Authorization: `Bearer ${token}`,
                'Origin': process.env.NEXTAUTH_URL || 'https://swarmsync.ai',
            },
            cache: 'no-store',
        });

        if (!accessRes.ok) {
            redirect('/console/overview?error=admin_required');
        }
        return user;
    }

    const apiBase = getApiBaseUrl();
    const accessRes = await fetch(`${apiBase}/admin/access`, {
        headers: {
            Authorization: `Bearer ${authToken}`,
            'Origin': process.env.NEXTAUTH_URL || 'https://swarmsync.ai',
        },
        cache: 'no-store',
    });

    if (!accessRes.ok) {
        redirect('/console/overview?error=admin_required');
    }

    return user;
}

/**
 * Server-side authentication guard
 * Checks both JWT token (email/password) and NextAuth (OAuth) authentication
 * Redirects to login if not authenticated
 */
export async function requireAuth(redirectTo?: string) {
    // First check JWT token cookie (email/password auth)
    const cookieStore = await cookies();
    const jwtToken = await getServerAuthToken();

    if (jwtToken) {
        return jwtToken;
    }

    // Check NextAuth session (OAuth - Google/GitHub)
    // Also check for the NextAuth session cookie to detect edge cases where
    // the cookie is present but getServerSession fails (DB connection issue).
    const hasSessionCookie = Boolean(
        cookieStore.get('__Secure-next-auth.session-token')?.value ||
        cookieStore.get('next-auth.session-token')?.value,
    );

    const session = await getNextAuthSession();
    if (session) {
        return 'nextauth';
    }

    // If the NextAuth session cookie exists but getServerSession returned null,
    // the database session lookup likely failed (Prisma connection error, expired
    // session, or DATABASE_URL misconfiguration on the hosting platform).
    // Redirect to an error page instead of /login to break the redirect loop and
    // give the user actionable feedback.
    if (hasSessionCookie) {
        console.error(
            '[auth-guard] NextAuth session cookie present but getServerSession returned null. ' +
            'Likely cause: DATABASE_URL not set in Netlify runtime env, Supabase DB password changed, ' +
            'or Prisma client cannot reach the database.',
        );
        redirect('/auth/error?message=Session+verification+failed.+Please+clear+your+cookies+and+sign+in+again.+If+this+persists,+contact+support.');
    }

    // Not authenticated by either method
    const loginUrl = redirectTo ? `/login?callbackUrl=${encodeURIComponent(redirectTo)}` : '/login';
    redirect(loginUrl);
}

/**
 * Check if user is authenticated without redirecting
 * Checks both JWT and NextAuth authentication
 */
export async function isAuthenticated(): Promise<boolean> {
    const jwtToken = await getServerAuthToken();

    if (jwtToken) {
        return true;
    }

    const session = await getNextAuthSession();
    return Boolean(session);
}

/**
 * Get current authenticated user
 * Checks both JWT token and NextAuth session
 * Returns null if not authenticated or token is invalid
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
    const jwtToken = await getServerAuthToken();

    // First try JWT token (email/password auth)
    if (jwtToken) {
        try {
            const parts = jwtToken.split('.');
            if (parts.length === 3) {
                // Use atob for edge runtime compatibility
                const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
                const jsonPayload = decodeURIComponent(
                    atob(base64)
                        .split('')
                        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
                        .join('')
                );
                const payload = JSON.parse(jsonPayload);
                return {
                    id: payload.sub || payload.id,
                    email: payload.email,
                    displayName: payload.displayName || payload.name || payload.email?.split('@')[0] || '',
                };
            }
        } catch (error) {
            console.error('Failed to decode JWT token:', error);
        }
    }

    // Try NextAuth session (OAuth)
    const session = await getNextAuthSession();
    if (session?.user?.email) {
        return {
            id: session.user.id || session.user.email,
            email: session.user.email,
            displayName: session.user.name || session.user.email,
        };
    }

    return null;
}
