import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getVercelApp } from '../server.ts';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default function handler(req: VercelRequest, res: VercelResponse) {
  const app = getVercelApp();
  return app(req as unknown as Parameters<typeof app>[0], res as unknown as Parameters<typeof app>[1]);
}
