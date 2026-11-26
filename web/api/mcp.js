import { onRequest } from '../functions/mcp.js';

const env = {
  ASSETS: {
    fetch: (req) => fetch(req),
  },
};

export async function GET(request) {
  return onRequest({ request, env });
}

export async function POST(request) {
  return onRequest({ request, env });
}

export async function OPTIONS(request) {
  return onRequest({ request, env });
}
