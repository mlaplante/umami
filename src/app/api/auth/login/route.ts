import { z } from 'zod';
import { saveAuth } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { secret } from '@/lib/crypto';
import { createSecureToken } from '@/lib/jwt';
import { checkPassword } from '@/lib/password';
import redis from '@/lib/redis';
import { parseRequest } from '@/lib/request';
import { json, serverError, unauthorized } from '@/lib/response';
import { getAllUserTeams, getUserByUsername } from '@/queries/prisma';

export async function POST(request: Request) {
  try {
    const schema = z.object({
      username: z.string(),
      password: z.string(),
    });

    const { body, error } = await parseRequest(request, schema, { skipAuth: true });

    if (error) {
      return error();
    }

    const { username, password } = body;

    const user = await getUserByUsername(username, { includePassword: true });

    if (!user || !checkPassword(password, user.password)) {
      return unauthorized({ code: 'incorrect-username-password' });
    }

    const { id, role, createdAt } = user;

    let token: string;

    if (redis.enabled) {
      token = await saveAuth({ userId: id, role });
    } else {
      token = createSecureToken({ userId: user.id, role }, secret());
    }

    const teams = await getAllUserTeams(id);

    return json({
      token,
      user: { id, username, role, createdAt, isAdmin: role === ROLES.admin, teams },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Login error:', message);

    if (message.includes('Tenant or user not found') || message.includes('row-level security')) {
      return serverError({
        message:
          'Database access error - RLS policies may be blocking queries. Disable RLS in Supabase settings.',
        code: 'database-access-error',
      });
    }

    return serverError({
      message: 'Login failed due to database error',
      code: 'login-error',
    });
  }
}
