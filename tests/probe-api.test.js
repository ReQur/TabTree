// The statuses probe in the background (probe/background.js): it asks a site's API with the session, answers
// with the checks, and keeps them for the report.
import { check, wait, done } from './helpers/check.js';
import { makeOpera } from './helpers/opera-fake.js';

const asked = [];
globalThis.fetch = async (url, init) => {
  asked.push({ url, init });
  return { type: 'basic', status: 200, headers: { get: () => 'application/json' }, json: async () => ({ id: 7, username: 'someone' }) };
};
const o = makeOpera({ tabs: [], local: { folders: {}, parents: {} } });
await import('../probe/background.js');
await wait(300);

const site = { kind: 'gitlab', origin: 'https://gitlab.example.com', base: 'https://gitlab.example.com', keys: [], mrs: [], pipelines: [], jobs: [], builds: [] };
const reply = await o.ask({ type: 'probeApi', site });
check(`the background asks the site and answers with the checks: ${JSON.stringify(reply.results)}`, reply.ok && reply.results?.length === 1 && reply.results[0].ok && reply.results[0].text === 'yes');
check('with the browser session', asked[0]?.url === 'https://gitlab.example.com/api/v4/user' && asked[0].init.credentials === 'include');
await wait(100);
check('and keeps the answer for the report', o.local.apiProbe?.['https://gitlab.example.com']?.results?.[0]?.name === 'Signed in' && o.local.apiProbe['https://gitlab.example.com'].kind === 'gitlab');
const odd = await o.ask({ type: 'probeApi', site: { kind: 'ftp', base: 'ftp://files.example.com' } });
check(`nothing but a Jira, GitLab or Jenkins site: ${odd.error}`, odd.ok === false && asked.length === 1);
done();
