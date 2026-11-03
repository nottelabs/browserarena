"use client";

import { useState } from "react";
import { Download, ExternalLink, Play, ArrowDown } from "lucide-react";
import { providerScores, type AccessReport, type AccessVisit, type Outcome } from "../../../src/benchmarks/website-access/schema";
import styles from "./results.module.css";

const labels: Record<Outcome, string> = { accessible: "Accessible", bot_block: "Bot block", login_wall: "Login wall", uncertain: "Uncertain", site_error: "Site error", network_error: "Network error", capture_error: "Capture error" };
function Replay({ visit, date, published }: { visit: AccessVisit; date: string; published: boolean }) {
  const [playing, setPlaying] = useState(false), [failed, setFailed] = useState(false);
  if (!visit.replay) return <p className={styles.muted}>No replay captured for this visit.</p>;
  const provenance = visit.replay?.kind === "original" ? "Original scored recording" : "Recorded follow-up, excluded from scores";
  return <div className={styles.replay}>
    <p id={`provenance-${visit.id}`}><strong>{provenance}</strong> · {Math.round(visit.replay.durationSeconds)}s</p>
    {playing && !failed ? <video controls autoPlay preload="metadata" aria-label={`${visit.provider} round ${visit.round}: ${provenance}`} aria-describedby={`provenance-${visit.id}`} src={`/website-access/evidence/${date}/${visit.replay.file}`} onError={() => setFailed(true)} /> : published && !failed ?
      <button type="button" onClick={() => setPlaying(true)}><Play size={14} aria-hidden="true" /> Play replay</button> :
      <p className={styles.muted}>{failed ? "Replay could not load. The original screenshot is available above." : "Replay archived; video hosting is not configured for this deployment."}</p>}
  </div>;
}
export function AccessResults({ report, mediaPublished }: { report: AccessReport; mediaPublished: boolean }) {
  const [siteId, setSiteId] = useState("s10"), [round, setRound] = useState(1), [query, setQuery] = useState("");
  const scores = providerScores(report), site = report.sites.find(s => s.id === siteId)!;
  const visible = report.sites.filter(s => s.domain.toLowerCase().includes(query.toLowerCase()));
  const followups = report.visits.filter(v => v.replay?.kind === "followup").length;
  const missing = report.visits.filter(v => !v.replay).length;
  const originals = report.visits.filter(v => v.replay?.kind === "original").length;
  function inspect(id: string) { setSiteId(id); const evidence = document.getElementById("visit-evidence"); evidence?.focus({ preventScroll: true }); evidence?.scrollIntoView({ block: "start" }); }
  return <div className={styles.report}>
    <header className={styles.header}>
      <div><h1>Website access</h1><p>Can a managed browser reach usable content on a difficult website?</p><p className={styles.muted}>20 selected sites · 5 providers · 3 fresh visits each · October 28, 2026</p></div>
      <a className={styles.download} href="/website-access/export"><Download size={15} aria-hidden="true" /> Download results</a>
    </header>
    <div className={styles.context}>
      <p><strong>Exploratory comparison.</strong> These sites were selected for difficulty. Results describe this run, not general-web coverage or a replication of the published 725-URL claim.</p>
      <a href="#methodology">Read the method <ArrowDown size={13} aria-hidden="true" /></a>
    </div>
    <section aria-labelledby="comparison-title">
      <div className={styles.sectionHeading}><div><h2 id="comparison-title">The same sites, five browsers</h2><p>Each cell counts accessible visits out of three. Select a site to inspect the original evidence.</p></div><label>Find a website<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search domains" /></label></div>
      <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Website access comparison; scroll horizontally on smaller screens">
        <table className={styles.matrix}>
          <caption className={styles.srOnly}>Accessible visits by website and provider, October 28, 2026. All 300 planned visits remain in the denominator.</caption>
          <thead><tr><th scope="col">Website</th>{scores.map(p => <th scope="col" key={p.id}>{p.name}<span>{p.accessible}/{p.planned} visits · {(100 * p.accessible / p.planned).toFixed(1)}%</span><small>{p.sitesAccessible}/{p.totalSites} sites reached at least once</small></th>)}</tr></thead>
          <tbody>{visible.map(s => <tr key={s.id} data-selected={s.id === siteId || undefined}>
            <th scope="row"><button type="button" aria-controls="visit-evidence" onClick={() => inspect(s.id)}>{s.domain}</button></th>
            {scores.map(p => { const visits = report.visits.filter(v => v.site === s.id && v.provider === p.id).sort((a,b) => a.round-b.round); const count = visits.filter(v => v.outcome === "accessible").length;
              return <td key={p.id}><button type="button" aria-controls="visit-evidence" onClick={() => inspect(s.id)} aria-label={`${s.domain}, ${p.name}: ${count} of ${report.rounds} accessible. ${visits.map(v => `Round ${v.round}: ${labels[v.outcome]}`).join('. ')}`}><strong>{count}<span> / {report.rounds}</span></strong><span className={styles.roundMarks} aria-hidden="true">{visits.map(v => <span key={v.round} data-outcome={v.outcome}>{v.outcome === "accessible" ? "A" : v.outcome === "uncertain" ? "?" : v.outcome === "login_wall" ? "L" : v.outcome === "bot_block" ? "B" : "E"}</span>)}</span></button></td>;
            })}
          </tr>)}</tbody>
        </table>
      </div>
      {visible.length === 0 && <p role="status" className={styles.empty}>No websites match “{query}”. <button onClick={() => setQuery("")}>Clear search</button></p>}
      <p className={styles.legend}>A = accessible · B = blocked · L = login wall · ? = uncertain · E = error. Uncertain and login-wall visits do not count as accessible.</p>
    </section>
    <section tabIndex={-1} id="visit-evidence" className={styles.evidence} aria-labelledby="evidence-title">
      <div className={styles.sectionHeading}><div><h2 id="evidence-title">Inspect a visit</h2><p>Original 60-second screenshots determine the scores. Replays have separate provenance.</p></div><div className={styles.selectors}><label>Website<select value={siteId} onChange={e => setSiteId(e.target.value)}>{report.sites.map(s => <option key={s.id} value={s.id}>{s.domain}</option>)}</select></label><fieldset><legend>Round</legend>{Array.from({length:report.rounds},(_,i)=>i+1).map(n => <button type="button" key={n} aria-pressed={round === n} onClick={() => setRound(n)}>{n}</button>)}</fieldset></div></div>
      <div className={styles.siteHeading}><h3>{site.domain}</h3><a href={site.url} target="_blank" rel="noreferrer">Benchmark URL <ExternalLink size={13} aria-hidden="true" /></a><span>{site.source}</span></div>
      <div className={styles.evidenceGrid}>{scores.map(p => {
        const visit = report.visits.find(v => v.site === siteId && v.provider === p.id && v.round === round)!;
        const screenshot = visit.screenshot ? `/website-access/${report.date}/${visit.screenshot.file}` : null;
        return <article key={visit.id} className={styles.providerEvidence} aria-label={`${p.name}, ${site.domain}, round ${round}`}>
          <header><h4>{p.name}</h4><span className={styles.outcome} data-outcome={visit.outcome}>{labels[visit.outcome]}</span></header>
          {screenshot ? <a href={screenshot} target="_blank" rel="noreferrer" className={styles.screenshotLink} aria-label={`Open original screenshot: ${p.name}, ${site.domain}, round ${round}`}><img src={screenshot} alt={`${p.name} original 60-second view of ${site.domain}: ${labels[visit.outcome]}`} width={1365} height={900} loading="lazy" /></a> : <p className={styles.empty}>No original screenshot captured. See the visit outcome below.</p>}
          <p className={styles.caption}>Original scored visit · round {round} · 60s</p><p className={styles.reason}>{visit.reason}</p>
          <Replay key={visit.id} visit={visit} date={report.date} published={mediaPublished} />
        </article>;
      })}</div>
      <p className={styles.coverage}>{originals} original recordings and {followups} separately recorded follow-ups are archived. Follow-ups are excluded from every score and cannot show what happened during an earlier visit. {missing > 0 && `${missing} visits have no replay.`}</p>
    </section>
    <section id="methodology" className={styles.method} aria-labelledby="method-title"><h2 id="method-title">What this run measures</h2>
      <div className={styles.methodGrid}><div><h3>One navigation. Sixty seconds.</h3><p>Each of the 300 planned visits used a fresh provider session and one navigation. Evidence was captured at 20 and 60 seconds. No manual challenge clicks, reloads or replacement attempts were made; provider-native challenge handling remained enabled. Providers ran independently, with at most one active session per provider and a five-second cooldown.</p><h3>Usable content is the endpoint</h3><p>A human reviewed the original screenshots and page text. A successful HTTP response, CAPTCHA token or navigation menu alone did not count. Review was not blinded to provider identity. Login walls and uncertain pages remain separate, visible outcomes.</p></div>
      <div><h3>Managed offerings, different configurations</h3><p>The runner was in US West. Browserbase used US East, a US managed proxy and standard mode; Kernel used headful stealth and its default ISP proxy. Browser Use used its v4 API and US proxy; Steel used its managed proxy. Notte used its production Chrome headless service and US proxy. Native solvers were enabled or left at provider defaults.</p><p>A 1365 × 900 viewport was requested, but observed dimensions differed, especially for Browser Use. Proxy pools, effective browser geometry, geography and provider automation were not controlled across providers. These results do not isolate fingerprint quality or establish why access differed.</p></div></div>
      <p className={styles.caution}>Three visits are a small sample. Zero successes here does not establish that a website is permanently inaccessible. This is a fixed difficult-site subset drawn from Stealth Bench v2 and the Web Data benchmark, not their full task suites. Expected-text recovery and data extraction are separate from website access.</p>
      <p><a href="/website-access/export">Download all 300 reviewed outcomes</a></p>
    </section>
  </div>;
}
