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
.description{white-space:pre-wrap}.edit-description{color:var(--vscode-textLink-foreground)}
textarea{display:block;box-sizing:border-box;width:min(36rem,100%);min-width:min(16rem,100%);min-height:5rem;font:inherit;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,var(--vscode-panel-border))}
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
const headings={dependencies:['Richtung','Art','Objekt'],indexes:['Typ','Name','Index key columns','Included columns','Ziel'],properties:['Eigenschaft','Wert']};
let tab,request=0,finishSave;
function select(button){
 tab=button.id;
 finishSave=undefined;
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
function descriptionCell(cell,original){
 const text=document.createElement('span');text.className='description';text.textContent=original||'—';
 const edit=document.createElement('button');edit.className='edit-description';edit.textContent='Bearbeiten';
 edit.setAttribute('aria-label','Beschreibung bearbeiten');
 cell.replaceChildren(text,edit);
 edit.onclick=()=>{
  const input=document.createElement('textarea');input.setAttribute('aria-label','Beschreibung');input.maxLength=3750;input.value=original;
  const initial=input.value, save=document.createElement('button');save.textContent='Speichern';save.disabled=true;
  input.oninput=()=>{save.disabled=input.value===initial;};
  const cancel=document.createElement('button');cancel.textContent='Abbrechen';
  cell.replaceChildren(input,save,cancel);input.focus();
  const restore=()=>{cell.replaceChildren(text,edit);edit.focus();};
  cancel.onclick=()=>{byId('status').textContent='';restore();};
  save.onclick=()=>{
   save.disabled=cancel.disabled=true;input.readOnly=true;byId('status').textContent='Speichert …';
   finishSave=m=>{
    if(m.saveError){save.disabled=cancel.disabled=false;input.readOnly=false;byId('status').textContent=m.saveError;input.focus();return;}
    original=m.value;text.textContent=original||'—';byId('status').textContent='Beschreibung gespeichert.';restore();
   };
   vscode.postMessage({action:'saveDescription',tab,request,value:input.value});
  };
 };
}
window.addEventListener('message',event=>{
 const m=event.data;if(m.request!==request||m.tab!==tab)return;
 if(m.saved||m.saveError){if(finishSave)finishSave(m);finishSave=undefined;return;}
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
 for(const row of m.rows){
  const tr=body.insertRow();
  if(tab==='properties'&&row[0]==='Beschreibung'){tr.insertCell().textContent=row[0];descriptionCell(tr.insertCell(),row[1]);}
  else for(const value of row)tr.insertCell().textContent=value??'—';
 }
 result.append(table);
});
select(byId('properties'));
</script></body></html>`;
}
