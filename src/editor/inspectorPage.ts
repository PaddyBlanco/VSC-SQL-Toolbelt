export function inspectorPage() {
    const nonce = crypto.randomUUID();
    return `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style nonce="${nonce}">
body{padding:1rem;color:var(--vscode-editor-foreground);background:var(--vscode-editor-background);font:var(--vscode-font-size) var(--vscode-font-family)}
nav{display:flex;flex-wrap:wrap;gap:.4rem;border-bottom:1px solid var(--vscode-panel-border)}
button{font:inherit;color:inherit;background:transparent;border:0;padding:.55rem;cursor:pointer}
[aria-selected=true]{border-bottom:2px solid var(--vscode-focusBorder);font-weight:bold}
button:focus-visible,pre:focus-visible{outline:2px solid var(--vscode-focusBorder)}
#open{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
section{overflow:auto}pre{font-family:var(--vscode-editor-font-family);white-space:pre-wrap;overflow-wrap:anywhere}
td,th{text-align:left;vertical-align:top;padding:.4rem .8rem;border-bottom:1px solid var(--vscode-panel-border);overflow-wrap:anywhere}
table{border-collapse:collapse}#note{color:var(--vscode-descriptionForeground)}
</style></head><body>
<nav role="tablist" aria-label="Objektdetails">
<button id="dependencies" role="tab" aria-controls="content">Dependencies</button>
<button id="create" role="tab" aria-controls="content">Create</button>
<button id="indexes" role="tab" aria-controls="content">Keys / Indexes</button>
<button id="properties" role="tab" aria-controls="content">Properties</button></nav>
<section id="content" role="tabpanel" tabindex="0"><p id="status" role="status"></p><p id="note"></p><div id="result"></div>
<button id="open" hidden>Im SQL-Editor öffnen</button></section>
<script nonce="${nonce}">
const vscode=acquireVsCodeApi();
const byId=id=>document.getElementById(id);
const buttons=Array.from(document.querySelectorAll('[role=tab]'));
const result=byId('result'), open=byId('open');
const headings={dependencies:['Richtung','Art','Objekt'],indexes:['Typ','Name','Spalte','Reihenfolge / Rolle','Ziel'],properties:['Eigenschaft','Wert']};
let tab,request=0;
function select(button){
 tab=button.id;
 for(const b of buttons){b.setAttribute('aria-selected',String(b===button));b.tabIndex=b===button?0:-1;}
 byId('content').setAttribute('aria-labelledby',tab);
 result.replaceChildren();open.hidden=true;byId('status').textContent='Lädt …';
 byId('note').textContent=tab==='dependencies'?'Statische Referenzen und Fremdschlüssel der aktuellen Datenbank. Sichtbarkeit hängt von deinen Rechten ab. Dynamisches SQL und externe eingehende Verweise können fehlen.':'';
 vscode.postMessage({action:'load',tab,request:++request});
}
buttons.forEach((button,i)=>{
 button.onclick=()=>select(button);
 button.onkeydown=e=>{
  const next={ArrowRight:(i+1)%4,ArrowLeft:(i+3)%4,Home:0,End:3}[e.key];
  if(next===undefined)return;e.preventDefault();buttons[next].focus();select(buttons[next]);
 };
});
function openEditor(){if(!open.hidden)vscode.postMessage({action:'open',tab,request});}
open.onclick=openEditor;
window.addEventListener('message',event=>{
 const m=event.data;if(m.request!==request||m.tab!==tab)return;
 result.replaceChildren();open.hidden=true;byId('status').textContent=m.error||'';
 if(m.error)return;
 if(tab==='create'){
  const pre=document.createElement('pre');pre.textContent=m.sql;pre.ondblclick=openEditor;result.append(pre);open.hidden=false;return;
 }
 if(!m.rows.length){byId('status').textContent='Keine sichtbaren Einträge.';return;}
 const table=document.createElement('table');
 const header=table.createTHead().insertRow();
 for(const label of headings[tab]){const th=document.createElement('th');th.scope='col';th.textContent=label;header.append(th);}
 const body=table.createTBody();
 for(const row of m.rows){const tr=body.insertRow();for(const value of row)tr.insertCell().textContent=value??'—';}
 result.append(table);
});
select(byId('properties'));
</script></body></html>`;
}