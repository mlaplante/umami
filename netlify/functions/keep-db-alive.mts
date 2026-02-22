import type { Config } from '@netlify/functions';
import pg from 'pg';

export default async (req: Request) => {
  const { next_run } = await req.json();

  const client = new pg.Client({
    connectionString: Netlify.env.get('DATABASE_URL'),
  });

  try {
    await client.connect();
    await client.query('SELECT 1');
    console.log(`Keep-alive ping successful. Next run: ${next_run}`);
  } catch (error) {
    console.error('Keep-alive ping failed:', error);
  } finally {
    await client.end();
  }
};

export const config: Config = {
  // Run every 5 days to stay well within Supabase's 7-day inactivity pause threshold
  schedule: '0 0 */5 * *',
};
