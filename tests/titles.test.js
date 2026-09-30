// Ticket keys, title cleanup and row labels (probe/titles.js).
import { check, done } from './helpers/check.js';
import { ticketKey, cleanTitle, kindLabel, pageKind, rowLabel, groupTitle, islandName, colorFor, pageIdentity, tabToReuse } from '../probe/titles.js';

const J = 'https://jira.example.com/browse/';
const G = 'https://gitlab.example.com/group/app/-/merge_requests/';
const jira = { title: '[PROJ-7] Rate limiter for the public API - Jira', url: J + 'PROJ-7' };
const mr = { title: 'Draft: PROJ-7: Rate limiter for the public API (!42) · Merge requests · group / app · GitLab', url: G + '42' };

check('key from the title', ticketKey(jira) === 'PROJ-7' && ticketKey(mr) === 'PROJ-7');
check('key from the URL path of a loading tab', ticketKey({ title: '', pendingUrl: J + 'PROJ-9' }) === 'PROJ-9');
check('a board with ?selectedIssue= is not that issue', ticketKey({ title: 'Team board - Jira', url: 'https://jira.example.com/secure/RapidBoard.jspa?selectedIssue=PROJ-1' }) === null);
check('UTF-8, CVE-2024 and the like are not keys', ticketKey({ title: 'Fix UTF-8 handling, see CVE-2024-3094', url: 'https://example.com/' }) === null);

check('Jira suffix and key are cut', cleanTitle(jira, 'PROJ-7').text === 'Rate limiter for the public API');
const cleanMr = cleanTitle(mr, 'PROJ-7');
check('GitLab tail cut, Draft: noticed', cleanMr.text === 'Rate limiter for the public API (!42)' && cleanMr.draft);
check('Grafana and Jenkins suffixes cut', cleanTitle({ title: 'Checkout latency - Dashboards - Grafana' }).text === 'Checkout latency'
  && cleanTitle({ title: 'nightly-build [Jenkins]' }).text === 'nightly-build');

check('page kinds', kindLabel(G + '42') === 'MR !42' && kindLabel(G + '42/diffs') === 'MR !42 · changes'
  && kindLabel('https://gitlab.example.com/group/app/-/pipelines/900') === 'pipeline #900'
  && kindLabel('https://gitlab.example.com/group/app/-/jobs/31') === 'job #31'
  && kindLabel('https://ci.example.com/job/nightly/128/') === 'build #128'
  && kindLabel(J + 'PROJ-7') === 'Jira');
const changes = pageKind(G + '42/diffs');
check('a page kind comes in parts, for the icon and the number', changes.type === 'mr' && changes.number === '!42' && changes.view === 'changes'
  && pageKind('https://ci.example.com/job/nightly/128/').type === 'build' && pageKind('https://example.com/') === null);

const header = groupTitle([mr, jira], 'PROJ-7');
check('a ticket is titled by its Jira page', header === 'Rate limiter for the public API');
const label = rowLabel(mr, 'PROJ-7', header);
check('a ticket page repeating the ticket title shows its kind', label.text === 'MR !42' && label.asKind && label.kind === null && label.draft);
const own = rowLabel({ title: 'PROJ-7: Other work (!43) · Merge requests · group / app · GitLab', url: G + '43' }, 'PROJ-7', header);
check('a ticket page with a title of its own keeps it, with the kind beside it', own.text === 'Other work' && !own.asKind && own.kind.number === '!43');
check('outside a ticket the Jira kind is left to the favicon', rowLabel(jira, 'PROJ-7', null).kind === null);

check('island names are shortened', islandName('PROJ-7', 'A very long summary that keeps going and going forever') === 'PROJ-7 A very long summary that keeps going and…');
check('a key always gets the same color', colorFor('PROJ-7') === colorFor('PROJ-7'));

const MR = 'https://gitlab.example.com/group/app/-/merge_requests/560';
check(`the same merge request, whatever part of it is in view: ${pageIdentity(`${MR}/diffs#note_1`)}`,
  pageIdentity(`${MR}/diffs#note_1`) === MR && pageIdentity(MR) === MR && pageIdentity(`${MR}/pipelines`) === MR);
check('a Jira issue, whatever its query; a Jenkins build, whatever its part; any other page by its address',
  pageIdentity('https://jira.example.com/browse/PROJ-1?focusedCommentId=9') === 'https://jira.example.com/browse/PROJ-1'
  && pageIdentity('https://ci.example.com/job/app/job/main/128/console') === 'https://ci.example.com/job/app/job/main/128/'
  && pageIdentity('https://example.com/a?b=1#c') === 'https://example.com/a?b=1');
const open = [
  { id: 1, url: `${MR}/diffs`, lastAccessed: 50 },
  { id: 2, url: MR, lastAccessed: 10 },
  { id: 3, url: `${MR}/commits`, lastAccessed: 90 },
  { id: 4, url: 'https://example.com/a', lastAccessed: 5, incognito: true },
  { id: 9, url: `${MR}#note_3`, lastAccessed: 99 },
];
check(`a tab at the same address comes first: #${tabToReuse(`${MR}#note_7`, open, 9)?.id}`, tabToReuse(`${MR}#note_7`, open, 9)?.id === 2);
check(`else the most recently used tab of the same page: #${tabToReuse(`${MR}/pipelines`, open, 9)?.id}`, tabToReuse(`${MR}/pipelines`, open, 9)?.id === 3);
check('never the new tab itself, nor an incognito one', tabToReuse('https://example.com/a', open, 9) === null && tabToReuse(`${MR}/diffs`, [open[4]], 9) === null);
done();
