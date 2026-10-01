// @host 1:15
// Phase 5, Consumer 1: discover → configure → validate → save → reopen → audit → navigate.
const S=[],post=(m)=>S.push(m),L=(t)=>S.filter((m)=>m.type===t).slice(-1)[0],N=(id)=>figma.getNodeByIdAsync(id);
await figma.setCurrentPageAsync(await N('1:15'));
(await N('1:18')).fills=[{type:'SOLID',color:{r:0x63/255,g:0x5b/255,b:1}}];
const dev={library:[]},st=DSD.memoryStorage(null,dev),c1=DSD.createController({post,storage:st});
await c1.handle({type:'init'});const first=L('init-state').settings.designSystem;
await c1.handle({type:'get-discovery'});const d=L('discovery').discovery;
const pick=(l,n)=>l.filter((a)=>n.includes(a.name)).map(DSD.refFor),P=DSD.parseScale;
const sc={spacing:P('Spacing scale','0, 4, 8, 12, 16, 24, 32'),radius:P('Corner radius scale','0, 4, 8, 12, 16, 999')};
const none={library:false,local:false};
const ds={version:2,name:'Acme (production)',variableCollections:pick(d.collections,['Acme Colors','Acme Spacing']),
textStyles:{...none,items:pick(d.textStyles,['Acme / Body','Acme / Button label'])},paintStyles:none,
components:{...none,items:pick(d.components,['Acme / Button'])},spacingScale:sc.spacing.values,radiusScale:sc.radius.values};
const v=DSD.validateDesignSystem(ds,sc,d);
const bad=DSD.validateDesignSystem({...ds,name:'',variableCollections:[],textStyles:{...none,items:[]},components:{...none,items:[]}},{spacing:P('Spacing scale','0, 8, 16, 16'),radius:sc.radius},d);
const ref=DSD.reference.referenceFromSelection(ds,'in-use');
await c1.handle({type:'save-settings',settings:{...DSD.DEFAULT_SETTINGS,designSystem:ref}});const savedTo=L('settings-saved').savedTo;
S.length=0;const c2=DSD.createController({post,storage:st});await c2.handle({type:'init'});
const reopened=L('init-state').settings.designSystem;
figma.currentPage.selection=[await N('1:16')];await c2.handle({type:'run-audit',scope:'selection'});
const r=L('audit-result').result,nav=[];
for(const i of r.issues.filter((x)=>x.severity==='error'||x.severity==='warning')){
figma.viewport.center={x:1e5,y:1e5};figma.viewport.zoom=.1;await c2.handle({type:'go-to-node',nodeId:i.nodeId});
const n=await N(i.nodeId),s=figma.currentPage.selection,b=n.absoluteBoundingBox,c=figma.viewport.center;
nav.push(`${i.ruleId} ${i.nodeId} → ${i.expectedValue} | ${L('navigate-result').ok&&s.length===1&&s[0].id===i.nodeId&&Math.abs(c.x-(b.x+b.width/2))<2}`);}
return{first,collections:d.collections.map((c)=>`${c.name} ${c.remote?'lib':'local'} ${c.key.slice(0,8)}`),textStyles:d.textStyles.map((s)=>s.name),components:d.components.map((c)=>`${c.name} ${c.remote?'lib':'local'}`),
ds,v,bad,savedTo,preserved:JSON.stringify(reopened)===JSON.stringify(ref),selectionPreserved:JSON.stringify(DSD.reference.toSelection(reopened))===JSON.stringify(ds),hasConsumerIds:/VariableCollectionId:|VariableID:|"S:/.test(JSON.stringify(reopened)),
score:r.compliance.score,checks:r.compliance.opportunities,coverage:r.coverage,unresolved:r.unresolvedSources,issues:r.issues.map((i)=>`${i.severity} ${i.ruleId} ${i.nodeId}`),nav,savedOnDevice:dev.library.map((x)=>x.name)};
