// Password gate for the internal dashboard. Set DASH_PASSWORD in Vercel (user: any name).
export const config = { matcher: ['/painel', '/painel.html', '/api/dash-data', '/private/:path*'] };

export default function middleware(request) {
  const url = new URL(request.url);
  if (url.pathname.startsWith('/private/')) return new Response('Not found', { status: 404 });
  const pass = process.env.DASH_PASSWORD;
  if (!pass) return new Response('Dashboard password not configured', { status: 503 });
  const h = request.headers.get('authorization') || '';
  if (h.startsWith('Basic ')) {
    let decoded = '';
    try { decoded = atob(h.slice(6)); } catch (e) {}
    const given = decoded.slice(decoded.indexOf(':') + 1);
    if (given === pass) return;
  }
  return new Response('Login required', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="Maxzz dashboard", charset="UTF-8"', 'Cache-Control': 'no-store' } });
}
