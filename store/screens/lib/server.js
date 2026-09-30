// The fake sites behind the sample tabs, on one local port: Chrome maps *.example.com here
// (--host-resolver-rules). Pages are tiny HTML documents with the sample titles and a data: favicon; the APIs answer
// in the shapes probe/integrations.js reads (Jira REST v3, GitLab API v4, Jenkins' JSON API).
import http from 'node:http';
import { TABS, FAVICONS, jiraIssues, gitlab, jenkins } from './sample.js';

const json = (res, body, status = 200) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function page(res, tab) {
  const icon = `data:image/svg+xml;base64,${Buffer.from(FAVICONS[tab.icon]).toString('base64')}`;
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(tab.title)}</title>
<link rel="icon" href="${icon}"></head><body style="font:16px system-ui;margin:40px"><h1>${esc(tab.title)}</h1>
<p>Sample page for the Branchy screenshots.</p></body></html>`);
}

export function startServer({ log = false } = {}) {
  const t0 = Date.now();
  const jira = jiraIssues(t0);
  const gl = gitlab(t0);
  const ci = jenkins(t0);
  const requests = [];

  const server = http.createServer((req, res) => {
    const host = (req.headers.host || '').split(':')[0];
    const url = new URL(req.url, `http://${host}`);
    const path = url.pathname;
    requests.push(`${req.method} ${host}${req.url}`);
    if (log) console.log(`  ${req.method} ${host}${req.url}`);

    // Jira
    if (host === 'jira.example.com' && path === '/rest/api/3/myself') return json(res, jira.me);
    if (host === 'jira.example.com' && path === '/rest/api/3/issue/bulkfetch' && req.method === 'POST') {
      let body = '';
      req.on('data', c => (body += c));
      req.on('end', () => {
        const keys = JSON.parse(body || '{}').issueIdsOrKeys ?? [];
        json(res, { issues: jira.issues.filter(i => keys.includes(i.key)), issueErrors: [] });
      });
      return;
    }
    if (host === 'jira.example.com' && path.startsWith('/rest/api/3/issue/')) {
      const key = path.split('/')[5];
      const issue = jira.issues.find(i => i.key === key);
      return issue ? json(res, issue) : json(res, { errorMessages: ['Issue does not exist'] }, 404);
    }

    // GitLab
    if (host === 'gitlab.example.com' && path.startsWith('/api/v4/')) {
      if (path === '/api/v4/user') return json(res, gl.user);
      // Node keeps %2F in req.url, so the project path is one segment here.
      const m = req.url.match(/^\/api\/v4\/projects\/([^/]+)\/(merge_requests|pipelines|jobs)\/(\d+)(\/approvals|\/jobs)?/);
      if (m) {
        const project = decodeURIComponent(m[1]);
        const [, , kind, id, tail] = m;
        if (kind === 'merge_requests') {
          const mr = gl.mrs.find(x => x.project === project && x.iid === Number(id));
          if (!mr) return json(res, { message: '404 Not found' }, 404);
          if (tail === '/approvals') return json(res, mr.approvals ?? { approved: false, approvals_left: 0, approved_by: [] });
          return json(res, mr.json);
        }
        if (kind === 'pipelines') {
          const p = gl.pipelines[id];
          if (!p) return json(res, { message: '404 Not found' }, 404);
          return json(res, tail === '/jobs' ? p.jobs : p.pipeline);
        }
      }
      return json(res, { message: '404 Not found' }, 404);
    }

    // Jenkins
    if (host === 'ci.example.com') {
      const m = path.match(/^\/job\/([^/]+)\/(?:(\d+)\/)?api\/json$/);
      if (m) {
        const job = ci[m[1]];
        if (!job) return json(res, {}, 404);
        if (m[2]) {
          const b = job.builds.find(x => x.number === Number(m[2]));
          return b ? json(res, b) : json(res, {}, 404);
        }
        return json(res, job);
      }
      if (path === '/whoAmI/api/json') return json(res, { anonymous: false, name: 'alex' });
    }

    // Pages
    if (path === '/favicon.ico') {
      res.writeHead(404);
      return res.end();
    }
    const tab = TABS.find(t => {
      const u = new URL(t.url);
      return u.host === host && u.pathname === path;
    });
    if (tab) return page(res, tab);
    res.writeHead(404, { 'content-type': 'text/html' });
    res.end(`<!doctype html><title>Not found</title><p>${esc(host + path)}`);
  });

  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, close: () => server.close(), requests, t0 }));
  });
}
