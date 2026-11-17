// ─── TRILHA DE ESTUDO ─────────────────────────────────────────────────────────
// Checklist da trilha (dados em trilha-data.js). Cada marcação fica em S.trail[id] = {d: data em que foi
// concluído ('' quando desmarcado), n: nota da discursiva, u: momento da alteração em ms}.
// Sincroniza com a tabela trail_progress do Supabase; se a tabela ainda não existir, tudo segue local.

const TRAIL_SQL = `create table if not exists trail_progress (
  id text primary key,
  done_at text,
  nota text,
  updated_ms bigint
);
alter table trail_progress enable row level security;
drop policy if exists "anon_all_trail" on trail_progress;
create policy "anon_all_trail" on trail_progress
  for all to anon using (true) with check (true);`;

function trailData(){return typeof TRILHA!=='undefined'&&Array.isArray(TRILHA)?TRILHA:[];}
function trailItems(sec){return sec.groups.flatMap(g=>g.items);}
function trailDone(id){const t=S.trail[id];return !!(t&&t.d);}
function trailStats(sec){const it=trailItems(sec);const done=it.filter(i=>trailDone(i.id)).length;return{done,total:it.length,pct:it.length?Math.round(done/it.length*100):0};}
function trailOverall(){
  let done=0,total=0;
  trailData().forEach(s=>{if(s.excluded)return;const st=trailStats(s);done+=st.done;total+=st.total;});
  return{done,total,pct:total?Math.round(done/total*100):0};
}
function trailDated(){
  const out=[];
  trailData().forEach(s=>s.groups.forEach(g=>g.items.forEach(i=>{if(i.date)out.push({...i,sec:s.key});})));
  return out.sort((a,b)=>a.date.localeCompare(b.date));
}
function trailToday(){return trailDated().filter(i=>i.date===todayISO());}
function trailLate(){const t=todayISO();return trailDated().filter(i=>i.date<t&&!trailDone(i.id));}
function trailNext(){
  const t=todayISO();
  const d=trailDated().find(i=>i.date>=t&&!trailDone(i.id));
  if(d)return d;
  for(const s of trailData()){if(s.excluded)continue;for(const i of trailItems(s))if(!trailDone(i.id))return{...i,sec:s.key};}
  return null;
}

// ─── AÇÕES ───
function trailSet(id,patch){
  const cur=S.trail[id]||{d:'',n:''};
  const v={d:cur.d||'',n:cur.n||'',...patch,u:Date.now()};
  S.trail={...S.trail,[id]:v};
  saveLocal();
  queueOp({op:'trailUpsert',id,v});
}
function toggleTrail(id){
  trailSet(id,{d:trailDone(id)?'':todayISO()});
  render();
}
function setTrailNota(id,val){
  const n=String(val||'').replace(',','.').trim();
  if(n!==''&&(isNaN(+n)||+n<0||+n>11)){flash('Nota entre 0 e 11');return;}
  trailSet(id,{n});
}
function toggleTrailSection(k){S.trailOpen={...S.trailOpen,[k]:!S.trailOpen[k]};render();}
function setTrailFilter(f){S.trailFilter=f;render();}
function logFromTrail(id){
  const it=trailDated().find(i=>i.id===id);if(!it)return;
  const block=it.block||(it.sec==='disc'?'Sábado':defaultBlock());
  S.form={...S.form,date:todayISO(),block:isStdBlock(block)?block:'Outros',discipline:'LGPD',notes:it.label};
  S.view='session';render();
}

// ─── SUPABASE ───
function trailToDB(id,v){return{id,done_at:v.d||'',nota:v.n||'',updated_ms:v.u||0};}
function trailMissingTable(err){return /^404|PGRST205|42P01|does not exist|Could not find the table/i.test(String(err&&err.message||err));}
async function trailPull(){
  try{
    const r=await sbReq('trail_progress?select=*');
    const rows=await r.json();
    S.trailCloud='ok';
    const merged={...S.trail};
    const toPush=[];
    const remote=new Map(rows.map(x=>[x.id,{d:x.done_at||'',n:x.nota||'',u:+x.updated_ms||0}]));
    remote.forEach((v,id)=>{const l=merged[id];if(!l||(l.u||0)<v.u)merged[id]=v;});
    Object.entries(merged).forEach(([id,v])=>{const rv=remote.get(id);if(!rv||(rv.u||0)<(v.u||0))toPush.push({op:'trailUpsert',id,v});});
    S.trail=merged;saveLocal();
    if(toPush.length){const known=new Set(S.pending.filter(p=>p.op==='trailUpsert').map(p=>p.id));toPush.forEach(p=>{if(!known.has(p.id))S.pending.push(p);});savePending();flushPending();}
  }catch(err){
    S.trailCloud=trailMissingTable(err)?'missing':'error';
  }
}

// ─── VIEW ───
function trailBar(pct,color){return`<div style="height:4px;background:rgba(255,255,255,.08)"><div style="height:100%;width:${pct}%;background:${color};"></div></div>`;}
function trailItemHtml(i,opts={}){
  const done=trailDone(i.id);
  const t=S.trail[i.id]||{};
  const late=i.date&&i.date<todayISO()&&!done;
  const badge=i.date?`<span style="font-family:'Inter',system-ui,sans-serif;font-size:11px;letter-spacing:.1em;color:${late?'#FF4466':'#B080A0'};border:1px solid ${late?'rgba(255,68,102,.4)':'rgba(180,140,200,.2)'};padding:2px 6px;white-space:nowrap">${fmtShort(i.date)}${i.block?' · '+e(i.block).toLowerCase():''}${late?' · atrasado':''}</span>`:'';
  const nota=i.nota&&done?`<label style="display:flex;align-items:center;gap:6px;margin-top:8px;font-family:'Inter',system-ui,sans-serif;font-size:11px;color:#B080A0;letter-spacing:.1em">NOTA (0 A 11)<input type="text" inputmode="decimal" value="${e(t.n||'')}" onchange="setTrailNota('${jsq(i.id)}',this.value)" style="width:56px;padding:4px 6px;font-size:12px;font-family:'Inter',system-ui,sans-serif"></label>`:'';
  const logBtn=opts.log&&!done?`<button onclick="logFromTrail('${jsq(i.id)}')" title="Abrir Nova sessão já preenchida com este item" style="margin-top:4px;padding:2px 0;background:transparent;border:none;color:#FF3366;font-size:12px">Registrar sessão</button>`:'';
  return`<div class="tt-row" style="display:flex;gap:12px;align-items:flex-start;padding:10px 6px;border-bottom:1px solid rgba(255,255,255,.08)">
    <input type="checkbox" ${done?'checked':''} onchange="toggleTrail('${jsq(i.id)}')" aria-label="Concluído" style="width:18px;height:18px;margin-top:2px;accent-color:#FF0044;flex-shrink:0;cursor:pointer">
    <div style="flex:1;min-width:0">
      <div style="display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap">
        <div style="flex:1;min-width:200px;font-size:13px;line-height:1.5;color:${done?'#A994B5':'#FFE6EE'};${done?'text-decoration:line-through;text-decoration-color:rgba(255,0,68,.5)':''}">${e(i.label)}</div>${badge}
      </div>
      ${i.detail&&!done?`<div style="font-size:11.5px;color:#A98FB8;line-height:1.55;margin-top:3px">${e(i.detail)}</div>`:''}
      ${done&&t.d?`<div style="font-family:'Inter',system-ui,sans-serif;font-size:11px;color:#39FF7A;letter-spacing:.1em;margin-top:3px">✓ ${fmtShort(t.d)}</div>`:''}
      ${nota}${logBtn}
    </div>
  </div>`;
}
function buildTrilha(){
  const data=trailData();
  if(!data.length)return`<div class="view-content"><div style="${card()}">Os dados da trilha não carregaram. Recarregue a página com internet.</div></div>`;
  const ov=trailOverall();
  const rot=data.find(s=>s.key==='roteiro');const rs=rot?trailStats(rot):{done:0,total:0,pct:0};
  const disc=data.find(s=>s.key==='disc');const ds=disc?trailStats(disc):{done:0,total:0,pct:0};
  const notas=disc?trailItems(disc).map(i=>S.trail[i.id]).filter(t=>t&&t.d&&t.n!==''&&!isNaN(+t.n)).map(t=>+t.n):[];
  const media=notas.length?(notas.reduce((a,b)=>a+b,0)/notas.length).toFixed(1).replace('.',','):'—';
  const late=trailLate();const today=trailToday();const next=trailNext();
  const metric=(l,val,sub,color,pct)=>`<div style="border:1px solid rgba(255,255,255,.08);background:rgba(20,6,30,.85);padding:18px">
      <div style="font-family:'Inter',system-ui,sans-serif;font-size:11px;letter-spacing:.04em;color:#B080A0;;margin-bottom:10px">${l}</div>
      <div style="font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:34px;color:#FFE6EE;line-height:1;">${val}</div>
      <div style="margin-top:12px">${trailBar(pct,color)}</div>
      <div style="font-family:'Inter',system-ui,sans-serif;font-size:11px;color:#A994B5;margin-top:8px">${sub}</div></div>`;
  let h=`<div class="view-content">
  <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:18px;padding-bottom:16px;border-bottom:1px solid rgba(255,255,255,.08);gap:16px;flex-wrap:wrap">
    <div>${sectionTag('// trilha de estudo')}<h1 style="font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:24px;color:#FFE6EE">Trilha: Concurso ANPD</h1>
    <div style="font-family:'Inter',system-ui,sans-serif;font-size:11px;color:#A994B5;letter-spacing:.1em;margin-top:4px">conteúdo da trilha em ${fmtShort(TRILHA_GERADA_EM)} · <a href="${TRILHA_URL}" target="_blank" rel="noopener" style="color:#B864E8">abrir o documento completo ↗</a></div></div>
    <div style="display:flex;gap:6px">${['pendentes','todos'].map(f=>`<button onclick="setTrailFilter('${f}')" style="padding:7px 14px;${navStyle(S.trailFilter===f)};font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:10px;letter-spacing:.04em;">${f==='pendentes'?'Só pendentes':'Mostrar tudo'}</button>`).join('')}</div>
  </div>
  ${S.sbUrl&&S.trailCloud==='missing'?`<div style="${card('margin-bottom:16px;border-color:rgba(255,180,0,.4)')}"><div style="font-size:13px;color:#FFB400;margin-bottom:8px">As marcações da trilha estão salvas só neste aparelho. Para sincronizar com a nuvem, rode este SQL uma vez no SQL Editor do Supabase e recarregue a página:</div><div style="background:#06000F;border:1px solid rgba(255,255,255,.08);padding:12px;font-family:'Inter',system-ui,sans-serif;font-size:11px;color:#A98FB8;white-space:pre;overflow-x:auto">${e(TRAIL_SQL)}</div></div>`:''}
  <div class="grid-metrics" style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:18px">
    ${metric('Progresso geral',ov.pct+'%',`${ov.done} de ${ov.total} itens de conteúdo`,'#FF0044',ov.pct)}
    ${metric('Roteiro do dia',rs.done+'/'+rs.total,late.length?`${late.length} ${late.length===1?'item atrasado':'itens atrasados'}`:'em dia','#B864E8',rs.pct)}
    ${metric('Discursivas',ds.done+'/'+ds.total,`média ${media} de 11`,'#FFB400',ds.pct)}
    ${metric('Próximo item',next?(next.date?fmtShort(next.date):'—'):'✓',next?e(next.label.slice(0,60))+(next.label.length>60?'...':''):'trilha concluída','#39FF7A',next?0:100)}
  </div>`;
  // Hoje e atrasados
  const dow=new Date().getDay();
  const geral=(dow>=1&&dow<=5)?`<div style="font-size:12px;color:#A98FB8;line-height:1.6;padding:8px 6px">${dow===1||dow===5?'Manhã (6h às 7h45): matérias gerais, direito administrativo e constitucional (antecipação do Módulo 2).':'Manhã, 6h às 6h45: matérias gerais (antecipação do Módulo 2); depois, a linha "Manhã" abaixo.'}</div>`:'';
  h+=`<div class="grid-2col" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:18px">
    <div style="${card()}">${sectionTag('Hoje, '+fmtShort(todayISO()),true)}${geral}${today.length?today.map(i=>trailItemHtml(i,{log:true})).join(''):`<div style="font-size:13px;color:#A994B5;padding:8px 6px">Nenhum item com data para hoje na trilha.</div>`}</div>
    <div style="${card(late.length?'border-color:rgba(255,68,102,.35)':'')}">${sectionTag('Atrasados',true)}${late.length?late.slice(0,12).map(i=>trailItemHtml(i,{log:true})).join('')+(late.length>12?`<div style="font-size:11px;color:#A994B5;padding:8px 6px">e mais ${late.length-12} na seção do roteiro</div>`:''):`<div style="font-size:13px;color:#39FF7A;padding:8px 6px">Nada atrasado.</div>`}</div>
  </div>`;
  // Seções
  data.forEach(s=>{
    const st=trailStats(s);
    const open=!!S.trailOpen[s.key];
    const color=s.excluded?'#8A7CFF':st.pct===100?'#39FF7A':'#FF0044';
    h+=`<div style="${card('margin-bottom:12px;padding:0')}">
      <button onclick="toggleTrailSection('${s.key}')" aria-expanded="${open}" style="width:100%;display:flex;align-items:center;gap:14px;padding:16px 20px;background:transparent;border:none;text-align:left">
        <span style="font-family:'Inter',system-ui,sans-serif;font-size:12px;color:#FF0044;width:12px">${open?'▾':'▸'}</span>
        <span style="flex:1;min-width:0"><span style="display:block;font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:14px;color:#FFE6EE">${e(s.title)}${s.excluded?' <span style="font-size:10px;color:#8A7CFF;letter-spacing:.1em">(FORA DA CONTAGEM)</span>':''}</span>
        <span style="display:block;margin-top:8px;max-width:420px">${trailBar(st.pct,color)}</span></span>
        <span style="font-family:'Inter',system-ui,sans-serif;font-size:11px;color:${color};white-space:nowrap">${st.done}/${st.total} · ${st.pct}%</span>
      </button>`;
    if(open){
      h+=`<div style="padding:0 20px 14px">`;
      let shown=0;
      s.groups.forEach(g=>{
        const items=S.trailFilter==='pendentes'?g.items.filter(i=>!trailDone(i.id)):g.items;
        if(!items.length)return;
        shown+=items.length;
        if(g.title)h+=`<div style="font-family:'Inter',system-ui,sans-serif;font-size:11px;letter-spacing:.04em;color:#B864E8;;margin:14px 0 4px">${e(g.title)}</div>`;
        h+=items.map(i=>trailItemHtml(i,{log:!!i.date})).join('');
      });
      if(!shown)h+=`<div style="font-size:13px;color:#39FF7A;padding:10px 6px">Tudo concluído nesta seção. Use "Mostrar tudo" para rever.</div>`;
      h+=`</div>`;
    }
    h+=`</div>`;
  });
  h+=`<div style="font-size:11px;color:#A994B5;line-height:1.6;margin-top:10px">As explicações, tabelas e o caderno de prazos continuam no documento da trilha. Aqui ficam só os itens para marcar. Quando a trilha mudar, peça ao Claude para regenerar a lista: o que já foi marcado é mantido.</div></div>`;
  return h;
}
function buildTrailDashCard(){
  if(!trailData().length)return'';
  const ov=trailOverall();const today=trailToday();const late=trailLate();
  const pend=today.filter(i=>!trailDone(i.id));
  const list=today.length?today.map(i=>trailItemHtml(i,{log:true})).join(''):`<div style="font-size:13px;color:#C1A6BC;padding:6px 0">Nenhum item da trilha com data para hoje.</div>`;
  return`<div style="${card('margin-bottom:18px')}">
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:6px">
      <h2 style="font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:16px;color:#FFE6EE">Trilha de hoje</h2>
      <button onclick="setView('trilha')" style="background:transparent;border:none;color:#FF3366;font-size:13px;padding:0">Abrir a trilha completa</button>
    </div>
    <div style="font-size:12px;color:#C1A6BC;margin-bottom:10px">${today.length?`${pend.length} de ${today.length} pendentes hoje`:'Sem itens datados hoje'}${late.length?` · <span style="color:#FF4466">${late.length} atrasado${late.length===1?'':'s'}</span>`:''} · ${ov.pct}% da trilha concluída</div>
    ${list}
  </div>`;
}
