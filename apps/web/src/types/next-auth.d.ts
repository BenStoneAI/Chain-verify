import type { DefaultSession } from 'next-auth';
import 'next-auth';

declare module 'next-auth' {
  interface Session {
    accessToken?: string;
    user: DefaultSession['user'] & {
      id?: string;
    };
  }
}
