import { PROFESSIONAL_CONSOLE_CSS } from "./professionalConsoleStyles.js";

export function renderProfessionalConsole(model = {}) {
  const {
    siteOrigin = "", environment = "unknown", currentPhase = "unknown", deploymentSha = "unknown",
    latest = null, candles = [], health = null, paperAccount = null,
    baselineBench = null, hostileJudge = null, strategyFactory = null,
    championSelection = null, forwardOperation = null, liveQualification = null,
    rollingResearch = null, historicalBootstrap = null,
  } = model;

  const forward = forwardOperation?.latest_cycle || null;
  const scheduler = forwardOperation?.latest_scheduler_receipt || null;
  const epoch = rollingResearch?.latest_epoch || null;
  const bootstrap = historicalBootstrap?.progress || null;
  const price = num(latest?.close);
  const open = num(latest?.open);
  const candleMove = price !== null && open ? ((price / open) - 1) * 100 : null;
  const equity = num(paperAccount?.equity);
  const realized = num(paperAccount?.realized_pnl);
  const champion = championSelection?.champion_candidate_id || null;
  const qState = liveQualification?.state || "not_assessed";
  const qPassed = num(liveQualification?.passed_gate_count) || 0;
  const qFailed = num(liveQualification?.failed_gate_count) || 0;
  const qTotal = qPassed + qFailed || 14;
  const qProgress = Math.round((qPassed / qTotal) * 100);
  const origin = safeOrigin(siteOrigin);
  const canonicalUrl = origin ? `${origin}/` : "/";
  const socialImageUrl = origin ? `${origin}/og-image.png` : "/og-image.png";

  const candidateRows = (strategyFactory?.verdicts || []).map((entry) => {
    const reasons = Array.isArray(entry.reason_codes) ? entry.reason_codes : [];
    return `<tr>
      <td><div class="strategy-name">${esc(strategyName(entry.candidate_id))}</div><div class="strategy-id">${esc(entry.candidate_id)}</div></td>
      <td><span class="family">${esc(human(entry.family || inferFamily(entry.candidate_id)))}</span></td>
      <td>${badge(entry.verdict)}</td>
      <td class="numeric">${reasons.length}</td>
      <td><details><summary>View evidence</summary><div class="reasons">${reasons.length ? reasons.map(reason).join("") : '<span class="reason pass">All gates passed</span>'}</div></details></td>
    </tr>`;
  }).join("");

  const baselineRows = (baselineBench?.test_comparison || []).map((entry) => `<tr>
    <td><div class="strategy-name">${esc(strategyName(entry.baseline_id))}</div><div class="strategy-id">${esc(entry.baseline_id)}</div></td>
    <td class="numeric ${tone(entry.metrics?.total_return_percent)}">${pct(entry.metrics?.total_return_percent)}</td>
    <td class="numeric">${pct(entry.metrics?.max_drawdown_percent)}</td>
    <td class="numeric">${integer(entry.metrics?.trade_count)}</td>
    <td class="numeric">${integer(entry.metrics?.fill_count)}</td>
  </tr>`).join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#050a12">
<meta name="color-scheme" content="dark">
<meta name="description" content="Quant Lab autonomous paper-trading research and operations console.">
<link rel="canonical" href="${esc(canonicalUrl)}">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Quant Lab">
<meta property="og:title" content="Quant Lab — Autonomous Research Console">
<meta property="og:description" content="Autonomous paper-trading research, hostile strategy evaluation, and forward-operation evidence.">
<meta property="og:url" content="${esc(canonicalUrl)}">
<meta property="og:image" content="${esc(socialImageUrl)}">
<meta property="og:image:width" content="512">
<meta property="og:image:height" content="512">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="Quant Lab — Autonomous Research Console">
<meta name="twitter:description" content="Autonomous paper-trading research, hostile strategy evaluation, and forward-operation evidence.">
<meta name="twitter:image" content="${esc(socialImageUrl)}">
<title>Quant Lab — Autonomous Research Console</title>
<style>${PROFESSIONAL_CONSOLE_CSS}</style>
</head>
<body>
<a class="skip" href="#overview">Skip to console</a>
<div class="app">
  <aside class="sidebar" id="sidebar" aria-label="Quant Lab navigation">
    <div class="brand"><div class="mark"><img src="/quant-lab-logo.png" width="38" height="38" alt=""></div><div><b>Quant Lab</b><small>Research OS</small></div></div>
    <div class="nav-label">Console</div>
    <nav class="nav">
      ${nav("overview", "Overview", icon("grid"), true)}
      ${nav("market", "Market", icon("chart"))}
      ${nav("research", "Research", icon("flask"))}
      ${nav("operations", "Operations", icon("cycle"))}
      ${nav("qualification", "Qualification", icon("shield"))}
      ${nav("system", "System", icon("server"))}
    </nav>
    <div class="side-note"><b>Capital boundary</b><span>Paper simulation only. Funding, credentials, and live orders remain disabled.</span></div>
  </aside>

  <div class="main">
    <header class="topbar">
      <div class="top-left"><button class="menu" id="menu" aria-label="Open navigation" aria-controls="sidebar">${icon("menu")}</button><div class="crumb"><b>Quant Lab</b> / Autonomous Console</div></div>
      <div class="top-right"><div class="online"><span class="dot"></span><span data-live="system">System online</span></div><span class="paper">● PAPER ONLY</span></div>
    </header>

    <main class="content" id="overview">
      <section class="hero">
        <div><h1>Evidence first. Capital never assumed.</h1><p>Quant Lab ingests completed BTC-USD candles, evaluates a fixed strategy catalog under hostile evidence gates, selects only qualified research, and operates a reconciled paper account. No champion means safe idle—not a forced trade.</p><div class="hero-actions"><a class="btn primary" href="#market">Open market terminal</a><a class="btn" href="#research">Review research evidence</a></div></div>
        <div class="posture"><div class="label">Current operating posture</div><strong>${esc(human(forward?.state || "safe_idle"))}</strong><div class="posture-grid">
          ${posture("Environment", environment)}${posture("Phase", human(currentPhase))}${posture("Data", human(health?.status || "unknown"))}${posture("Accounting", paperAccount?.accounting_reconciled ? "Reconciled" : "Unverified")}
        </div></div>
      </section>

      <section class="kpis" aria-label="Executive summary">
        ${kpi("BTC-USD", money(price), candleMove === null ? "Awaiting completed candle" : `${pct(candleMove)} this candle`, candleMove, icon("bitcoin"), "price")}
        ${kpi("Paper equity", money(equity), `${money(realized)} realized P&L`, realized, icon("wallet"), "equity")}
        ${kpi("Active champion", champion ? strategyName(champion) : "No champion", champion ? "Qualified selection active" : "Safe idle enforced", champion ? 1 : null, icon("crown"), "champion")}
        ${kpi("Live qualification", human(qState), `${qPassed}/${qTotal} evidence gates passed`, qState === "eligible_for_owner_review" ? 1 : null, icon("shield"), "qualification")}
      </section>

      <section class="section" id="market">
        ${sectionHead("Market terminal", "Interactive TradingView market context with a Quant Lab candle fallback. Quant Lab research continues to use its own immutable completed-candle store.", "BTC-USD · 1 hour · UTC")}
        <div class="market-grid">
          <article class="panel"><div class="panel-head"><div class="panel-title"><b>BTC / U.S. Dollar</b><span>Coinbase market chart · Quant Lab fallback underneath</span></div>${badge(health?.status || "unknown")}</div>
            <div class="chart-shell"><div class="fallback">${candleChart(candles)}<div class="fallback-note">Fallback: immutable Quant Lab completed candles. Interactive layer provided by TradingView when available.</div></div>
              <div class="tradingview-widget-container"><div class="tradingview-widget-container__widget"></div><div class="tradingview-widget-copyright"><a href="https://www.tradingview.com/symbols/BTCUSD/" rel="noopener nofollow" target="_blank">BTCUSD chart</a>&nbsp;by TradingView</div><script type="text/javascript" src="https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js" async>{"autosize":true,"symbol":"COINBASE:BTCUSD","interval":"60","timezone":"Etc/UTC","theme":"dark","backgroundColor":"#07101f","gridColor":"rgba(148,163,184,0.08)","style":"1","locale":"en","allow_symbol_change":false,"calendar":false,"details":false,"hide_side_toolbar":false,"hide_top_toolbar":false,"hide_legend":false,"hide_volume":false,"hotlist":false,"save_image":false,"withdateranges":true,"support_host":"https://www.tradingview.com"}</script></div>
            </div>
          </article>
          <aside class="panel"><div class="panel-head"><div class="panel-title"><b>Paper account</b><span>Reconciled simulation ledger</span></div>${badge(paperAccount?.accounting_reconciled ? "reconciled" : "unverified")}</div><div class="account">
            <div class="account-hero"><span>Total paper equity</span><strong data-live="equity">${money(equity)}</strong><small>Initial cash ${money(paperAccount?.initial_cash)} · Live capital disabled</small></div>
            <div class="stats">${stat("Cash", money(paperAccount?.cash_balance))}${stat("BTC position", format(paperAccount?.position_quantity, 6))}${stat("Realized P&L", money(realized), realized)}${stat("Unrealized P&L", money(paperAccount?.unrealized_pnl), paperAccount?.unrealized_pnl)}${stat("Total fees", money(paperAccount?.total_fees))}${stat("Filled orders", integer(paperAccount?.fill_count))}${stat("Paper cycles", integer(paperAccount?.cycle_count))}${stat("Ledger delta", format(paperAccount?.cash_ledger_delta, 8))}</div>
          </div></aside>
        </div>
      </section>

      <section class="section" id="operations">
        ${sectionHead("Autonomous operations", "The hourly chain ingests first, gates forward execution, reassesses qualification, seals daily research, and preserves immutable receipts.", `<span data-live="refresh">Rendered ${esc(date(new Date().toISOString()))}</span>`)}
        <div class="ops">
          ${op("Forward cycle", human(forward?.state || "none"), forward?.cycle_id || "No cycle", forward?.state)}
          ${op("Scheduler", scheduler?.ingestion_ok ? "Ingestion verified" : "Awaiting proof", scheduler?.scheduler_receipt_id || "No receipt", scheduler?.ingestion_ok ? "healthy" : "warning")}
          ${op("Market data", human(health?.status || "unknown"), `${health?.missing_candles ?? "—"} missing · ${health?.stale_hours ?? "—"} stale hours`, health?.status)}
          ${op("Historical bootstrap", human(bootstrap?.state || "unknown"), `${bootstrap?.contiguous_candle_count ?? 0}/${bootstrap?.target_contiguous_candles ?? 720} contiguous candles`, bootstrap?.state)}
        </div>
        <article class="panel table-panel"><div class="panel-head"><div class="panel-title"><b>Forward-operation evidence</b><span>No qualified champion creates a durable idle cycle instead of a fallback trade</span></div>${badge(forward?.state || "none")}</div><div class="list">
          ${listRow("cycle", "Latest cycle", forward?.cycle_id || "No cycle recorded")}${listRow("clock", "Expected completed candle", date(forward?.expected_closed_at))}${listRow("alert", "Execution blockers", reasons(forward?.blocker_codes), true)}
        </div></article>
      </section>

      <section class="section" id="research">
        ${sectionHead("Research laboratory", "Immutable historical evidence, hostile judging, fixed candidate generation, and qualified-only selection—without adaptive rescue or retroactive tuning.", "Fixed catalog · 8 candidates")}
        <div class="research-cards">
          ${research("Historical benchmark", "Frozen reference strategies on chronological partitions.", [["Candles", baselineBench?.dataset_candle_count],["Runs", baselineBench?.run_count]])}
          ${research("Hostile evidence gates", "Activity, return, drawdown, integrity, and cost-stress gates.", [["Qualified", hostileJudge?.qualified_count],["Rejected", hostileJudge?.rejected_count]])}
          ${research("Controlled candidates", "Exactly eight predeclared EMA and RSI candidates. No expansion.", [["Candidates", strategyFactory?.candidate_count],["Runs", strategyFactory?.run_count]])}
          ${research("Champion selection", "Only qualified evidence enters deterministic ranking.", [["Eligible", championSelection?.eligible_count],["Champion", champion ? 1 : 0]])}
        </div>
        <article class="panel table-panel"><div class="panel-head"><div class="panel-title"><b>Controlled strategy factory</b><span>Expandable evidence replaces raw overflowing diagnostics</span></div>${badge(strategyFactory?.qualified_count ? "qualified" : "insufficient_evidence")}</div><div class="table-scroll"><table><thead><tr><th>Candidate</th><th>Family</th><th>Verdict</th><th>Blockers</th><th>Evidence</th></tr></thead><tbody>${candidateRows || '<tr><td colspan="5">No strategy-factory batch is available.</td></tr>'}</tbody></table></div></article>
        <article class="panel table-panel"><div class="panel-head"><div class="panel-title"><b>Historical baseline comparison</b><span>Paper research context only—not promotion or a live-trading claim</span></div><span class="family">${esc(baselineBench?.benchmark_id || "not commissioned")}</span></div><div class="table-scroll"><table><thead><tr><th>Baseline</th><th>Test return</th><th>Max drawdown</th><th>Trades</th><th>Fills</th></tr></thead><tbody>${baselineRows || '<tr><td colspan="5">No baseline benchmark is available.</td></tr>'}</tbody></table></div></article>
        <article class="panel table-panel"><div class="panel-head"><div class="panel-title"><b>Selection state</b><span>Fallback selection is prohibited</span></div>${badge(championSelection?.state || "none")}</div><div class="list">${listRow("crown", "Champion", `<span data-live="champion">${esc(champion || "None — safe idle")}</span>`, true)}${listRow("check", "Qualified candidates", integer(championSelection?.eligible_count))}${listRow("alert", "Selection blockers", reasons(championSelection?.blocker_codes), true)}</div></article>
      </section>

      <section class="section" id="qualification">
        ${sectionHead("Live-capital evidence gate", "Eligibility evidence only. This console cannot approve, fund, credential, authorize, or execute live capital.", "Owner approval remains separate")}
        <div class="qual-grid"><article class="panel qual-main"><div class="qual-top"><div><h3 data-live="qualification">${esc(human(qState))}</h3><p>${liveQualification?.eligible_for_owner_review ? "Evidence has reached owner-review eligibility. Live authority is still absent." : "The evidence package has not reached owner-review eligibility."}</p></div>${badge(qState)}</div><div class="track"><div class="bar" style="width:${qProgress}%"></div></div><div class="gate-grid"><div class="gate"><span>Passed gates</span><b>${integer(qPassed)}</b></div><div class="gate"><span>Failed gates</span><b>${integer(qFailed)}</b></div><div class="gate"><span>Live authorized</span><b>${liveQualification?.live_authorized ? "Yes" : "No"}</b></div></div><div class="reasons" style="margin-top:18px">${reasons(liveQualification?.blocker_codes)}</div></article>
          <aside class="panel list">${listRow("check", "Owner approval required", "Evidence cannot self-authorize capital.")}${listRow("check", "Credential collection disabled", "No brokerage or exchange credential path is exposed.")}${listRow("check", "Funding disabled", "The system remains paper-only regardless of research results.")}${listRow("check", "Live orders disabled", "Only reconciled paper decisions can execute.")}</aside>
        </div>
      </section>

      <section class="section" id="system">
        ${sectionHead("System integrity", "Production alignment, market-data lineage, rolling research, and immutable bootstrap state.", `Deployment ${esc(shortSha(deploymentSha))}`)}
        <div class="system-grid">
          ${systemCard("Market-data pipeline", [["Status", human(health?.status || "unknown")],["Provider", health?.provider || "unknown"],["Latest close", date(health?.latest_closed_at)],["Missing", health?.missing_candles ?? "—"],["Last success", date(health?.last_success_at)]])}
          ${systemCard("Rolling research", [["Epoch", epoch?.epoch_date || "none"],["State", human(epoch?.state || "unknown")],["Candidates", epoch?.candidate_count ?? 0],["Runs", epoch?.run_count ?? 0],["Same-candle activation", epoch?.same_candle_activation_allowed ? "Allowed" : "Blocked"]])}
          ${systemCard("Production runtime", [["Environment", environment],["Phase", human(currentPhase)],["Deployment", shortSha(deploymentSha)],["Accounting", paperAccount?.accounting_reconciled ? "Reconciled" : "Unverified"],["Capital mode", "Paper only"]])}
        </div>
      </section>
      <footer class="footer"><span>Quant Lab · Autonomous paper-trading research system</span><span>Truthful evidence · Fixed gates · No live capital</span></footer>
    </main>
  </div>
</div>
<script>
(()=>{const menu=document.getElementById('menu'),links=[...document.querySelectorAll('.nav a')];menu?.addEventListener('click',()=>document.body.classList.toggle('nav-open'));links.forEach(a=>a.addEventListener('click',()=>document.body.classList.remove('nav-open')));const sections=links.map(a=>document.querySelector(a.getAttribute('href'))).filter(Boolean);const io=new IntersectionObserver(es=>{const v=es.filter(e=>e.isIntersecting).sort((a,b)=>b.intersectionRatio-a.intersectionRatio)[0];if(v)links.forEach(a=>a.classList.toggle('active',a.getAttribute('href')==='#'+v.target.id))},{rootMargin:'-25% 0px -65% 0px',threshold:[0,.2,.6]});sections.forEach(s=>io.observe(s));const set=(k,v)=>document.querySelectorAll('[data-live="'+k+'"]').forEach(n=>n.textContent=v);const money=v=>Number.isFinite(Number(v))?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(Number(v)):'—';const human=v=>String(v||'unknown').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());async function refresh(){try{const r=await fetch('/api/public/status',{headers:{accept:'application/json'},cache:'no-store'});if(!r.ok)throw new Error();const s=await r.json();set('system',s.workerStatus==='online'&&s.databaseConnected?'System online':'System degraded');set('equity',money(s.paperAccount?.equity));set('champion',s.championSelection?.champion_candidate_id||'None — safe idle');set('qualification',human(s.liveQualification?.state));set('refresh','Live refresh '+new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}))}catch{set('system','Live refresh unavailable')}}setInterval(refresh,30000)})();
</script>
</body></html>`;
}

function nav(id,label,svg,active=false){return `<a href="#${id}"${active?' class="active"':''}>${svg}${esc(label)}</a>`}
function posture(label,value){return `<div class="posture-cell"><span>${esc(label)}</span><b>${esc(value)}</b></div>`}
function sectionHead(title,copy,meta){return `<div class="section-head"><div><h2>${esc(title)}</h2><p>${esc(copy)}</p></div><div class="section-meta">${meta}</div></div>`}
function kpi(label,value,sub,t,svg,live){return `<article class="kpi"><div class="kpi-head"><span>${esc(label)}</span><div class="kpi-icon">${svg}</div></div><div class="kpi-value"${live?` data-live="${live}"`:''}>${esc(value)}</div><div class="kpi-sub ${tone(t)}">${esc(sub)}</div></article>`}
function stat(label,value,t=null){return `<div class="stat"><span>${esc(label)}</span><b class="${tone(t)}">${esc(value)}</b></div>`}
function op(label,value,detail,state){return `<article class="op"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div><div class="detail">${esc(detail)}</div><div style="margin-top:12px">${badge(state||'unknown')}</div></article>`}
function research(title,copy,metrics){return `<article class="research-card"><h3>${esc(title)}</h3><p>${esc(copy)}</p><div class="mini">${metrics.map(([l,v])=>`<div><span>${esc(l)}</span><b>${esc(v??'—')}</b></div>`).join('')}</div></article>`}
function systemCard(title,rows){return `<article class="system-card"><h3>${esc(title)}</h3>${rows.map(([l,v])=>`<div class="system-row"><span>${esc(l)}</span><b>${esc(v??'—')}</b></div>`).join('')}</article>`}
function listRow(iconName,title,content,allowHtml=false){const rendered=allowHtml?String(content??''):esc(content);return `<div class="list-row"><div class="list-icon">${icon(iconName)}</div><div><b>${esc(title)}</b><span>${rendered}</span></div></div>`}
function reasons(values){const list=Array.isArray(values)?values:[];return list.length?list.map(reason).join(''):'<span class="reason pass">No active blockers</span>'}
function reason(v){return `<span class="reason">${esc(human(v))}</span>`}
function badge(v){const n=String(v||'unknown').toLowerCase();let c='info';if(['healthy','online','reconciled','complete','qualified','champion_selected','eligible_for_owner_review','filled','success'].some(x=>n.includes(x)))c='good';else if(['error','rejected','failed','degraded','conflict'].some(x=>n.includes(x)))c='bad';else if(['insufficient','blocked','waiting','stale','no_champion','not_qualified','idle','unverified'].some(x=>n.includes(x)))c='warn';return `<span class="badge ${c}">${esc(human(v||'unknown'))}</span>`}
function candleChart(raw){const cs=(Array.isArray(raw)?raw:[]).map(x=>({o:num(x.open),h:num(x.high),l:num(x.low),c:num(x.close)})).filter(x=>[x.o,x.h,x.l,x.c].every(v=>v!==null)).slice(-96);if(cs.length<2)return '<div style="display:grid;place-items:center;height:100%;color:#62738d;font-size:11px">Quant Lab candle fallback will appear when recent history is available.</div>';const W=1000,H=430,T=22,B=30,lo=Math.min(...cs.map(x=>x.l)),hi=Math.max(...cs.map(x=>x.h)),span=Math.max(hi-lo,1),y=v=>T+((hi-v)/span)*(H-T-B),step=W/cs.length,bw=Math.max(2,Math.min(8,step*.58));const grid=[0,1,2,3,4].map(i=>{const gy=T+((H-T-B)/4)*i,label=hi-(span/4)*i;return `<line x1="0" y1="${gy}" x2="${W}" y2="${gy}" stroke="rgba(148,163,184,.08)"/><text x="${W-8}" y="${gy-5}" text-anchor="end" fill="#62738d" font-size="10">${esc(format(label,0))}</text>`}).join('');const marks=cs.map((x,i)=>{const px=step*i+step/2,up=x.c>=x.o,color=up?'#44e6c5':'#ff7d8e',oy=y(x.o),cy=y(x.c),by=Math.min(oy,cy),bh=Math.max(1.5,Math.abs(cy-oy));return `<line x1="${px}" y1="${y(x.h)}" x2="${px}" y2="${y(x.l)}" stroke="${color}"/><rect x="${px-bw/2}" y="${by}" width="${bw}" height="${bh}" rx="1" fill="${color}"/>`}).join('');return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Stored BTC-USD hourly candlestick chart" preserveAspectRatio="none">${grid}${marks}</svg>`}
function strategyName(v){return String(v||'Unknown').replace(/^candidate-/,'').replace(/^baseline-/,'').replace(/-v\d+.*$/,'').split('-').map(p=>['ema','rsi'].includes(p.toLowerCase())?p.toUpperCase():p).join(' ')}
function inferFamily(v){const s=String(v||'').toLowerCase();return s.includes('ema')?'ema_cross':s.includes('rsi')?'rsi_mean_reversion':'reference'}
function human(v){return String(v??'unknown').replaceAll('_',' ').replaceAll('-',' ').replace(/\b\w/g,c=>c.toUpperCase())}
function num(v){if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null}
function money(v){const n=num(v);return n===null?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(n)}
function format(v,d=2){const n=num(v);return n===null?'—':new Intl.NumberFormat('en-US',{maximumFractionDigits:d}).format(n)}
function integer(v){return format(v,0)}
function pct(v){const n=num(v);return n===null?'—':`${n>0?'+':''}${format(n,2)}%`}
function date(v){if(!v)return '—';const d=new Date(v);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZoneName:'short'}).format(d):String(v)}
function shortSha(v){const s=String(v||'unknown');return s.length>12?`${s.slice(0,12)}…`:s}
function tone(v){const n=num(v);return n===null||n===0?'neutral':n>0?'positive':'negative'}
function safeOrigin(value){try{const url=new URL(String(value||''));return url.protocol==='https:'||url.protocol==='http:'?url.origin:''}catch{return ''}}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':'&quot;',"'":"&#39;"})[c])}
function icon(name){const paths={grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',chart:'<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-7"/>',flask:'<path d="M9 3h6"/><path d="M10 3v6l-5 8a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-8V3"/><path d="M8 14h8"/>',cycle:'<path d="M20 7h-5V2"/><path d="M4 17h5v5"/><path d="M20 7a8 8 0 0 0-14-3L4 6"/><path d="M4 17a8 8 0 0 0 14 3l2-2"/>',shield:'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',server:'<rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/><path d="M7 7h.01M7 17h.01"/>',menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',bitcoin:'<path d="M9 5h6a3 3 0 0 1 0 6H9z"/><path d="M9 11h7a3 3 0 0 1 0 6H9zM12 3v2M15 3v2M12 17v4M15 17v4M7 5h2M7 17h2"/>',wallet:'<path d="M3 6h15a2 2 0 0 1 2 2v10H5a2 2 0 0 1-2-2V6Z"/><path d="M3 8V5a2 2 0 0 1 2-2h11"/><path d="M16 12h4"/>',crown:'<path d="m3 7 4 4 5-7 5 7 4-4-2 11H5L3 7Z"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',alert:'<path d="M10.3 3.6 2.2 17.7A2 2 0 0 0 4 20.7h16a2 2 0 0 0 1.8-3L13.7 3.6a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',check:'<path d="m5 12 4 4L19 6"/>',cycle2:'<path d="M20 12a8 8 0 1 1-2.3-5.7L20 8"/><path d="M20 3v5h-5"/>'};return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.check}</svg>`}
